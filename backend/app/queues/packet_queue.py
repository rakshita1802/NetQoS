import asyncio
import time
from collections import deque
from app.models.packet import PacketData

class PacketQueue:
    def __init__(self, name: str, priority_level: int):
        self.name = name
        self.priority_level = priority_level
        self.queue = deque()
        
        # Stats
        self.packets_processed = 0
        self.packets_dropped = 0
        self.bytes_waiting = 0
        self.total_wait_time = 0.0
        self.max_wait_time = 0.0

    def enqueue(self, pkt: PacketData):
        self.queue.append((pkt, time.time()))
        self.bytes_waiting += len(pkt.payload)

    def dequeue(self):
        if not self.queue:
            return None
            
        pkt, enqueue_time = self.queue.popleft()
        self.bytes_waiting -= len(pkt.payload)
        
        wait_time = time.time() - enqueue_time
        self.total_wait_time += wait_time
        if wait_time > self.max_wait_time:
            self.max_wait_time = wait_time
            
        self.packets_processed += 1
        return pkt

    def __len__(self):
        return len(self.queue)
        
    def is_empty(self):
        return len(self.queue) == 0

    def get_avg_wait_time(self):
        if self.packets_processed == 0:
            return 0.0
        return self.total_wait_time / self.packets_processed

    def get_stats(self):
        return {
            "name": self.name,
            "length": len(self.queue),
            "bytes_waiting": self.bytes_waiting,
            "packets_processed": self.packets_processed,
            "packets_dropped": self.packets_dropped,
            "avg_wait_time": self.get_avg_wait_time(),
            "max_wait_time": self.max_wait_time
        }
