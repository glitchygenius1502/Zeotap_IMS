# AI Prompt Engineering History

*The following is a log of the structured prompts used to accelerate the development of the Mission-Critical IMS, demonstrating an intentional, architecture-first approach to LLM collaboration.*

### Phase 1: Backend Architecture & Patterns
**Prompt 1:** "Act as a pair-programmer. Let's build the backend architecture for our IMS in steps. First, implement the Strategy Pattern for P0/P2 alerts, the State Pattern for the RCA workflow validation, and an automatic database retry wrapper for resilience. We also need a Redis Hot-Path cache for the dashboard feed."

**Prompt 2:** "The architecture patterns are implemented. Next, provide the Jest unit tests for the RCA validation logic and write a Node.js script to mock a cascading stack failure (RDBMS outage followed by MCP failures) so we can load-test the ingestion engine."

**Prompt 3:** "Review our `server.js` implementation against the original assignment specification to ensure strict compliance. Identify any missing edge cases, specifically focusing on workflow state transitions (OPEN -> INVESTIGATING) and timeseries aggregations for the data lake."

### Phase 2: Frontend Dashboard & UX
**Prompt 4:** "Initialize a React frontend using Vite and Tailwind CSS. The design language must be premium, dark-mode, and enterprise-grade (similar to Datadog or PagerDuty). Instead of a standard modal, implement a right-side slide-over drawer to handle the Incident Audit Logs and the RCA form."

**Prompt 5:** "We encountered a version conflict: Vite v6 requires Node.js v20.19+, but the current environment is v20.17. Provide the terminal commands to safely wipe the cache and downgrade Vite to v5 to avoid environment disruption."

**Prompt 6:** "Tailwind v4 handles configuration differently and is throwing unknown utility class errors because it's ignoring the v3 config file. Provide the updated `@theme` syntax for `index.css` to fix the brand colors."

### Phase 3: Concurrency & Backpressure
**Prompt 7:** "During load testing, the mock script triggered a race condition: 50 simultaneous requests exhausted the PostgreSQL connection pool. Implement a Distributed Concurrency Lock using Redis `NX` (Set if Not Exists) to debounce the requests, holding 49 of them in a 50ms polling loop while the first request completes the database transaction."

**Prompt 8:** "Conduct a final audit of the frontend React application against the rubric. Add the missing start/end date-time pickers to the RCA form and modify the SQL query to ensure the incident feed sorts by Severity (P0 first) rather than just chronological order."

### Phase 4: Documentation
**Prompt 9:** "Generate a comprehensive README.md. It must include an ASCII architecture diagram, Docker Compose setup instructions, and a detailed explanation of our multi-tiered backpressure strategy (Express Rate Limiting + Redis Locks + Exponential Backoff)."