import time
from collections import deque
from app.models.packet import PacketData

class MetricsEngine:
    def __init__(self):
        self.start_time = time.time()
        self.history_window = 10.0 # seconds
        
        # We store (timestamp, bytes, latency)
        self.transmission_history = deque()
        self.total_packets = 0
        self.total_bytes = 0
        self.total_latency = 0.0
        
        self.current_throughput = 0.0 # bps
        self.current_latency = 0.0
        self.current_jitter = 0.0
        
        self.last_latency = 0.0
        self.jitter_accumulator = 0.0
        
        self.packet_loss_count = 0
        self.recent_logs = deque(maxlen=20)
        
    def record_transmission(self, pkt: PacketData):
        current_time = time.time()
        latency = current_time - pkt.timestamp
        packet_size = len(pkt.payload) + 16
        
        self.transmission_history.append((current_time, packet_size, latency))
        self.total_packets += 1
        self.total_bytes += packet_size
        self.total_latency += latency
        
        # Calculate Jitter
        if self.total_packets > 1:
            self.jitter_accumulator += abs(latency - self.last_latency)
            self.current_jitter = self.jitter_accumulator / (self.total_packets - 1)
            
        self.last_latency = latency
        self.cleanup_old_history(current_time)
        
        self.recent_logs.appendleft({
            "type": "FWD",
            "flow_id": pkt.flow_id,
            "size": packet_size,
            "latency_ms": round(latency * 1000, 2)
        })
        
        # Simulate TCP Acknowledgement for standard traffic (flow_ids 1-100)
        if pkt.flow_id < 900 and self.total_packets % 5 == 0:
            self.recent_logs.appendleft({
                "type": "TCP_ACK",
                "flow_id": pkt.flow_id,
                "size": 64,
                "latency_ms": round((latency * 1000) + 2.5, 2)
            })

    def record_drop(self, pkt_size=0, flow_id=0):
        self.packet_loss_count += 1
        self.recent_logs.appendleft({
            "type": "DROP",
            "flow_id": flow_id,
            "size": pkt_size,
            "latency_ms": 0
        })
        
        # Simulate TCP Retransmission state if packet is lost
        if flow_id < 900:
            self.recent_logs.appendleft({
                "type": "TCP_RETRY",
                "flow_id": flow_id,
                "size": 0,
                "latency_ms": 0
            })

    def cleanup_old_history(self, current_time: float):
        while self.transmission_history and (current_time - self.transmission_history[0][0]) > self.history_window:
            self.transmission_history.popleft()

    def update_metrics(self):
        current_time = time.time()
        self.cleanup_old_history(current_time)
        
        if not self.transmission_history:
            self.current_throughput = 0.0
            self.current_latency = 0.0
            return
            
        # Throughput over the window
        bytes_in_window = sum(item[1] for item in self.transmission_history)
        window_duration = current_time - self.transmission_history[0][0]
        if window_duration <= 0.01:
            window_duration = 0.01
            
        self.current_throughput = (bytes_in_window * 8) / window_duration # bits per second
        
        # Latency in window
        latency_in_window = sum(item[2] for item in self.transmission_history)
        self.current_latency = latency_in_window / len(self.transmission_history)

    def get_stats(self):
        self.update_metrics()
        
        total_attempted = self.total_packets + self.packet_loss_count
        loss_rate = (self.packet_loss_count / total_attempted) if total_attempted > 0 else 0.0
        
        return {
            "throughput_bps": self.current_throughput,
            "latency_s": self.current_latency,
            "jitter_s": self.current_jitter,
            "packet_loss_rate": loss_rate,
            "total_packets": self.total_packets,
            "total_dropped": self.packet_loss_count,
            "recent_logs": list(self.recent_logs)
        }
