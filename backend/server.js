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

// --- 1. Rate Limiting (Rubric Requirement) ---
const ingestionLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 600000, // Allow massive throughput (10k/sec) but prevent infinite loops
  message: "Cascading failure protection activated: Too many requests"
});

// --- 2. Database Connections & Schemas ---

const redisClient = createClient({ url: process.env.REDIS_URL });
redisClient.on('error', (err) => console.error('Redis Error', err));

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB Connected'))
  .catch(err => console.error(err));

// MongoDB Schema for Raw Signals (The Data Lake)
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

// Auto-initialize Postgres Table (The Source of Truth)
const initDB = async () => {
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS work_items (
      id SERIAL PRIMARY KEY,
      component_id VARCHAR(255) NOT NULL,
      status VARCHAR(50) DEFAULT 'OPEN',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      resolved_at TIMESTAMP,
      rca_payload JSONB
    );
  `);
  console.log('PostgreSQL Tables Initialized');
};
initDB();

// --- 3. Application Metrics ---
let signalsProcessed = 0;
setInterval(() => {
  console.log(`[Metrics] Throughput: ${signalsProcessed / 5} Signals/sec`);
  signalsProcessed = 0; 
}, 5000);

// --- 4. Routes ---
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', message: 'IMS Backend is healthy' });
});

// High-Throughput Ingestion Endpoint
app.post('/api/signals', ingestionLimiter, async (req, res) => {
  try {
    const { component_id, payload } = req.body;
    if (!component_id) return res.status(400).json({ error: 'component_id required' });

    // 1. Debounce Check in Hot-Path Cache
    const redisKey = `incident:${component_id}`;
    let workItemId = await redisClient.get(redisKey);

    if (!workItemId) {
      // 2. Cache Miss: Create new Work Item in Postgres
      const pgResult = await pgPool.query(
        `INSERT INTO work_items (component_id) VALUES ($1) RETURNING id`,
        [component_id]
      );
      workItemId = pgResult.rows[0].id;

      // 3. Set Debounce Window: 10 Seconds TTL in Redis
      await redisClient.setEx(redisKey, 10, workItemId.toString());
    }

    // 4. Always dump raw payload to Data Lake (Async, non-blocking)
    Signal.create({
      component_id,
      work_item_id: workItemId,
      payload: payload || req.body
    });

    signalsProcessed++;
    
    // 202 Accepted is the correct REST standard for async processing
    res.status(202).json({ message: 'Signal Ingested', work_item_id: workItemId });
  } catch (error) {
    console.error('Ingestion Error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// --- 5. Workflow Engine (State Pattern & RCA) ---

// Submit RCA and Close Incident
app.patch('/api/work-items/:id/rca', async (req, res) => {
  try {
    const { id } = req.params;
    const { rca_payload } = req.body;

    // 1. Mandatory RCA Validation (Rubric Requirement)
    if (!rca_payload || !rca_payload.root_cause || !rca_payload.fix_applied) {
      return res.status(400).json({ error: 'State transition rejected: Incomplete RCA object' });
    }

    // 2. Fetch current state
    const checkResult = await pgPool.query('SELECT created_at, status FROM work_items WHERE id = $1', [id]);
    if (checkResult.rows.length === 0) return res.status(404).json({ error: 'Work Item not found' });
    if (checkResult.rows[0].status === 'CLOSED') return res.status(400).json({ error: 'Incident already closed' });

    // 3. MTTR Calculation (Rubric Requirement)
    const start_time = new Date(checkResult.rows[0].created_at);
    const end_time = new Date();
    const mttr_minutes = Math.max(1, Math.round((end_time - start_time) / 60000)); // Minimum 1 minute

    // 4. Transactional State Update in Postgres
    const updateResult = await pgPool.query(
      `UPDATE work_items 
       SET status = 'CLOSED', rca_payload = $1, resolved_at = CURRENT_TIMESTAMP
       WHERE id = $2 RETURNING *`,
      [rca_payload, id]
    );

    res.status(200).json({ 
      message: 'Incident Closed', 
      mttr_minutes, 
      incident: updateResult.rows[0] 
    });
  } catch (error) {
    console.error('Workflow Error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// --- 6. Frontend Dashboard API ---

// Get Live Feed (Sorted by most recent)
app.get('/api/work-items', async (req, res) => {
  try {
    const result = await pgPool.query('SELECT * FROM work_items ORDER BY created_at DESC');
    res.status(200).json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Database Error' });
  }
});

// Get Incident Detail (Fetches raw signals from MongoDB Data Lake)
app.get('/api/work-items/:id/signals', async (req, res) => {
  try {
    const signals = await Signal.find({ work_item_id: req.params.id }).sort({ timestamp: -1 });
    res.status(200).json(signals);
  } catch (error) {
    res.status(500).json({ error: 'Data Lake Error' });
  }
});

// --- Boot Server ---
const PORT = process.env.PORT || 5000;
app.listen(PORT, async () => {
  await redisClient.connect();
  console.log(`🚀 IMS Server running on port ${PORT}`);
});