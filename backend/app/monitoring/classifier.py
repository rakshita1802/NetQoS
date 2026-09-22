from typing import Dict
from app.models.packet import PacketData
from app.queues.packet_queue import PacketQueue

class TrafficClassifier:
    def __init__(self, high_q: PacketQueue, med_q: PacketQueue, low_q: PacketQueue):
        self.high_q = high_q
        self.med_q = med_q
        self.low_q = low_q
        
        # flow_id -> priority map (user configurable, default based on rule)
        self.flow_priority_map: Dict[int, str] = {}

    def classify_and_enqueue(self, pkt: PacketData, protocol: str):
        # Allow override via explicit flow priorities
        priority = self.flow_priority_map.get(pkt.flow_id)
        
        if not priority:
            # Basic rule:
            # UDP is generally latency sensitive -> HIGH
            # TCP is interactive/bulk -> default MEDIUM
            if protocol == "UDP":
                priority = "HIGH"
            else:
                priority = "MEDIUM"
                
        if priority == "HIGH":
            self.high_q.enqueue(pkt)
        elif priority == "LOW":
            self.low_q.enqueue(pkt)
        else:
            self.med_q.enqueue(pkt)
            
    def set_flow_priority(self, flow_id: int, priority: str):
        self.flow_priority_map[flow_id] = priority.upper()
