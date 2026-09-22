from typing import Optional
from app.models.packet import PacketData
from app.scheduler.base import SchedulerBase
from app.queues.packet_queue import PacketQueue

class WFQScheduler(SchedulerBase):
    def __init__(self, high_q: PacketQueue, med_q: PacketQueue, low_q: PacketQueue):
        super().__init__(high_q, med_q, low_q)
        
        # Default weights
        self.weights = {
            self.high_q: 50,
            self.med_q: 30,
            self.low_q: 20
        }
        
        self.deficits = {
            self.high_q: 0,
            self.med_q: 0,
            self.low_q: 0
        }
        
        self.quantum = 100 # Base bytes to add per round
        self.current_queue_idx = 0

    def set_weights(self, high: int, med: int, low: int):
        self.weights[self.high_q] = high
        self.weights[self.med_q] = med
        self.weights[self.low_q] = low
        
    def get_weights(self):
        return {
            "HIGH": self.weights[self.high_q],
            "MEDIUM": self.weights[self.med_q],
            "LOW": self.weights[self.low_q]
        }

    def get_next_packet(self) -> Optional[PacketData]:
        # Implementation of Deficit Round Robin (DRR) to achieve WFQ
        # Ensure we don't infinite loop if all queues are empty
        if all(q.is_empty() for q in self.queues):
            return None
            
        loop_count = 0
        while loop_count < len(self.queues) * 2: # Prevent infinite loop
            q = self.queues[self.current_queue_idx]
            
            if not q.is_empty():
                pkt, _ = q.queue[0] # Peek
                packet_size = len(pkt.payload) + 16 # roughly
                
                if self.deficits[q] >= packet_size:
                    self.deficits[q] -= packet_size
                    return q.dequeue()
            else:
                self.deficits[q] = 0 # reset deficit for empty queues
                
            # Move to next queue
            self.current_queue_idx = (self.current_queue_idx + 1) % len(self.queues)
            
            # If we wrapped around, add quantum to all active queues
            if self.current_queue_idx == 0:
                for active_q in self.queues:
                    if not active_q.is_empty():
                        self.deficits[active_q] += self.weights[active_q] * self.quantum
                        
            loop_count += 1

        return None
