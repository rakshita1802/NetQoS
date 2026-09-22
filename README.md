# NetQoS — Adaptive Packet Scheduling and Quality of Service Management

NetQoS is a software-based network traffic management and packet scheduling system that generates actual TCP/UDP traffic flows, classifies them into queues, and demonstrates how different scheduling algorithms process and transmit packets. 

The core feature is the **Adaptive Packet Queue Scheduler**, which dynamically allocates bandwidth among competing flows under changing network conditions, adjusting scheduling decisions to prevent latency spikes in high-priority traffic.

## Objectives
- Generate real TCP and UDP socket traffic.
- Classify flows into Priority Queues (High, Medium, Low).
- Implement multiple Packet Scheduling Algorithms (FIFO, Priority, WFQ, Adaptive).
- Dynamically adapt WFQ scheduling weights based on real-time latency and queue size.
- Visualize QoS metrics in real-time through a React/WebSocket Dashboard.

## Architecture
1. **Traffic Generator**: Creates synthetic TCP/UDP payloads with application-layer headers containing timestamps and sequence numbers.
2. **Traffic Receiver**: Listens for socket connections and routes incoming packets to the Classifier.
3. **Traffic Classifier**: Places UDP in HIGH Queue, interactive TCP in MEDIUM Queue, and bulk TCP in LOW Queue.
4. **Schedulers**: Pull packets from queues and simulate output transmission constraints.
5. **Metrics Engine**: Analyzes timestamps to calculate Throughput, Latency, Jitter, and Packet Loss.

## How Packet Scheduling Works
- **FIFO (First In First Out)**: Transmits packets strictly based on when they entered the system.
- **Priority**: Strictly empties the High queue before processing Medium, and Medium before Low.
- **Weighted Fair Queuing (WFQ)**: Uses Deficit Round Robin to allocate proportional service slices to each queue based on weights (e.g., 50/30/20).
- **Adaptive Scheduling**: Monitors the High Queue. If latency exceeds thresholds, it automatically rebalances the WFQ weights to save the High priority traffic from congestion.

## Running the Project

### Start the Backend (FastAPI + Sockets)
```bash
cd backend
python -m venv venv
# Activate venv: .\venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

### Start the Frontend (React + Vite)
```bash
cd frontend
npm install
npm run dev
```

Navigate to `http://localhost:5173` to interact with the Live Dashboard. You can spawn traffic flows and watch the scheduler algorithms react dynamically.
