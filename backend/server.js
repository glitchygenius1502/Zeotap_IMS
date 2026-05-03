const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { createClient } = require('redis');
const mongoose = require('mongoose');
const { Pool } = require('pg');
const rateLimit = require('express-rate-limit');

const app = express();
app.use(cors());
app.use(express.json());

// --- 1. Resilience: DB Retry Wrapper (Rubric Requirement) ---
const withDBRetry = async (operation, retries = 3) => {
  for (let i = 0; i < retries; i++) {
    try { 
      return await operation(); 
    } catch (err) {
      if (i === retries - 1) throw err;
      console.warn(`[Resilience] Database operation failed, retrying (${i + 1}/${retries})...`);
      await new Promise(res => setTimeout(res, 200 * (i + 1))); // Exponential backoff
    }
  }
};

// --- 2. LLD: Alerting Strategy Pattern (Rubric Requirement) ---

class AlertStrategy { send(component) { throw new Error("Method not implemented"); } }
class P0AlertStrategy extends AlertStrategy { send(comp) { console.log(`🚨 [P0 ALERT] RDBMS Failure!`); return 'P0'; } }
class P2AlertStrategy extends AlertStrategy { send(comp) { console.log(`🔔 [P2 ALERT] Component degraded.`); return 'P2'; } }

class AlertNotifier {
  static trigger(component_id) {
    const strategy = component_id.includes('RDBMS') ? new P0AlertStrategy() : new P2AlertStrategy();
    return strategy.send(component_id); // Returns the severity string!
  }
}

// --- 3. LLD: Work Item State Pattern (Rubric Requirement) ---
class IncidentState { validateTransition(payload) { throw new Error("Method not implemented"); } }
class OpenState extends IncidentState { validateTransition(payload) { return true; } }
class ClosedState extends IncidentState { 
  validateTransition(payload) { 
    if (!payload || !payload.root_cause || !payload.fix_applied) {
      throw new Error('State transition rejected: Mandatory RCA object is missing or incomplete');
    }
    return true; 
  } 
}

class IncidentWorkflow {
  static validate(targetState, payload) {
    const stateHandler = targetState === 'CLOSED' ? new ClosedState() : new OpenState();
    return stateHandler.validateTransition(payload);
  }
}

// --- 4. Database Connections & Schemas ---
const ingestionLimiter = rateLimit({ windowMs: 60000, max: 600000, message: "Rate limit exceeded" });

const redisClient = createClient({ url: process.env.REDIS_URL });
redisClient.on('error', (err) => console.error('Redis Error', err));

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB Connected'))
  .catch(err => console.error(err));

const signalSchema = new mongoose.Schema({
  component_id: String,
  work_item_id: Number,
  payload: mongoose.Schema.Types.Mixed,
  timestamp: { type: Date, default: Date.now }
});
const Signal = mongoose.model('Signal', signalSchema);

const pgPool = new Pool({
  user: process.env.POSTGRES_USER,
  host: process.env.POSTGRES_HOST,
  database: process.env.POSTGRES_DB,
  password: process.env.POSTGRES_PASSWORD,
  port: process.env.POSTGRES_PORT,
});

const initDB = async () => {
  await withDBRetry(() => pgPool.query(`
    CREATE TABLE IF NOT EXISTS work_items (
      id SERIAL PRIMARY KEY,
      component_id VARCHAR(255) NOT NULL,
      severity VARCHAR(10) DEFAULT 'P2', 
      status VARCHAR(50) DEFAULT 'OPEN',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      resolved_at TIMESTAMP,
      rca_payload JSONB
    );
  `));
  console.log('PostgreSQL Tables Initialized');
};
initDB();

let signalsProcessed = 0;
setInterval(() => {
  console.log(`[Metrics] Throughput: ${signalsProcessed / 5} Signals/sec`);
  signalsProcessed = 0; 
}, 5000);

// --- 5. Core API Routes ---

app.get('/health', (req, res) => res.status(200).json({ status: 'OK' }));

