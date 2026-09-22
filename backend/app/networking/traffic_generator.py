import asyncio
import socket
import time
from app.models.packet import create_packet

class TrafficGenerator:
    def __init__(self, host: str, tcp_port: int, udp_port: int):
        self.host = host
        self.tcp_port = tcp_port
        self.udp_port = udp_port
        self.active_flows = {}

    async def _generate_tcp(self, flow_id: int, rate: int, packet_size: int, duration: int):
        reader, writer = await asyncio.open_connection(self.host, self.tcp_port)
        seq_num = 0
        start_time = time.time()
        interval = 1.0 / rate if rate > 0 else 0
        
        try:
            while time.time() - start_time < duration and self.active_flows.get(flow_id, False):
                loop_start = time.time()
                pkt = create_packet(flow_id, seq_num, packet_size)
                # length prefix for TCP framing
                length_prefix = len(pkt).to_bytes(4, byteorder='big')
                writer.write(length_prefix + pkt)
                await writer.drain()
                seq_num += 1
                
                elapsed = time.time() - loop_start
                sleep_time = interval - elapsed
                if sleep_time > 0:
                    await asyncio.sleep(sleep_time)
        except asyncio.CancelledError:
            pass
        except Exception as e:
            print(f"TCP flow {flow_id} error: {e}")
        finally:
            self.active_flows.pop(flow_id, None)
            writer.close()
            await writer.wait_closed()

    async def _generate_udp(self, flow_id: int, rate: int, packet_size: int, duration: int):
        class UDPClientProtocol(asyncio.DatagramProtocol):
            def __init__(self):
                self.transport = None

            def connection_made(self, transport):
                self.transport = transport

            def error_received(self, exc):
                pass
                
        loop = asyncio.get_running_loop()
        transport, protocol = await loop.create_datagram_endpoint(
            UDPClientProtocol, remote_addr=(self.host, self.udp_port))
            
        seq_num = 0
        start_time = time.time()
        interval = 1.0 / rate if rate > 0 else 0
        
        try:
            while time.time() - start_time < duration and self.active_flows.get(flow_id, False):
                loop_start = time.time()
                pkt = create_packet(flow_id, seq_num, packet_size)
                transport.sendto(pkt)
                seq_num += 1
                
                elapsed = time.time() - loop_start
                sleep_time = interval - elapsed
                if sleep_time > 0:
                    await asyncio.sleep(sleep_time)
        except asyncio.CancelledError:
            pass
        except Exception as e:
            print(f"UDP flow {flow_id} error: {e}")
        finally:
            self.active_flows.pop(flow_id, None)
            transport.close()

    def start_flow(self, flow_id: int, protocol: str, rate: int, packet_size: int, duration: int):
        self.active_flows[flow_id] = True
        loop = asyncio.get_event_loop()
        if protocol.upper() == "TCP":
            task = loop.create_task(self._generate_tcp(flow_id, rate, packet_size, duration))
        else:
            task = loop.create_task(self._generate_udp(flow_id, rate, packet_size, duration))
        return task

    def stop_flow(self, flow_id: int):
        if flow_id in self.active_flows:
            self.active_flows[flow_id] = False

    def stop_all(self):
        for flow_id in list(self.active_flows.keys()):
            self.stop_flow(flow_id)

traffic_generator = TrafficGenerator("127.0.0.1", 9000, 9001)
