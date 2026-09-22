from typing import Optional
from app.models.packet import PacketData
from app.scheduler.base import SchedulerBase

class PriorityScheduler(SchedulerBase):
    def get_next_packet(self) -> Optional[PacketData]:
        # Strict priority: High > Medium > Low
        # Note: can cause starvation for low priority traffic if high is saturated.
        if not self.high_q.is_empty():
            return self.high_q.dequeue()
        elif not self.med_q.is_empty():
            return self.med_q.dequeue()
        elif not self.low_q.is_empty():
            return self.low_q.dequeue()
            
        return None
