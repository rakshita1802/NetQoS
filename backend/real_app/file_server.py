import socket
import os

def run_server():
    os.makedirs("downloads", exist_ok=True)
    filepath = os.path.join("downloads", "received_image.jpg")
    
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.bind(("127.0.0.1", 9005))
    
    print("=========================================")
    print("📥 REAL FILE SERVER LISTENING ON PORT 9005")
    print("Waiting for files from the NetQoS Router...")
    print("=========================================")
    
    with open(filepath, "wb") as f:
        while True:
            data, _ = sock.recvfrom(65535)
            if data == b"EOF":
                print(f"\n✅ File successfully received and saved to: {filepath}")
                break
            f.write(data)
            print(".", end="", flush=True) # Print a dot for every chunk received

if __name__ == "__main__":
    run_server()
