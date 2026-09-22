from typing import Optional
from app.models.packet import PacketData
from app.scheduler.base import SchedulerBase

class FIFOScheduler(SchedulerBase):
    def get_next_packet(self) -> Optional[PacketData]:
        # For true FIFO across multiple queues, we need to compare enqueue timestamps.
        # But since all packets are funneled into these queues by the classifier, 
        # we can just peek at the oldest packet across all queues.
        
        oldest_pkt = None
        oldest_time = float('inf')
        selected_q = None
        
        for q in self.queues:
            if not q.is_empty():
                pkt, enqueue_time = q.queue[0] # peek
                if enqueue_time < oldest_time:
                    oldest_time = enqueue_time
                    selected_q = q
                    oldest_pkt = pkt
                    
        if selected_q:
            return selected_q.dequeue()
        return None
