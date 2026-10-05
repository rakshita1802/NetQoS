import socket
import struct
import time
import sys
import cv2

# [Header: 16 bytes] -> double timestamp, int flow_id, int seq_num
PACKET_HEADER_FORMAT = "!dII"

def create_real_packet(flow_id, seq_num, payload):
    header = struct.pack(PACKET_HEADER_FORMAT, time.time(), flow_id, seq_num)
    return header + payload

def stream_video(source=0):
    # If source is 0, it uses your WebCam! Otherwise, it uses the provided .mp4 file.
    cap = cv2.VideoCapture(source)
    
    if not cap.isOpened():
        print(f"Error: Cannot open video source {source}")
        return

    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    
    # We use a special flow ID (998) so the Router knows this is LIVE VIDEO.
    flow_id = 998 
    seq_num = 0
    
    print(f"🚀 Streaming Live Video to the NetQoS Router (Port 9001)...")
    
    while True:
        ret, frame = cap.read()
        if not ret:
            break
            
        # Resize to keep packet size small (UDP limit is 65535 bytes)
        frame = cv2.resize(frame, (640, 360))
        
        # Compress the frame to JPEG to save bandwidth
        encode_param = [int(cv2.IMWRITE_JPEG_QUALITY), 60]
        _, buffer = cv2.imencode('.jpg', frame, encode_param)
        
        payload = buffer.tobytes()
        
        if len(payload) > 65000:
            print("Warning: Frame too large for UDP, skipping frame.")
            continue
            
        # Wrap the raw Video chunk in our Router's Packet Header
        pkt = create_real_packet(flow_id, seq_num, payload)
        
        # Send it to the Router's UDP Ingress port
        sock.sendto(pkt, ("127.0.0.1", 9001))
        seq_num += 1
        
        # Throttle to roughly 30 Frames Per Second
        time.sleep(1 / 30.0) 

    cap.release()
    print("Video stream finished.")

if __name__ == "__main__":
    if len(sys.argv) > 1:
        stream_video(sys.argv[1])
    else:
        print("No video file provided. Defaulting to WebCam (0)...")
        stream_video(0)
