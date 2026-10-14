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

        # Determine protocol & application metadata
        if pkt.flow_id == 998:
            proto = "UDP"
            src_port = 9001
            dst_port = 9006
            app_proto = "MJPEG Video Stream (RTP payload)"
            app_preview = f"JPEG Frame Payload ({len(pkt.payload):,} bytes)"
        elif pkt.flow_id == 997:
            proto = "UDP"
            src_port = 9002
            dst_port = 8000
            app_proto = "Interactive Real-Time Messaging"
            app_preview = f'"{pkt.payload.decode("utf-8", errors="ignore")[:35]}"'
        elif pkt.flow_id == 999:
            proto = "TCP"
            src_port = 9003
            dst_port = 9005
            app_proto = "Bulk File Transfer (S3 / AirDrop)"
            app_preview = f"Binary File Block ({len(pkt.payload):,} bytes)"
        else:
            proto = "TCP" if (pkt.flow_id % 2 == 1) else "UDP"
            src_port = 10000 + (pkt.flow_id % 100)
            dst_port = 8000
            app_proto = "Synthetic Congestion Stream"
            app_preview = f"Payload Chunk ({len(pkt.payload)} bytes)"

        raw_header = pkt.to_bytes()[:32]
        hex_dump = raw_header.hex(' ').upper()

        self.recent_logs.appendleft({
            "type": "FWD",
            "flow_id": pkt.flow_id,
            "seq_num": pkt.seq_num,
            "size": packet_size,
            "latency_ms": round(latency * 1000, 2),
            "protocol": proto,
            "src_ip": "127.0.0.1",
            "dst_ip": "127.0.0.1",
            "src_port": src_port,
            "dst_port": dst_port,
            "ttl": 64,
            "app_proto": app_proto,
            "app_preview": app_preview,
            "hex_dump": hex_dump
        })
        
        # Simulate TCP Acknowledgement for standard traffic (flow_ids 1-100)
        if pkt.flow_id < 900 and self.total_packets % 5 == 0:
            ack_raw = b'\x45\x00\x00\x28' + pkt.flow_id.to_bytes(2, 'big') + b'\x40\x00\x40\x06\x00\x00\x7f\x00\x00\x01\x7f\x00\x00\x01' + (pkt.seq_num + 1).to_bytes(4, 'big')
            self.recent_logs.appendleft({
                "type": "TCP_ACK",
                "flow_id": pkt.flow_id,
                "seq_num": pkt.seq_num,
                "ack_num": pkt.seq_num + 1,
                "size": 64,
                "latency_ms": round((latency * 1000) + 2.5, 2),
                "protocol": "TCP",
                "src_ip": "127.0.0.1",
                "dst_ip": "127.0.0.1",
                "src_port": 8000,
                "dst_port": src_port,
                "ttl": 64,
                "window_size": 65535,
                "flags": "ACK",
                "app_proto": "TCP Control Frame",
                "app_preview": f"ACK={pkt.seq_num + 1} WIN=65535",
                "hex_dump": ack_raw.hex(' ').upper()
            })

    def record_drop(self, pkt_size=0, flow_id=0, seq_num=0):
        self.packet_loss_count += 1
        proto = "UDP" if flow_id in (997, 998) else "TCP"
        self.recent_logs.appendleft({
            "type": "DROP",
            "flow_id": flow_id,
            "seq_num": seq_num,
            "size": pkt_size,
            "latency_ms": 0,
            "protocol": proto,
            "src_ip": "127.0.0.1",
            "dst_ip": "127.0.0.1",
            "src_port": 9001 if flow_id == 998 else 9000,
            "dst_port": 8000,
            "ttl": 64,
            "flags": "DROP",
            "app_proto": "Policed Ingress Packet",
            "app_preview": "Dropped by Token Bucket (Rate Limit Exceeded)",
            "hex_dump": "45 00 00 00 00 00 40 11 00 00 7F 00 00 01 7F 00 00 01"
        })
        
        # Simulate TCP Retransmission state if packet is lost
        if flow_id < 900:
            self.recent_logs.appendleft({
                "type": "TCP_RETRY",
                "flow_id": flow_id,
                "seq_num": seq_num,
                "size": pkt_size,
                "latency_ms": 0,
                "protocol": "TCP",
                "src_ip": "127.0.0.1",
                "dst_ip": "127.0.0.1",
                "src_port": 10000 + (flow_id % 100),
                "dst_port": 8000,
                "ttl": 64,
                "flags": "SYN/RETRY",
                "app_proto": "TCP Retransmission",
                "app_preview": "Retransmit Seq=" + str(seq_num) + " after loss",
                "hex_dump": "45 00 00 34 00 00 40 06 00 00 7F 00 00 01 7F 00 00 01"
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
