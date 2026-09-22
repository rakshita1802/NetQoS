import struct
import time
from dataclasses import dataclass
from typing import Optional

# Packet format:
# [Header: 16 bytes]
# - timestamp: double (8 bytes)
# - flow_id: int (4 bytes)
# - seq_num: int (4 bytes)
# [Payload: variable length]

PACKET_HEADER_FORMAT = "!dII"
HEADER_SIZE = struct.calcsize(PACKET_HEADER_FORMAT)

@dataclass
class PacketData:
    timestamp: float
    flow_id: int
    seq_num: int
    payload: bytes
    
    def to_bytes(self) -> bytes:
        header = struct.pack(PACKET_HEADER_FORMAT, self.timestamp, self.flow_id, self.seq_num)
        return header + self.payload

    @classmethod
    def from_bytes(cls, data: bytes) -> Optional['PacketData']:
        if len(data) < HEADER_SIZE:
            return None
        header = data[:HEADER_SIZE]
        payload = data[HEADER_SIZE:]
        timestamp, flow_id, seq_num = struct.unpack(PACKET_HEADER_FORMAT, header)
        return cls(timestamp=timestamp, flow_id=flow_id, seq_num=seq_num, payload=payload)

def create_packet(flow_id: int, seq_num: int, payload_size: int) -> bytes:
    # Subtract header size to get exact requested size if possible, else 0 length payload
    actual_payload_size = max(0, payload_size - HEADER_SIZE)
    payload = b'A' * actual_payload_size
    pkt = PacketData(timestamp=time.time(), flow_id=flow_id, seq_num=seq_num, payload=payload)
    return pkt.to_bytes()
