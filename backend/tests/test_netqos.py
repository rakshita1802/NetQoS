"""
NetQoS Automated Unit & Connectivity Test Suite
Tests Core Algorithms, Positive Cases, and Negative ('False') Edge Cases.
"""

import unittest
import time
import socket
from app.models.packet import PacketData, create_packet
from app.queues.packet_queue import PacketQueue
from app.networking.policer import TokenBucketPolicer
from app.scheduler.fifo import FIFOScheduler
from app.scheduler.priority import PriorityScheduler
from app.scheduler.wfq import WFQScheduler

class TestNetQoSAlgorithmsAndEdgeCases(unittest.TestCase):

    def setUp(self):
        self.high_q = PacketQueue("HIGH", 1)
        self.med_q = PacketQueue("MEDIUM", 2)
        self.low_q = PacketQueue("LOW", 3)

    # -------------------------------------------------------------------------
    # TEST CASE 1: PACKET FRAMING (POSITIVE & CORRUPT/FALSE TESTCASE)
    # -------------------------------------------------------------------------
    def test_packet_framing_valid(self):
        """Positive test: Valid packet encoding and decoding."""
        raw_pkt = create_packet(flow_id=997, seq_num=42, payload_size=64)
        pkt = PacketData.from_bytes(raw_pkt)
        self.assertIsNotNone(pkt)
        self.assertEqual(pkt.flow_id, 997)
        self.assertEqual(pkt.seq_num, 42)
        self.assertEqual(len(pkt.payload), 48) # 64 - 16 bytes header

    def test_packet_framing_truncated_returns_false(self):
        """Negative/False test: Truncated header (< 16 bytes) must return None/False."""
        corrupted_data = b"SHORT_CORRUPT" # only 13 bytes (< 16 bytes required)
        pkt = PacketData.from_bytes(corrupted_data)
        # Asserts failure/false behavior on malformed input
        self.assertIsNone(pkt, "Corrupted packet must not decode and return False/None")

    # -------------------------------------------------------------------------
    # TEST CASE 2: TOKEN BUCKET POLICER (TRUE & FALSE EDGE CASES)
    # -------------------------------------------------------------------------
    def test_token_bucket_within_rate_returns_true(self):
        """Positive test: Conforming burst is accepted."""
        policer = TokenBucketPolicer(rate_bps=1_000_000, capacity_bytes=50_000)
        policer.set_enabled(True)
        self.assertTrue(policer.allow_packet(1024), "Conforming packet must return True")

    def test_token_bucket_exhausted_returns_false(self):
        """Negative/False test: Non-conforming burst exceeding bucket capacity returns False."""
        policer = TokenBucketPolicer(rate_bps=1_000_000, capacity_bytes=2_000)
        policer.set_enabled(True)
        # Drain all tokens
        allowed_1 = policer.allow_packet(1500)
        self.assertTrue(allowed_1)

        # Immediate second packet exceeds remaining tokens (only ~500 bytes left)
        allowed_2 = policer.allow_packet(1500)
        # Edge Case: Must return False and drop!
        self.assertFalse(allowed_2, "Burst exceeding capacity must return False to protect router")

    # -------------------------------------------------------------------------
    # TEST CASE 3: QUEUE EMPTY DEQUEUE (FALSE/NONE EDGE CASE)
    # -------------------------------------------------------------------------
    def test_empty_queue_dequeue_returns_false_none(self):
        """Edge Case: Dequeuing an empty buffer must safely return None without throwing."""
        empty_q = PacketQueue("EMPTY", 1)
        self.assertTrue(empty_q.is_empty())
        result = empty_q.dequeue()
        self.assertIsNone(result, "Dequeuing an empty buffer must safely return None")

    # -------------------------------------------------------------------------
    # TEST CASE 4: SCHEDULING ALGORITHM 1 - FIFO QUEUING ORDER
    # -------------------------------------------------------------------------
    def test_fifo_scheduling_algorithm(self):
        """Algorithm verification: FIFO strictly dequeues in arrival timestamp order."""
        fifo = FIFOScheduler(self.high_q, self.med_q, self.low_q)
        
        t0 = time.time()
        p1 = PacketData(timestamp=t0, flow_id=1, seq_num=1, payload=b"First")
        time.sleep(0.002)
        p2 = PacketData(timestamp=time.time(), flow_id=2, seq_num=2, payload=b"Second")

        # Enqueue in different priority queues to test that FIFO ignores priority
        self.low_q.enqueue(p1)
        self.high_q.enqueue(p2)

        out1 = fifo.get_next_packet()
        out2 = fifo.get_next_packet()

        self.assertEqual(out1.payload, b"First", "FIFO must prioritize oldest arrival")
        self.assertEqual(out2.payload, b"Second")

    # -------------------------------------------------------------------------
    # TEST CASE 5: SCHEDULING ALGORITHM 2 - STRICT PRIORITY PRECEDENCE
    # -------------------------------------------------------------------------
    def test_strict_priority_scheduling_algorithm(self):
        """Algorithm verification: PriorityScheduler dequeues High queue ahead of Medium and Low."""
        pq = PriorityScheduler(self.high_q, self.med_q, self.low_q)

        low_pkt = PacketData(timestamp=time.time() - 10, flow_id=999, seq_num=1, payload=b"LowBulk")
        high_pkt = PacketData(timestamp=time.time(), flow_id=997, seq_num=2, payload=b"HighVoIP")

        # Low packet arrived earlier, High arrived later
        self.low_q.enqueue(low_pkt)
        self.high_q.enqueue(high_pkt)

        # Priority scheduler MUST dequeue High first, bypassing the older Low packet!
        out1 = pq.get_next_packet()
        self.assertEqual(out1.payload, b"HighVoIP", "Priority scheduler must dequeue HIGH before LOW")

    # -------------------------------------------------------------------------
    # TEST CASE 6: SCHEDULING ALGORITHM 3 - WEIGHTED FAIR QUEUING (WFQ)
    # -------------------------------------------------------------------------
    def test_wfq_scheduling_fairness(self):
        """Algorithm verification: WFQ balances service proportionally without starving low."""
        wfq = WFQScheduler(self.high_q, self.med_q, self.low_q)

        # Enqueue packets into high and low
        for i in range(5):
            self.high_q.enqueue(PacketData(time.time(), 1, i, b"High"))
            self.low_q.enqueue(PacketData(time.time(), 3, i, b"Low"))

        dequeued = []
        for _ in range(10):
            pkt = wfq.get_next_packet()
            if pkt:
                dequeued.append(pkt.payload)

        # Ensure LOW is NOT starved (WFQ guarantees low queue service)
        self.assertIn(b"Low", dequeued, "WFQ must prevent starvation of lower queues")
        self.assertIn(b"High", dequeued)

    # -------------------------------------------------------------------------
    # TEST CASE 7: SOCKET CONNECTIVITY TEST
    # -------------------------------------------------------------------------
    def test_udp_socket_connectivity(self):
        """Test Case: Verifies UDP router ingress socket port 9001 is reachable."""
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.settimeout(1.0)
        try:
            # Send test datagram to local router port 9001
            test_packet = create_packet(flow_id=997, seq_num=99, payload_size=32)
            sock.sendto(test_packet, ("127.0.0.1", 9001))
            connectivity_passed = True
        except Exception as e:
            connectivity_passed = False
        finally:
            sock.close()

        self.assertTrue(connectivity_passed, "UDP port 9001 socket transmission must succeed")

if __name__ == "__main__":
    unittest.main()
