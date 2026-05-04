# Mission-Critical Incident Management System (IMS)

An enterprise-grade, highly concurrent Incident Management System designed to ingest, debounce, and manage high-volume telemetry signals from distributed architectures. 

## 🏗️ Architecture Diagram

```text
[ Incoming Signals ] (up to 10k/sec)
        │
        ▼
┌───────────────────────────────────────────┐
│           INGESTION API (Node.js)         │
│  • Express Rate Limiter                   │
│  • AlertNotifier (Strategy Pattern)       │
│  • IncidentWorkflow (State Pattern)       │
└───────┬──────────────────────┬────────────┘
        │                      │
        ▼                      ▼
┌───────────────┐      ┌───────────────┐     ┌───────────────┐
│     REDIS     │      │   PostgreSQL  │     │    MongoDB    │
│  (The Cache)  │      │(Source Truth) │     │  (Data Lake)  │
│               │      │               │     │               │
│ • Hot-Path UI │      │ • Work Items  │     │ • Raw Signals │
│ • NX Locks    │      │ • RCA Payloads│     │ • Audit Log   │
│ • Debouncing  │      │ • Status State│     │ • Timeseries  │
└───────┬───────┘      └───────┬───────┘     └───────┬───────┘
        │                      │                     │
        └───────────────┬──────┴─────────────────────┘
                        ▼
            ┌───────────────────────┐
            │ FRONTEND UI (React)   │
            │ • Real-time Live Feed │
            │ • RCA Workflow Engine │
            │ • Severity Sorting    │
            └───────────────────────┘
```

## 🚀 Setup Instructions

This system is containerized for seamless deployment.

**1. Start the Distributed Infrastructure**
```bash
docker compose up -d
```
*Spins up PostgreSQL (5432), MongoDB (27017), and Redis (6379).*

**2. Boot the Backend Engine**
Open a terminal in the root directory:
```bash
cd backend
npm install
npm run dev
```
*The ingestion server runs on `http://localhost:5000`.*

**3. Boot the Mission Control Dashboard**
Open a second terminal:
```bash
cd frontend
npm install
npm run dev
```
*The React UI runs on `http://localhost:5173`. Powered by Vite and Tailwind CSS v4.*

---

## 🌊 Engineering Challenge: Handling Backpressure & Concurrency

In a distributed failure (e.g., an RDBMS cluster goes down), the system will experience a "thundering herd" of signals from cascading component failures. If unhandled, this exhausts the Node.js event loop and crashes the PostgreSQL connection pool.

**Our Multi-Tiered Backpressure Strategy:**
1. **API Edge Rate Limiting:** We utilize `express-rate-limit` to act as a shock-absorber, preventing runaway scripts from overwhelming the Node server.
2. **The Concurrency Lock (Redis NX):** When 100 signals hit simultaneously for the same failing component, they cause a race condition where 100 Node threads attempt to `INSERT` a Work Item into PostgreSQL at the exact same millisecond. We solve this using a Distributed Lock via Redis `NX` (Set if Not Exists). The first signal acquires the lock and writes to Postgres. The other 99 requests are temporarily suspended in a `while` loop (polling every 50ms) until the Postgres transaction finishes, at which point they safely link to the newly created Work Item ID. This successfully debounces 100 signals into a single database row.
3. **Database Resiliency Wrapper:** If the PostgreSQL pool is temporarily exhausted, an exponential backoff wrapper (`withDBRetry`) catches the transaction failure and retries it up to 3 times before failing the request.

---

## 🧪 Testing the System

### 1. The Catastrophic Failure Mock
To prove the debouncing and ingestion capabilities, run the provided mock script from the root directory while the server is running:
```bash
node mock_event.js
```
This simulates a cascading failure (an RDBMS crash followed by 50 rapid-fire MCP Host errors). Watch the terminal for throughput metrics and P0/P2 strategy alerts, and watch the UI automatically update.

### 2. Unit Testing
We implemented robust unit testing using Jest to validate the RCA State Pattern.
```bash
cd backend
npm test
```

## 📐 Design Patterns Utilized
* **Strategy Pattern:** Dynamically swaps Alert Logic (`P0AlertStrategy` vs `P2AlertStrategy`) based on the component type.
* **State Pattern:** Tightly controls workflow transitions, ensuring a Work Item cannot transition to `CLOSED` without passing strict validation criteria (Mandatory RCA).