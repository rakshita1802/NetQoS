import socket
import uvicorn
from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
sock.bind(("127.0.0.1", 9006))
# Tiny timeout so the server doesn't freeze when the video stops
sock.settimeout(0.5) 

def generate_frames():
    while True:
        try:
            data, _ = sock.recvfrom(65535)
            # The data is already raw JPEG bytes! We yield it straight to the browser
            yield (b'--frame\r\n'
                   b'Content-Type: image/jpeg\r\n\r\n' + data + b'\r\n')
        except socket.timeout:
            pass
        except Exception as e:
            pass

@app.get("/video")
def video_feed():
    return StreamingResponse(generate_frames(), media_type="multipart/x-mixed-replace; boundary=frame")

if __name__ == "__main__":
    print("=========================================")
    print("📺 LIVE WEB VIDEO SERVER LISTENING ON PORT 9007")
    print("=========================================")
    uvicorn.run(app, host="127.0.0.1", port=9007)