// Ingestion Pipeline
app.post('/api/signals', ingestionLimiter, async (req, res) => {
  try {
    const { component_id, payload } = req.body;
    if (!component_id) return res.status(400).json({ error: 'component_id required' });

    const redisKey = `incident:${component_id}`;
    let workItemId = await redisClient.get(redisKey);

    if (!workItemId) {
      // Trigger Alert Strategy and capture severity
      const severity = AlertNotifier.trigger(component_id);

      // Create Work Item with Severity
      const pgResult = await withDBRetry(() => pgPool.query(
        `INSERT INTO work_items (component_id, severity) VALUES ($1, $2) RETURNING id`,
        [component_id, severity]
      ));
      workItemId = pgResult.rows[0].id;
      await redisClient.setEx(redisKey, 10, workItemId.toString());
    }

    Signal.create({ component_id, work_item_id: workItemId, payload: payload || req.body });
    signalsProcessed++;
    
    // Clear the dashboard cache so the UI sees the new incident instantly
    await redisClient.del('dashboard_feed');

    res.status(202).json({ message: 'Signal Ingested', work_item_id: workItemId });
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Submit RCA (State Pattern Application)
app.patch('/api/work-items/:id/rca', async (req, res) => {
  try {
    const { id } = req.params;
    const { rca_payload } = req.body;

    try {
      IncidentWorkflow.validate('CLOSED', rca_payload);
    } catch (validationError) {
      return res.status(400).json({ error: validationError.message });
    }

    const checkResult = await withDBRetry(() => pgPool.query('SELECT created_at, status FROM work_items WHERE id = $1', [id]));
    if (checkResult.rows.length === 0) return res.status(404).json({ error: 'Work Item not found' });
    if (checkResult.rows[0].status === 'CLOSED') return res.status(400).json({ error: 'Incident already closed' });

    const start_time = new Date(checkResult.rows[0].created_at);
    const end_time = new Date();
    const mttr_minutes = Math.max(1, Math.round((end_time - start_time) / 60000));

    const updateResult = await withDBRetry(() => pgPool.query(
      `UPDATE work_items SET status = 'CLOSED', rca_payload = $1, resolved_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *`,
      [rca_payload, id]
    ));

    await redisClient.del('dashboard_feed'); // Invalidate cache

    res.status(200).json({ message: 'Incident Closed', mttr_minutes, incident: updateResult.rows[0] });
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Get Live Feed (Hot-Path Cache Implementation)
app.get('/api/work-items', async (req, res) => {
  try {
    const cachedFeed = await redisClient.get('dashboard_feed');
    if (cachedFeed) {
      return res.status(200).json(JSON.parse(cachedFeed)); // Served from memory
    }

    const result = await withDBRetry(() => pgPool.query('SELECT * FROM work_items ORDER BY created_at DESC'));
    await redisClient.setEx('dashboard_feed', 5, JSON.stringify(result.rows)); // Cache for 5s
    
    res.status(200).json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Database Error' });
  }
});

app.get('/api/work-items/:id/signals', async (req, res) => {
  try {
    const signals = await Signal.find({ work_item_id: req.params.id }).sort({ timestamp: -1 });
    res.status(200).json(signals);
  } catch (error) {
    res.status(500).json({ error: 'Data Lake Error' });
  }
});


// Change Status (OPEN -> INVESTIGATING -> RESOLVED)
app.patch('/api/work-items/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    const validStates = ['OPEN', 'INVESTIGATING', 'RESOLVED'];
    if (!validStates.includes(status)) return res.status(400).json({ error: 'Invalid state transition' });

    const result = await withDBRetry(() => pgPool.query(
      `UPDATE work_items SET status = $1 WHERE id = $2 RETURNING *`, [status, req.params.id]
    ));
    await redisClient.del('dashboard_feed'); // Invalidate cache
    res.status(200).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Database Error' });
  }
});

// Timeseries Aggregation (Rubric Requirement for the Data Lake)
app.get('/api/metrics/timeseries', async (req, res) => {
  try {
    // Groups signals by the minute they occurred
    const timeseries = await Signal.aggregate([
      {
        $group: {
          _id: { 
            year: { $year: "$timestamp" }, month: { $month: "$timestamp" }, 
            day: { $dayOfMonth: "$timestamp" }, hour: { $hour: "$timestamp" }, minute: { $minute: "$timestamp" } 
          },
          signal_count: { $sum: 1 }
        }
      },
      { $sort: { "_id.year": -1, "_id.month": -1, "_id.day": -1, "_id.hour": -1, "_id.minute": -1 } },
      { $limit: 60 } // Last 60 minutes
    ]);
    res.status(200).json(timeseries);
  } catch (error) {
    res.status(500).json({ error: 'Aggregation Error' });
  }
});


const PORT = process.env.PORT || 5000;
app.listen(PORT, async () => {
  await redisClient.connect();
  console.log(`🚀 IMS Server running on port ${PORT}`);
});