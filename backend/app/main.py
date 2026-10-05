import asyncio
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from app.queues.packet_queue import PacketQueue
from app.monitoring.classifier import TrafficClassifier
from app.scheduler.fifo import FIFOScheduler
from app.scheduler.priority import PriorityScheduler
from app.scheduler.wfq import WFQScheduler
from app.scheduler.adaptive import AdaptiveScheduler
from app.scheduler.ml_adaptive import MLPredictiveScheduler
from app.networking.receiver import TrafficReceiver
from app.networking.traffic_generator import traffic_generator
from app.networking.policer import TokenBucketPolicer
from app.metrics.engine import MetricsEngine
from app.db import init_db, insert_metric, get_historical_metrics

app = FastAPI(title="NetQoS API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global State
high_q = PacketQueue("HIGH", 1)
med_q = PacketQueue("MEDIUM", 2)
low_q = PacketQueue("LOW", 3)

classifier = TrafficClassifier(high_q, med_q, low_q)
metrics_engine = MetricsEngine()

schedulers = {
    "FIFO": FIFOScheduler(high_q, med_q, low_q),
    "Priority": PriorityScheduler(high_q, med_q, low_q),
    "WFQ": WFQScheduler(high_q, med_q, low_q),
    "Adaptive": AdaptiveScheduler(high_q, med_q, low_q),
    "Predictive ML": MLPredictiveScheduler(high_q, med_q, low_q)
}
current_scheduler_name = "FIFO"
current_scheduler = schedulers[current_scheduler_name]

# Bandwidth limit for the output link (e.g., 100 Mbps = 12.5 MB/s)
# Used to calculate transmission delay
OUTPUT_BANDWIDTH_BPS = 100 * 1024 * 1024

# Policer limit: 1 Mbps, 100KB burst capacity
policer = TokenBucketPolicer(rate_bps=1_000_000, capacity_bytes=100_000)

def packet_received_callback(pkt, protocol):
    packet_size = len(pkt.payload) + 16
    if not policer.allow_packet(packet_size):
        metrics_engine.record_drop()
        return
    classifier.classify_and_enqueue(pkt, protocol)

receiver = TrafficReceiver("127.0.0.1", 9000, 9001, packet_received_callback)
scheduler_task = None
db_logger_task = None

async def db_logger_loop():
    while True:
        stats = metrics_engine.get_stats()
        insert_metric(
            throughput=stats['throughput_mbps'],
            latency=stats['avg_latency_ms'],
            jitter=stats['jitter_ms'],
            packet_loss=stats['packet_loss_percent']
        )
        await asyncio.sleep(1.0) # Log every 1 second

async def scheduler_loop():
    while True:
        pkt = current_scheduler.get_next_packet()
        if pkt:
            metrics_engine.record_transmission(pkt)
            # Simulate transmission delay to enforce output bandwidth
            packet_size_bits = (len(pkt.payload) + 16) * 8
            delay = packet_size_bits / OUTPUT_BANDWIDTH_BPS
            if delay > 0:
                await asyncio.sleep(delay)
        else:
            await asyncio.sleep(0.001) # Avoid busy waiting if queues are empty

@app.on_event("startup")
async def startup_event():
    init_db()
    await receiver.start()
    global scheduler_task, db_logger_task
    scheduler_task = asyncio.create_task(scheduler_loop())
    db_logger_task = asyncio.create_task(db_logger_loop())

@app.on_event("shutdown")
async def shutdown_event():
    await receiver.stop()
    if scheduler_task:
        scheduler_task.cancel()
    if db_logger_task:
        db_logger_task.cancel()
    traffic_generator.stop_all()

# --- REST APIs ---

class StartTrafficRequest(BaseModel):
    flow_id: int
    protocol: str
    rate: int
    packet_size: int
    duration: int
    priority: str = "" # Optional override

@app.post("/api/traffic/start")
async def start_traffic(req: StartTrafficRequest):
    if req.priority:
        classifier.set_flow_priority(req.flow_id, req.priority)
    traffic_generator.start_flow(req.flow_id, req.protocol, req.rate, req.packet_size, req.duration)
    return {"status": "started", "flow_id": req.flow_id}

@app.post("/api/traffic/stop/{flow_id}")
async def stop_traffic(flow_id: int):
    traffic_generator.stop_flow(flow_id)
    return {"status": "stopped", "flow_id": flow_id}

@app.post("/api/traffic/stop_all")
async def stop_all_traffic():
    traffic_generator.stop_all()
    return {"status": "stopped_all"}

class SchedulerSelectRequest(BaseModel):
    algorithm: str

@app.post("/api/scheduler/select")
async def select_scheduler(req: SchedulerSelectRequest):
    global current_scheduler_name, current_scheduler
    if req.algorithm in schedulers:
        current_scheduler_name = req.algorithm
        current_scheduler = schedulers[current_scheduler_name]
        return {"status": "success", "algorithm": req.algorithm}
    return {"status": "error", "message": "Unknown algorithm"}, 400

class PolicerRequest(BaseModel):
    enabled: bool

@app.post("/api/firewall/toggle")
async def toggle_firewall(req: PolicerRequest):
    policer.set_enabled(req.enabled)
    return {"status": "success", "enabled": req.enabled}

@app.get("/api/status")
async def get_status():
    return {
        "scheduler": current_scheduler_name,
        "scheduler_stats": current_scheduler.get_stats(),
        "metrics": metrics_engine.get_stats(),
        "active_flows": list(traffic_generator.active_flows.keys()),
        "firewall_enabled": policer.enabled
    }

@app.get("/api/metrics/history")
async def get_history(limit: int = 100):
    return get_historical_metrics(limit)

# --- WebSockets ---
@app.websocket("/ws/metrics")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            data = {
                "scheduler": current_scheduler_name,
                "scheduler_stats": current_scheduler.get_stats(),
                "metrics": metrics_engine.get_stats(),
                "active_flows": list(traffic_generator.active_flows.keys()),
                "firewall_enabled": policer.enabled
            }
            await websocket.send_json(data)
            await asyncio.sleep(0.5) # 2 Hz update rate
    except WebSocketDisconnect:
        print("WebSocket client disconnected")
