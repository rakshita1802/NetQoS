import socket
import cv2
import numpy as np

def run_server():
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.bind(("127.0.0.1", 9006))
    
    print("=========================================")
    print("📺 LIVE VIDEO SERVER LISTENING ON PORT 9006")
    print("=========================================")
    
    while True:
        try:
            data, _ = sock.recvfrom(65535)
            
            # Decode the raw JPEG bytes back into a video frame
            nparr = np.frombuffer(data, np.uint8)
            frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            
            if frame is not None:
                # Display the frame in a popup window
                cv2.imshow("NetQoS Live Video Stream", frame)
                
            # Press 'q' to quit the video player
            if cv2.waitKey(1) & 0xFF == ord('q'):
                break
                
        except Exception as e:
            # If the QoS Router drops or mangles packets, this exception hits!
            # The video will visually stutter, proving Packet Loss!
            pass
            
    cv2.destroyAllWindows()
    sock.close()

if __name__ == "__main__":
    run_server()
