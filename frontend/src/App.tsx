import React, { useEffect, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Activity, Zap, ShieldAlert, BarChart3, Clock, Settings, PlayCircle, StopCircle } from 'lucide-react';

const API_BASE = "http://localhost:8000/api";
const WS_BASE = "ws://localhost:8000/ws";

function App() {
  const [metrics, setMetrics] = useState({
    throughput_bps: 0,
    latency_s: 0,
    jitter_s: 0,
    packet_loss_rate: 0,
    total_packets: 0,
    recent_logs: []
  });
  
  const [schedulerInfo, setSchedulerInfo] = useState({
    scheduler: 'FIFO',
    stats: { queues: [] }
  });
  
  const [activeFlows, setActiveFlows] = useState([]);
  
  const [history, setHistory] = useState([]);
  const [isHistoricalView, setIsHistoricalView] = useState(false);  
  const [firewallEnabled, setFirewallEnabled] = useState(false);
  const [flowConfig, setFlowConfig] = useState({
    flow_id: 1,
    protocol: 'TCP',
    rate: 100,
    packet_size: 1024,
    duration: 30,
    priority: ''
  });

  useEffect(() => {
    const ws = new WebSocket(`${WS_BASE}/metrics`);
    
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      setMetrics(data.metrics);
      setSchedulerInfo({ scheduler: data.scheduler, stats: data.scheduler_stats });
      setActiveFlows(data.active_flows);
      setFirewallEnabled(data.firewall_enabled);
      
      setHistory(prev => {
        // If in historical mode, ignore live websocket data for the chart
        if (isHistoricalView) return prev;
        
        const newHist = [...prev, {
          time: new Date().toLocaleTimeString(),
          throughput: data.metrics.throughput_bps / 1000000, // Mbps
          latency: data.metrics.latency_s * 1000 // ms
        }];
        if (newHist.length > 20) return newHist.slice(newHist.length - 20);
        return newHist;
      });
    };
    
    return () => ws.close();
  }, []);

  const startTraffic = async () => {
    await fetch(`${API_BASE}/traffic/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(flowConfig)
    });
    setFlowConfig(prev => ({ ...prev, flow_id: prev.flow_id + 1 }));
  };

  const stopAllTraffic = async () => {
    await fetch(`${API_BASE}/traffic/stop_all`, { method: 'POST' });
  };

  const setScheduler = async (algo: string) => {
    await fetch(`${API_BASE}/scheduler/select`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ algorithm: algo })
    });
  };

  const loadHistoricalData = async () => {
    setIsHistoricalView(true);
    const res = await fetch(`${API_BASE}/metrics/history?limit=50`);
    const data = await res.json();
    const formatted = data.map(d => ({
      time: new Date(d.timestamp).toLocaleTimeString(),
      throughput: d.throughput,
      latency: d.latency
    }));
    setHistory(formatted);
  };

  const resumeLiveView = () => {
    setIsHistoricalView(false);
    setHistory([]);
  };

  const toggleFirewall = async () => {
    await fetch(`${API_BASE}/firewall/toggle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !firewallEnabled })
    });
  };

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 p-6 font-sans">
      <header className="mb-8 border-b border-gray-800 pb-4">
        <h1 className="text-3xl font-bold text-blue-400 flex items-center gap-3">
          <Activity size={32} />
          NetQoS
        </h1>
        <p className="text-gray-400 mt-2">Adaptive Packet Scheduling and QoS Management</p>
      </header>

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <div className="bg-gray-800 p-4 rounded-xl border border-gray-700 shadow-lg">
          <div className="flex items-center gap-2 text-gray-400 mb-2"><Zap size={18}/> Throughput</div>
          <div className="text-2xl font-bold text-white">{(metrics.throughput_bps / 1000000).toFixed(2)} Mbps</div>
        </div>
        <div className="bg-gray-800 p-4 rounded-xl border border-gray-700 shadow-lg">
          <div className="flex items-center gap-2 text-gray-400 mb-2"><Clock size={18}/> Avg Latency</div>
          <div className="text-2xl font-bold text-blue-400">{(metrics.latency_s * 1000).toFixed(2)} ms</div>
        </div>
        <div className="bg-gray-800 p-4 rounded-xl border border-gray-700 shadow-lg">
          <div className="flex items-center gap-2 text-gray-400 mb-2"><Activity size={18}/> Jitter</div>
          <div className="text-2xl font-bold text-purple-400">{(metrics.jitter_s * 1000).toFixed(2)} ms</div>
        </div>
        <div className="bg-gray-800 p-4 rounded-xl border border-gray-700 shadow-lg">
          <div className="flex items-center gap-2 text-gray-400 mb-2"><ShieldAlert size={18}/> Packet Loss</div>
          <div className="text-2xl font-bold text-red-400">{(metrics.packet_loss_rate * 100).toFixed(2)} %</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Main Chart */}
        <div className="lg:col-span-2 bg-gray-800 p-6 rounded-xl border border-gray-700 shadow-lg">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-semibold flex items-center gap-2">
              <BarChart3/> {isHistoricalView ? "Historical Database Metrics (Last 50)" : "Live Traffic"}
            </h2>
            <div className="flex gap-2">
              <button 
                onClick={resumeLiveView}
                className={`px-3 py-1 rounded text-sm font-medium ${!isHistoricalView ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-400 hover:bg-gray-600'}`}
              >Live Stream</button>
              <button 
                onClick={loadHistoricalData}
                className={`px-3 py-1 rounded text-sm font-medium flex items-center gap-1 ${isHistoricalView ? 'bg-purple-600 text-white' : 'bg-gray-700 text-gray-400 hover:bg-gray-600'}`}
              >
                <Clock size={14}/> DB History
              </button>
            </div>
          </div>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={history}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="time" stroke="#9CA3AF" />
                <YAxis yAxisId="left" stroke="#60A5FA" />
                <YAxis yAxisId="right" orientation="right" stroke="#C084FC" />
                <Tooltip contentStyle={{ backgroundColor: '#1F2937', border: 'none' }} />
                <Line yAxisId="left" type="monotone" dataKey="throughput" stroke="#60A5FA" strokeWidth={2} dot={false} />
                <Line yAxisId="right" type="monotone" dataKey="latency" stroke="#C084FC" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Controls Panel */}
        <div className="bg-gray-800 p-6 rounded-xl border border-gray-700 shadow-lg flex flex-col gap-6">
          <div>
            <h2 className="text-xl font-semibold mb-4 flex items-center gap-2"><Settings/> Scheduler</h2>
            <div className="flex flex-wrap gap-2 mb-4">
              {['FIFO', 'Priority', 'WFQ', 'Adaptive', 'Predictive ML'].map(algo => (
                <button
                  key={algo}
                  onClick={() => setScheduler(algo)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    schedulerInfo.scheduler === algo 
                      ? 'bg-blue-600 text-white' 
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  }`}
                >
                  {algo}
                </button>
              ))}
            </div>
            {(schedulerInfo.scheduler === 'Adaptive' || schedulerInfo.scheduler === 'Predictive ML') && (
              <div className="bg-blue-900/30 p-3 rounded-lg border border-blue-800/50 text-sm text-blue-200">
                <span className="font-bold">Adaptation:</span> {schedulerInfo.stats?.last_adaptation_reason || "None"}
              </div>
            )}
          </div>

          <div className="flex-grow"></div>

          <div>
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-semibold flex items-center gap-2"><ShieldAlert/> Firewall (Policer)</h2>
              <button 
                onClick={toggleFirewall}
                className={`px-4 py-1 rounded-full text-sm font-bold transition-colors ${firewallEnabled ? 'bg-red-600 text-white' : 'bg-gray-700 text-gray-400'}`}
              >
                {firewallEnabled ? 'ACTIVE (1 Mbps Limit)' : 'DISABLED'}
              </button>
            </div>
            <p className="text-xs text-gray-400 mb-4">Uses Token Bucket to drop ingress packets if rate exceeds limit.</p>
          </div>

          <div className="flex-grow"></div>

          <div>
            <h2 className="text-xl font-semibold mb-4 flex items-center gap-2"><PlayCircle/> Traffic Generator</h2>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <select 
                className="bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm"
                value={flowConfig.protocol}
                onChange={e => setFlowConfig({...flowConfig, protocol: e.target.value})}
              >
                <option>TCP</option>
                <option>UDP</option>
              </select>
              <input 
                type="number" placeholder="Rate (pps)" className="bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm"
                value={flowConfig.rate} onChange={e => setFlowConfig({...flowConfig, rate: parseInt(e.target.value)})}
              />
            </div>
            <div className="flex gap-2">
              <button onClick={startTraffic} className="flex-1 bg-green-600 hover:bg-green-500 text-white py-2 rounded-lg font-medium transition-colors">Start Flow</button>
              <button onClick={stopAllTraffic} className="flex-1 bg-red-600 hover:bg-red-500 text-white py-2 rounded-lg font-medium transition-colors">Stop All</button>
            </div>
          </div>
        </div>
      </div>

      {/* Live Video Stream Section */}
      <div className="mt-8 bg-gray-800 p-6 rounded-xl border border-gray-700 shadow-lg">
        <h2 className="text-xl font-semibold mb-4 flex items-center gap-2 text-pink-400">
          <PlayCircle size={24}/> Live Real-Time Video Stream
        </h2>
        <div className="w-full bg-black rounded-lg border border-gray-700 overflow-hidden flex flex-col items-center justify-center min-h-[400px] relative">
           <img 
              src="http://127.0.0.1:9007/video" 
              alt="" 
              className="max-h-[500px] w-full object-contain z-10" 
              onError={(e) => { e.currentTarget.style.display = 'none'; }} 
              onLoad={(e) => { e.currentTarget.style.display = 'block'; }} 
           />
           <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-500 z-0">
              <PlayCircle size={48} className="mb-2 opacity-50" />
              <p>Waiting for Live Stream...</p>
              <p className="text-xs mt-2 opacity-75">Run <code className="bg-gray-800 p-1 rounded text-pink-400">python video_server.py</code> and <code className="bg-gray-800 p-1 rounded text-pink-400">video_client.py</code></p>
           </div>
        </div>
      </div>

      {/* Lower Section: Queues and Logs */}
      <div className="mt-8 grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Queues Visualization */}
        <div className="lg:col-span-2 bg-gray-800 p-6 rounded-xl border border-gray-700 shadow-lg">
          <h2 className="text-xl font-semibold mb-6">Packet Queues</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {schedulerInfo.stats?.queues?.map((q, i) => (
              <div key={i} className="bg-gray-900 p-4 rounded-lg border border-gray-800">
                <div className="flex justify-between items-center mb-2">
                  <span className={`font-bold ${q.name === 'HIGH' ? 'text-red-400' : q.name === 'MEDIUM' ? 'text-yellow-400' : 'text-green-400'}`}>
                    {q.name} QUEUE
                  </span>
                  <span className="text-sm text-gray-500">{q.length} pkts</span>
                </div>
                <div className="w-full bg-gray-800 rounded-full h-4 mb-4 overflow-hidden">
                  <div 
                    className={`h-4 rounded-full transition-all duration-300 ${q.name === 'HIGH' ? 'bg-red-500' : q.name === 'MEDIUM' ? 'bg-yellow-500' : 'bg-green-500'}`}
                    style={{ width: `${Math.min((q.length / 100) * 100, 100)}%` }}
                  ></div>
                </div>
                <div className="text-xs text-gray-400 flex justify-between">
                  <span>Wait: {(q.avg_wait_time * 1000).toFixed(1)} ms</span>
                  <span>Processed: {q.packets_processed}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Live Packet Log Panel */}
        <div className="bg-gray-800 p-6 rounded-xl border border-gray-700 shadow-lg flex flex-col h-full">
          <h2 className="text-xl font-semibold mb-4 flex items-center gap-2"><Activity size={20}/> Live Packet Log</h2>
          <div className="flex-grow bg-black rounded-lg p-3 overflow-y-auto border border-gray-700 text-xs font-mono" style={{maxHeight: "300px"}}>
            {metrics.recent_logs && metrics.recent_logs.map((log, i) => (
              <div key={i} className={`mb-1 ${log.type === 'DROP' ? 'text-red-400' : 'text-green-400'}`}>
                [{log.type}] Flow {log.flow_id} | {log.size}B | {log.latency_ms}ms
              </div>
            ))}
            {(!metrics.recent_logs || metrics.recent_logs.length === 0) && (
              <div className="text-gray-500 italic">Waiting for traffic...</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
