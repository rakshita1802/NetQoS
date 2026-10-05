import socket
import struct
import time
import sys
import os

# [Header: 16 bytes] -> double timestamp, int flow_id, int seq_num
PACKET_HEADER_FORMAT = "!dII"

def create_real_packet(flow_id, seq_num, payload):
    header = struct.pack(PACKET_HEADER_FORMAT, time.time(), flow_id, seq_num)
    return header + payload

def send_file(filepath):
    if not os.path.exists(filepath):
        print(f"Error: File '{filepath}' not found!")
        return

    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    
    # We use a special flow ID (999) so the Router knows this is REAL data, not dummy data.
    flow_id = 999 
    seq_num = 0
    
    print(f"🚀 Sending real file '{filepath}' to the NetQoS Router...")
    
    with open(filepath, "rb") as f:
        while True:
            # Send in 1024-byte chunks
            chunk = f.read(1024)
            if not chunk:
                break
            
            # Wrap the raw file chunk in our Router's Packet Header
            pkt = create_real_packet(flow_id, seq_num, chunk)
            
            # Send it to the Router's UDP Ingress port (9001)
            sock.sendto(pkt, ("127.0.0.1", 9001))
            seq_num += 1
            
            # Tiny sleep to simulate 100 Mbps network card, otherwise it sends too fast
            time.sleep(0.005) 
            
            if seq_num % 100 == 0:
                print(f"Sent {seq_num} chunks...")
            
    # Send an EOF packet so the server knows the file is completely sent
    time.sleep(1)
    pkt = create_real_packet(flow_id, seq_num, b"EOF")
    sock.sendto(pkt, ("127.0.0.1", 9001))
    print(f"✅ Finished sending {seq_num} chunks to the router!")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python file_client.py <path_to_image_or_file>")
    else:
        send_file(sys.argv[1])
