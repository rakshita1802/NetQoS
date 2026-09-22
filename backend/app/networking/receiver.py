import asyncio
import struct
from app.models.packet import PacketData

class TCPReceiverProtocol(asyncio.Protocol):
    def __init__(self, callback):
        self.callback = callback
        self.buffer = b""

    def connection_made(self, transport):
        pass

    def data_received(self, data):
        self.buffer += data
        while len(self.buffer) >= 4:
            length = int.from_bytes(self.buffer[:4], byteorder='big')
            if len(self.buffer) >= 4 + length:
                packet_data = self.buffer[4:4+length]
                self.buffer = self.buffer[4+length:]
                
                pkt = PacketData.from_bytes(packet_data)
                if pkt and self.callback:
                    self.callback(pkt, "TCP")
            else:
                break

class UDPReceiverProtocol(asyncio.DatagramProtocol):
    def __init__(self, callback):
        self.callback = callback

    def connection_made(self, transport):
        pass

    def datagram_received(self, data, addr):
        pkt = PacketData.from_bytes(data)
        if pkt and self.callback:
            self.callback(pkt, "UDP")

class TrafficReceiver:
    def __init__(self, host: str, tcp_port: int, udp_port: int, packet_callback):
        self.host = host
        self.tcp_port = tcp_port
        self.udp_port = udp_port
        self.packet_callback = packet_callback
        self.tcp_server = None
        self.udp_transport = None

    async def start(self):
        loop = asyncio.get_running_loop()
        
        # Start TCP Server
        self.tcp_server = await loop.create_server(
            lambda: TCPReceiverProtocol(self.packet_callback),
            self.host, self.tcp_port
        )
        
        # Start UDP Server
        self.udp_transport, _ = await loop.create_datagram_endpoint(
            lambda: UDPReceiverProtocol(self.packet_callback),
            local_addr=(self.host, self.udp_port)
        )
        print(f"TrafficReceiver started on {self.host} TCP:{self.tcp_port} UDP:{self.udp_port}")

    async def stop(self):
        if self.tcp_server:
            self.tcp_server.close()
            await self.tcp_server.wait_closed()
        if self.udp_transport:
            self.udp_transport.close()
