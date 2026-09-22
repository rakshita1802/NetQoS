from abc import ABC, abstractmethod
from typing import Optional, List
from app.models.packet import PacketData
from app.queues.packet_queue import PacketQueue

class SchedulerBase(ABC):
    def __init__(self, high_q: PacketQueue, med_q: PacketQueue, low_q: PacketQueue):
        self.high_q = high_q
        self.med_q = med_q
        self.low_q = low_q
        self.queues = [self.high_q, self.med_q, self.low_q]

    @abstractmethod
    def get_next_packet(self) -> Optional[PacketData]:
        """Returns the next packet to be transmitted, based on scheduling algorithm."""
        pass

    def get_stats(self):
        return {
            "type": self.__class__.__name__,
            "queues": [q.get_stats() for q in self.queues]
        }
