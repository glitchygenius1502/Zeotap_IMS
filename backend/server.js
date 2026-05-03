const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { createClient } = require('redis');
const mongoose = require('mongoose');
const { Pool } = require('pg');

const app = express();
app.use(cors());
app.use(express.json());

// --- Database Connections ---

// 1. Redis (The Cache / Hot-Path)
const redisClient = createClient({ url: process.env.REDIS_URL });
redisClient.on('error', (err) => console.error('Redis Client Error', err));

// 2. MongoDB (The Data Lake)
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB Connected (Data Lake ready)'))
  .catch(err => console.error('MongoDB connection error:', err));

// 3. PostgreSQL (The Source of Truth)
const pgPool = new Pool({
  user: process.env.POSTGRES_USER,
  host: process.env.POSTGRES_HOST,
  database: process.env.POSTGRES_DB,
  password: process.env.POSTGRES_PASSWORD,
  port: process.env.POSTGRES_PORT,
});
pgPool.on('connect', () => console.log('PostgreSQL Connected (Source of Truth ready)'));

// --- Application Metrics (Rubric Requirement) ---
let signalsProcessed = 0;

// Print throughput metrics to the console every 5 seconds
setInterval(() => {
  console.log(`[Metrics] Throughput: ${signalsProcessed / 5} Signals/sec`);
  signalsProcessed = 0; // Reset counter
}, 5000);

// --- Routes ---

// Mandatory Observability Endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', message: 'IMS Backend is healthy' });
});

// Placeholder for our high-throughput ingestion route
app.post('/api/signals', async (req, res) => {
  // We will build the debouncing logic here next!
  signalsProcessed++;
  res.status(202).json({ message: 'Signal Accepted' });
});

// --- Boot Server ---
const PORT = process.env.PORT || 5000;
app.listen(PORT, async () => {
  await redisClient.connect();
  console.log(`Redis Connected (Hot-Path ready)`);
  console.log(`🚀 IMS Server running on port ${PORT}`);
});