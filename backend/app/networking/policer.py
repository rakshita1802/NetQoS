import time

class TokenBucketPolicer:
    def __init__(self, rate_bps: float, capacity_bytes: int):
        self.rate_bps = rate_bps
        self.capacity_bytes = capacity_bytes
        self.tokens = capacity_bytes
        self.last_update = time.time()
        self.enabled = False

    def allow_packet(self, packet_size_bytes: int) -> bool:
        if not self.enabled:
            return True
            
        now = time.time()
        elapsed = now - self.last_update
        
        # Replenish tokens based on elapsed time (bits to bytes)
        replenish_bytes = (elapsed * self.rate_bps) / 8.0
        self.tokens = min(self.capacity_bytes, self.tokens + replenish_bytes)
        self.last_update = now
        
        if self.tokens >= packet_size_bytes:
            self.tokens -= packet_size_bytes
            return True
        else:
            return False
            
    def set_enabled(self, enabled: bool):
        self.enabled = enabled
        if enabled:
            # Reset bucket on enable
            self.last_update = time.time()
            self.tokens = self.capacity_bytes
