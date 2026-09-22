import time
from app.scheduler.wfq import WFQScheduler
from app.queues.packet_queue import PacketQueue

class AdaptiveScheduler(WFQScheduler):
    def __init__(self, high_q: PacketQueue, med_q: PacketQueue, low_q: PacketQueue):
        super().__init__(high_q, med_q, low_q)
        self.last_adaptation_time = time.time()
        self.adaptation_interval = 1.0 # Evaluate every 1 second
        self.last_adaptation_reason = "Initialized"
        
        # Save baseline
        self.baseline_high = 50
        self.baseline_med = 30
        self.baseline_low = 20

    def get_next_packet(self):
        self._adapt()
        return super().get_next_packet()
        
    def _adapt(self):
        current_time = time.time()
        if current_time - self.last_adaptation_time < self.adaptation_interval:
            return
            
        self.last_adaptation_time = current_time
        
        # Check High queue latency and size
        high_latency = self.high_q.get_avg_wait_time()
        high_len = len(self.high_q)
        
        # Simple rule: if high queue is getting backed up or latency > 100ms
        if high_latency > 0.1 or high_len > 50:
            # Increase high weight
            new_high = min(80, self.weights[self.high_q] + 10)
            diff = new_high - self.weights[self.high_q]
            if diff > 0:
                # Steal from low and med
                new_low = max(5, self.weights[self.low_q] - diff//2)
                new_med = 100 - new_high - new_low
                self.set_weights(new_high, new_med, new_low)
                self.last_adaptation_reason = f"High queue latency/length exceeded threshold. HIGH weight increased to {new_high}%"
                
        elif high_latency < 0.05 and high_len < 10 and self.weights[self.high_q] > self.baseline_high:
            # Relax back towards baseline
            self.set_weights(self.baseline_high, self.baseline_med, self.baseline_low)
            self.last_adaptation_reason = "Network conditions normalized. Restored baseline weights."

    def get_stats(self):
        stats = super().get_stats()
        stats["last_adaptation_reason"] = self.last_adaptation_reason
        return stats
