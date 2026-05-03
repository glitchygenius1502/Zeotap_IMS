// mock_event.js
const API_URL = 'http://localhost:5000/api/signals';

const fireSignal = async (component_id, payload) => {
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ component_id, payload })
    });
    console.log(`[${res.status}] Signal fired for ${component_id}`);
  } catch (err) {
    console.error('Failed to hit API (Is the server running?)');
  }
};

const simulateCatastrophicFailure = async () => {
  console.log("🔥 INITIATING CASCADING FAILURE SIMULATION 🔥\n");

  // 1. RDBMS Outage (Triggers P0 Alert)
  console.log(">> Simulating CORE_RDBMS_PRIMARY Outage...");
  await fireSignal('CORE_RDBMS_PRIMARY', { error: 'Connection Refused', severity: 'CRITICAL' });
  await fireSignal('CORE_RDBMS_PRIMARY', { error: 'Connection Refused', severity: 'CRITICAL' });
  
  // 2. Wait 2 seconds...
  await new Promise(r => setTimeout(r, 2000));

  // 3. MCP Host fails due to DB timeout (Triggers P2 Alert)
  console.log("\n>> Simulating cascading MCP_HOST_01 failures (Debounce test - firing 50 rapid signals)...");
  for(let i=0; i<50; i++) {
    fireSignal('MCP_HOST_01', { error: 'DB Timeout', latency_ms: 5000 + i });
  }
};

simulateCatastrophicFailure();