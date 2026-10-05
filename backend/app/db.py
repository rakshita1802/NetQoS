import sqlite3
from datetime import datetime
import os

DB_PATH = os.path.join(os.path.dirname(__file__), "..", "netqos.db")

def init_db():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute('''CREATE TABLE IF NOT EXISTS metrics
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  timestamp TEXT,
                  throughput REAL,
                  latency REAL,
                  jitter REAL,
                  packet_loss REAL)''')
    conn.commit()
    conn.close()

def insert_metric(throughput: float, latency: float, jitter: float, packet_loss: float):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("INSERT INTO metrics (timestamp, throughput, latency, jitter, packet_loss) VALUES (?, ?, ?, ?, ?)",
              (datetime.now().isoformat(), throughput, latency, jitter, packet_loss))
    conn.commit()
    conn.close()

def get_historical_metrics(limit: int = 100):
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    c.execute("SELECT timestamp, throughput, latency, jitter, packet_loss FROM metrics ORDER BY id DESC LIMIT ?", (limit,))
    rows = c.fetchall()
    conn.close()
    
    # Return sorted chronologically (oldest to newest) for chart plotting
    results = [dict(row) for row in rows]
    results.reverse()
    return results
