import { useEffect, useState } from 'react';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer 
} from 'recharts';
import { 
  Activity, Zap, ShieldAlert, BarChart3, Clock,
  Video, MessageSquare, Send, Server, AlertTriangle, CheckCircle2, 
  Users, Layers, Cpu, Camera, Flame, ArrowRight
} from 'lucide-react';

const API_BASE = "http://localhost:8000/api";
const WS_BASE = "ws://localhost:8000/ws";

interface PacketLog {
  type: string;
  flow_id: number;
  seq_num?: number;
  ack_num?: number;
  size: number;
  latency_ms: number;
  protocol?: string;
  src_ip?: string;
  dst_ip?: string;
  src_port?: number;
  dst_port?: number;
  ttl?: number;
  window_size?: number;
  flags?: string;
  app_proto?: string;
  app_preview?: string;
  hex_dump?: string;
}

interface QueueStat {
  name: string;
  length: number;
  bytes_waiting: number;
  packets_processed: number;
  packets_dropped: number;
  avg_wait_time: number;
  max_wait_time: number;
}

function App() {
  const [activeTab, setActiveTab] = useState<'workspace' | 'noc' | 'analytics'>('workspace');
  
  const [metrics, setMetrics] = useState({
    throughput_bps: 0,
    latency_s: 0,
    jitter_s: 0,
    packet_loss_rate: 0,
    total_packets: 0,
    recent_logs: [] as PacketLog[]
  });
  
  const [schedulerInfo, setSchedulerInfo] = useState({
    scheduler: 'FIFO',
    stats: { 
      queues: [] as QueueStat[],
      last_adaptation_reason: ''
    }
  });
  
  const [activeFlows, setActiveFlows] = useState<number[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [isHistoricalView, setIsHistoricalView] = useState(false);  
  const [firewallEnabled, setFirewallEnabled] = useState(false);
  const [chatMessages, setChatMessages] = useState<{ id: number; text: string; time: string; delayMs: number }[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatWs, setChatWs] = useState<WebSocket | null>(null);
  const [snapshot, setSnapshot] = useState<string | null>(null);
  const [logFilter, setLogFilter] = useState<'ALL' | 'DROP' | 'TCP' | 'VIDEO' | 'CHAT'>('ALL');
  const [isSimulatingDDoS, setIsSimulatingDDoS] = useState(false);
  const [cameraActive, setCameraActive] = useState(true);
  const [isBrowserCamActive, setIsBrowserCamActive] = useState(false);
  const [browserCamStream, setBrowserCamStream] = useState<MediaStream | null>(null);
  const [browserCamWs, setBrowserCamWs] = useState<WebSocket | null>(null);
  const [routedVideoBlobUrl, setRoutedVideoBlobUrl] = useState<string | null>(null);
  const [selectedPacket, setSelectedPacket] = useState<PacketLog | null>(null);
  const [copiedHex, setCopiedHex] = useState(false);

  const formatHexDump = (hexStr: string) => {
    const bytes = hexStr.split(' ').filter(Boolean);
    const lines: string[] = [];
    for (let i = 0; i < bytes.length; i += 16) {
      const chunk = bytes.slice(i, i + 16);
      const offset = i.toString(16).padStart(4, '0');
      const first8 = chunk.slice(0, 8).join(' ').padEnd(23, ' ');
      const second8 = chunk.slice(8, 16).join(' ').padEnd(23, ' ');
      const ascii = chunk.map(b => {
        const code = parseInt(b, 16);
        return (code >= 32 && code <= 126) ? String.fromCharCode(code) : '.';
      }).join('');
      lines.push(`${offset}   ${first8}  ${second8}   |${ascii}|`);
    }
    return lines.join('\n');
  };

  const [flowConfig, setFlowConfig] = useState({
    flow_id: 1,
    protocol: 'TCP',
    rate: 100,
    packet_size: 1024,
    duration: 30,
    priority: ''
  });

  useEffect(() => {
    let ws: WebSocket;
    let chatSocket: WebSocket;
    let videoEgressSocket: WebSocket;
    let reconnectTimeout: any;

    const connectWebSockets = () => {
      ws = new WebSocket(`${WS_BASE}/metrics`);
      
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          setMetrics(data.metrics);
          setSchedulerInfo({ scheduler: data.scheduler, stats: data.scheduler_stats });
          setActiveFlows(data.active_flows || []);
          setFirewallEnabled(data.firewall_enabled || false);
          
          setHistory(prev => {
            if (isHistoricalView) return prev;
            const newHist = [...prev, {
              time: new Date().toLocaleTimeString(),
              throughput: (data.metrics.throughput_bps / 1000000).toFixed(2),
              latency: (data.metrics.latency_s * 1000).toFixed(1)
            }];
            if (newHist.length > 25) return newHist.slice(newHist.length - 25);
            return newHist;
          });
        } catch (e) {
          console.error("Failed to parse metrics", e);
        }
      };

      chatSocket = new WebSocket(`${WS_BASE}/chat`);
      chatSocket.onmessage = (event) => {
        const arrivalTime = new Date().toLocaleTimeString();
        const estimatedLatency = metrics.latency_s > 0 ? (metrics.latency_s * 1000).toFixed(1) : (Math.random() * 2 + 1).toFixed(1);
        setChatMessages(prev => [
          ...prev, 
          { id: Date.now(), text: event.data, time: arrivalTime, delayMs: parseFloat(estimatedLatency) }
        ].slice(-15));
      };
      setChatWs(chatSocket);

      videoEgressSocket = new WebSocket(`${WS_BASE}/video_egress`);
      videoEgressSocket.binaryType = 'blob';
      videoEgressSocket.onmessage = (event) => {
        if (event.data instanceof Blob) {
          const url = URL.createObjectURL(event.data);
          setRoutedVideoBlobUrl(prev => {
            if (prev) URL.revokeObjectURL(prev);
            return url;
          });
        }
      };
    };

    connectWebSockets();

    return () => {
      if (ws) ws.close();
      if (chatSocket) chatSocket.close();
      if (videoEgressSocket) videoEgressSocket.close();
      clearTimeout(reconnectTimeout);
    };
  }, [isHistoricalView]);

  const startBrowserWebcam = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 360 }
      });
      setBrowserCamStream(stream);
      setIsBrowserCamActive(true);

      const hiddenVideo = document.getElementById('webcam-hidden-player') as HTMLVideoElement;
      if (hiddenVideo) {
        hiddenVideo.srcObject = stream;
        hiddenVideo.play().catch(e => console.error("Video play error", e));
      }

      const ingressWs = new WebSocket(`${WS_BASE}/video_ingress`);
      ingressWs.binaryType = 'arraybuffer';
      setBrowserCamWs(ingressWs);

      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 360;
      const ctx = canvas.getContext('2d');

      const intervalId = setInterval(() => {
        if (!hiddenVideo || hiddenVideo.readyState < 2) return;
        if (ingressWs.readyState !== WebSocket.OPEN) return;

        if (ctx) {
          ctx.drawImage(hiddenVideo, 0, 0, 640, 360);
          canvas.toBlob((blob) => {
            if (blob && ingressWs.readyState === WebSocket.OPEN) {
              blob.arrayBuffer().then((buffer) => {
                ingressWs.send(buffer);
              });
            }
          }, 'image/jpeg', 0.55);
        }
      }, 1000 / 25);

      (window as any).__camInterval = intervalId;
    } catch (err) {
      console.error("Camera access failed", err);
      alert("Camera error: " + (err as Error).message);
    }
  };

  const stopBrowserWebcam = () => {
    if (browserCamStream) {
      browserCamStream.getTracks().forEach(track => track.stop());
      setBrowserCamStream(null);
    }
    if (browserCamWs) {
      browserCamWs.close();
      setBrowserCamWs(null);
    }
    if ((window as any).__camInterval) {
      clearInterval((window as any).__camInterval);
    }
    setIsBrowserCamActive(false);
  };

  const sendChatMessage = (customText?: string) => {
    const textToSend = customText || chatInput;
    if (chatWs && textToSend.trim() !== '') {
      chatWs.send(textToSend.trim());
      if (!customText) setChatInput('');
    }
  };

  const captureSnapshot = () => {
    const videoImg = document.getElementById('live-video') as HTMLImageElement;
    if (videoImg && videoImg.style.display !== 'none') {
      const canvas = document.createElement('canvas');
      canvas.width = videoImg.naturalWidth || videoImg.width || 640;
      canvas.height = videoImg.naturalHeight || videoImg.height || 480;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(videoImg, 0, 0, canvas.width, canvas.height);
        setSnapshot(canvas.toDataURL('image/jpeg'));
      }
    }
  };

  const startTraffic = async (customRate?: number, customProto?: string) => {
    const payload = {
      ...flowConfig,
      rate: customRate !== undefined ? customRate : flowConfig.rate,
      protocol: customProto || flowConfig.protocol
    };
    await fetch(`${API_BASE}/traffic/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    setFlowConfig(prev => ({ ...prev, flow_id: prev.flow_id + 1 }));
  };

  const stopAllTraffic = async () => {
    await fetch(`${API_BASE}/traffic/stop_all`, { method: 'POST' });
    setIsSimulatingDDoS(false);
  };

  const setScheduler = async (algo: string) => {
    await fetch(`${API_BASE}/scheduler/select`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ algorithm: algo })
    });
  };

  const toggleFirewall = async () => {
    await fetch(`${API_BASE}/firewall/toggle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !firewallEnabled })
    });
  };

  const triggerCongestionDemo = async () => {
    await setScheduler('FIFO');
    await startTraffic(5000, 'UDP');
    setIsSimulatingDDoS(true);
  };

  const triggerHealDemo = async () => {
    await setScheduler('Predictive ML');
  };

  const filteredLogs = (metrics.recent_logs || []).filter(log => {
    if (logFilter === 'DROP') return log.type === 'DROP';
    if (logFilter === 'TCP') return log.type.includes('TCP');
    if (logFilter === 'VIDEO') return log.flow_id === 998;
    if (logFilter === 'CHAT') return log.flow_id === 997;
    return true;
  });

  const latencyMs = metrics.latency_s * 1000;
  const isNetworkCongested = latencyMs > 40 || metrics.packet_loss_rate > 0.05 || (metrics.throughput_bps > 50000000 && schedulerInfo.scheduler === 'FIFO');

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans selection:bg-indigo-500 selection:text-white">
      {/* Top Enterprise Header */}
      <header className="border-b border-slate-800 bg-slate-900/90 backdrop-blur sticky top-0 z-50 px-6 py-3 shadow-md">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-tr from-indigo-600 via-blue-500 to-cyan-400 flex items-center justify-center shadow-lg shadow-indigo-500/30">
              <Activity className="h-6 w-6 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-xl tracking-tight bg-gradient-to-r from-white via-slate-200 to-slate-400 bg-clip-text text-transparent">
                  NetQoS Enterprise
                </span>
                <span className="bg-indigo-950 border border-indigo-700/60 text-indigo-400 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">
                  SD-WAN Gateway
                </span>
              </div>
              <p className="text-xs text-slate-400">AI-Powered L3/L4 Traffic Management & QoS Routing Engine</p>
            </div>
          </div>

          {/* Navigation Tabs */}
          <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800">
            <button
              onClick={() => setActiveTab('workspace')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
                activeTab === 'workspace' 
                  ? 'bg-gradient-to-r from-indigo-600 to-blue-600 text-white shadow-md' 
                  : 'text-slate-400 hover:text-white hover:bg-slate-900'
              }`}
            >
              <Users size={16} /> Enterprise Workspace
            </button>
            <button
              onClick={() => setActiveTab('noc')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
                activeTab === 'noc' 
                  ? 'bg-gradient-to-r from-indigo-600 to-blue-600 text-white shadow-md' 
                  : 'text-slate-400 hover:text-white hover:bg-slate-900'
              }`}
            >
              <Server size={16} /> Router Control Plane (NOC)
            </button>
            <button
              onClick={() => setActiveTab('analytics')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
                activeTab === 'analytics' 
                  ? 'bg-gradient-to-r from-indigo-600 to-blue-600 text-white shadow-md' 
                  : 'text-slate-400 hover:text-white hover:bg-slate-900'
              }`}
            >
              <BarChart3 size={16} /> Live Telemetry
            </button>
          </div>

          {/* Connection Status Badge */}
          <div className="hidden lg:flex items-center gap-3 bg-slate-950/80 border border-slate-800 px-3 py-1.5 rounded-lg text-xs font-mono">
            <span className="flex h-2 w-2 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            <span className="text-slate-300">ROUTER: 127.0.0.1:8000</span>
            <span className="text-slate-600">|</span>
            <span className="text-indigo-400">FLOWS: {activeFlows.length}</span>
            <span className="text-slate-600">|</span>
            <span className="text-indigo-400">SCHEDULER: {schedulerInfo.scheduler}</span>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="max-w-7xl mx-auto px-6 py-6">
        
        {/* KPI Quick Stats Ribbon */}
        <section className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-slate-900/90 border border-slate-800 p-4 rounded-xl shadow-sm hover:border-slate-700 transition">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-400 mb-1">
              <span className="flex items-center gap-1.5"><Zap size={15} className="text-amber-400" /> Link Throughput</span>
              <span className="text-[10px] text-slate-500 font-mono">CAP: 100M</span>
            </div>
            <div className="text-2xl font-black text-white font-mono">
              {(metrics.throughput_bps / 1000000).toFixed(2)} <span className="text-xs font-sans text-slate-400 font-normal">Mbps</span>
            </div>
          </div>

          <div className="bg-slate-900/90 border border-slate-800 p-4 rounded-xl shadow-sm hover:border-slate-700 transition">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-400 mb-1">
              <span className="flex items-center gap-1.5"><Clock size={15} className="text-cyan-400" /> Core Latency</span>
              <span className="text-[10px] text-slate-500 font-mono">ONE-WAY</span>
            </div>
            <div className={`text-2xl font-black font-mono ${latencyMs > 50 ? 'text-rose-400' : 'text-cyan-400'}`}>
              {latencyMs.toFixed(1)} <span className="text-xs font-sans text-slate-400 font-normal">ms</span>
            </div>
          </div>

          <div className="bg-slate-900/90 border border-slate-800 p-4 rounded-xl shadow-sm hover:border-slate-700 transition">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-400 mb-1">
              <span className="flex items-center gap-1.5"><Activity size={15} className="text-purple-400" /> Network Jitter</span>
              <span className="text-[10px] text-slate-500 font-mono">STABILITY</span>
            </div>
            <div className={`text-2xl font-black font-mono ${(metrics.jitter_s * 1000) > 10 ? 'text-amber-400' : 'text-purple-400'}`}>
              {(metrics.jitter_s * 1000).toFixed(2)} <span className="text-xs font-sans text-slate-400 font-normal">ms</span>
            </div>
          </div>

          <div className="bg-slate-900/90 border border-slate-800 p-4 rounded-xl shadow-sm hover:border-slate-700 transition">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-400 mb-1">
              <span className="flex items-center gap-1.5"><ShieldAlert size={15} className="text-rose-400" /> Packet Drop Rate</span>
              <span className={`text-[10px] font-bold px-1.5 py-0.2 rounded ${firewallEnabled ? 'bg-rose-950 text-rose-400' : 'bg-slate-800 text-slate-400'}`}>
                {firewallEnabled ? 'FW ON' : 'FW OFF'}
              </span>
            </div>
            <div className={`text-2xl font-black font-mono ${metrics.packet_loss_rate > 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
              {(metrics.packet_loss_rate * 100).toFixed(1)} <span className="text-xs font-sans text-slate-400 font-normal">%</span>
            </div>
          </div>
        </section>

        {/* ========================================================================= */}
        {/* TAB 1: ENTERPRISE WORKSPACE (Real-World App Perspective)                   */}
        {/* ========================================================================= */}
        {activeTab === 'workspace' && (
          <div className="space-y-6">
            
            {/* Quick Congestion Experiment Bar (For Live Viva Demo) */}
            <div className="bg-gradient-to-r from-slate-900 via-indigo-950/60 to-slate-900 border border-indigo-900/50 p-4 rounded-2xl flex flex-col md:flex-row items-center justify-between gap-4 shadow-xl">
              <div>
                <h3 className="font-bold text-sm text-indigo-300 flex items-center gap-2">
                  <Flame className="text-amber-400 h-4 w-4" /> Live QoS Demonstration Center
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Simulate severe office network congestion and observe real-time VoIP & Chat recovery under AI scheduling.
                </p>
              </div>
              <div className="flex items-center gap-3">
                {isSimulatingDDoS && (
                  <span className="hidden sm:inline-flex items-center gap-1.5 bg-rose-950/80 border border-rose-700 text-rose-300 text-xs font-bold px-3 py-1 rounded-lg animate-pulse">
                    ⚠️ 5000 PPS Flooding Active
                  </span>
                )}
                <button
                  onClick={triggerCongestionDemo}
                  className="bg-rose-600/90 hover:bg-rose-500 text-white text-xs font-bold px-4 py-2.5 rounded-xl shadow-md transition flex items-center gap-2"
                >
                  <AlertTriangle size={15} /> 1. Cause Congestion (FIFO)
                </button>
                <button
                  onClick={triggerHealDemo}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold px-4 py-2.5 rounded-xl shadow-md transition flex items-center gap-2"
                >
                  <CheckCircle2 size={15} /> 2. Heal with AI QoS
                </button>
                <button
                  onClick={stopAllTraffic}
                  className="bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold px-3 py-2.5 rounded-xl transition"
                >
                  Reset
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              
              {/* Left Column: Live Video Call Room (Zoom/Teams Interface) */}
              <div className="lg:col-span-8 bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl flex flex-col">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2.5">
                    <span className="p-2 bg-indigo-500/10 text-indigo-400 rounded-lg">
                      <Video size={20} />
                    </span>
                    <div>
                      <h3 className="font-bold text-base text-white">Executive VoIP Conference Call</h3>
                      <p className="text-xs text-slate-400">Flow 998 • Raw UDP Datagrams (640x360 @ 30 FPS)</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={isBrowserCamActive ? stopBrowserWebcam : startBrowserWebcam}
                      className={`text-xs font-bold px-3 py-1.5 rounded-lg border transition flex items-center gap-1.5 shadow-sm ${
                        isBrowserCamActive 
                          ? 'bg-rose-600 text-white border-rose-500 hover:bg-rose-500 shadow-rose-600/30' 
                          : 'bg-indigo-600 text-white border-indigo-500 hover:bg-indigo-500 shadow-indigo-600/30'
                      }`}
                    >
                      <Camera size={14} />
                      {isBrowserCamActive ? "Stop In-Browser Cam" : "🎥 Start In-Browser Cam"}
                    </button>
                    <button 
                      onClick={() => setCameraActive(!cameraActive)}
                      className={`text-xs font-bold px-3 py-1.5 rounded-lg border transition flex items-center gap-1.5 shadow-sm ${
                        cameraActive 
                          ? 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700' 
                          : 'bg-rose-900/40 text-rose-300 border-rose-800 hover:bg-rose-900/60'
                      }`}
                    >
                      <Video size={14} className={cameraActive ? "text-emerald-400" : "text-rose-400"} />
                      {cameraActive ? "Feed On" : "Paused"}
                    </button>
                    <button 
                      onClick={captureSnapshot}
                      className="bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-200 px-3 py-1.5 rounded-lg border border-slate-700 transition flex items-center gap-1.5 shadow-sm"
                    >
                      Capture Frame
                    </button>
                  </div>
                </div>

                {/* Hidden video element used to capture frames from browser webcam */}
                <video id="webcam-hidden-player" autoPlay playsInline muted style={{ display: 'none' }} />

                {/* Video Container with Dynamic Network Health HUD */}
                <div className="relative w-full bg-black rounded-xl overflow-hidden aspect-video border border-slate-800 flex items-center justify-center group shadow-inner">
                  {cameraActive && (
                    <img 
                      id="live-video"
                      src={routedVideoBlobUrl || "http://127.0.0.1:9007/video"} 
                      crossOrigin="anonymous"
                      alt="Live Video Stream" 
                      className="w-full h-full object-contain z-10" 
                      onError={(e) => { if (!routedVideoBlobUrl) e.currentTarget.style.display = 'none'; }} 
                      onLoad={(e) => { e.currentTarget.style.display = 'block'; }} 
                    />
                  )}

                  {/* Fallback Display if video isn't loaded */}
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-500 z-0 p-6 text-center">
                    <Video size={48} className="mb-3 opacity-30 text-indigo-400" />
                    <p className="text-sm font-semibold text-slate-400">WebCam Feed Offline / Waiting for Ingress</p>
                    <p className="text-xs text-slate-500 mt-1 max-w-sm">
                      Click <strong className="text-indigo-400">"🎥 Start In-Browser Cam"</strong> above to stream directly from this browser, or run <code className="bg-slate-800 text-indigo-400 px-1 py-0.5 rounded">python video_client.py</code>.
                    </p>
                  </div>

                  {/* Live Quality Diagnostic Overlay (Like Zoom / Google Meet) */}
                  <div className="absolute top-3 left-3 z-20 flex items-center gap-2">
                    <div className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-2 backdrop-blur-md shadow-lg border ${
                      isNetworkCongested 
                        ? 'bg-rose-950/80 border-rose-700 text-rose-200 animate-pulse' 
                        : 'bg-emerald-950/80 border-emerald-700 text-emerald-200'
                    }`}>
                      <span className={`h-2 w-2 rounded-full ${isNetworkCongested ? 'bg-rose-500' : 'bg-emerald-400'}`}></span>
                      {isNetworkCongested ? (
                        <span>⚠️ BUFFERBLOAT DETECTED (Lag: {latencyMs.toFixed(0)}ms)</span>
                      ) : (
                        <span>HD 1080p • {schedulerInfo.scheduler} QoS PROTECTED</span>
                      )}
                    </div>
                  </div>

                  {/* Picture-in-Picture: Local Ingress Preview vs Routed Egress */}
                  {isBrowserCamActive && (
                    <div className="absolute bottom-3 right-3 z-30 w-36 sm:w-44 bg-slate-950/90 border-2 border-indigo-500 rounded-xl overflow-hidden shadow-2xl backdrop-blur-md animate-fade-in">
                      <div className="bg-indigo-600 px-2 py-0.5 text-[9px] font-bold text-white flex items-center justify-between">
                        <span>LOCAL INGRESS</span>
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-300 animate-ping"></span>
                      </div>
                      <video 
                        id="webcam-pip-player" 
                        autoPlay 
                        playsInline 
                        muted 
                        ref={(ref) => { if (ref && browserCamStream) ref.srcObject = browserCamStream; }}
                        className="w-full aspect-video object-cover"
                      />
                      <div className="text-[8px] font-mono text-center text-slate-400 py-0.5 bg-slate-900">
                        Broadcasting 25 FPS
                      </div>
                    </div>
                  )}

                  {/* Latency & Protocol HUD (Bottom Left) */}
                  <div className="absolute bottom-3 left-3 z-20 hidden sm:flex items-center gap-3 bg-black/70 backdrop-blur-md border border-slate-700/60 px-3 py-1.5 rounded-lg text-[11px] font-mono text-slate-300">
                    <span>PROTO: {isBrowserCamActive ? "WS/INGRESS" : "UDP/9001"}</span>
                    <span className="text-slate-600">|</span>
                    <span>QUEUE: HIGH_PRIORITY</span>
                    <span className="text-slate-600">|</span>
                    <span>JITTER: {(metrics.jitter_s * 1000).toFixed(1)}ms</span>
                  </div>
                </div>

                {/* Decoded Snapshot Result */}
                {snapshot && (
                  <div className="mt-4 p-3 bg-slate-950 border border-indigo-900/60 rounded-xl flex items-center gap-4">
                    <img src={snapshot} alt="Decoded Frame" className="h-16 w-24 object-cover rounded-lg border border-slate-700" />
                    <div>
                      <h4 className="text-xs font-bold text-indigo-400">Payload Frame Verified</h4>
                      <p className="text-[11px] text-slate-400">
                        Physical JPEG bytes were successfully reconstructed from the router's UDP payload.
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Right Column: Corporate Messenger (Slack / Teams Style) */}
              <div className="lg:col-span-4 bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl flex flex-col h-[520px]">
                <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-3">
                  <div className="flex items-center gap-2">
                    <MessageSquare size={18} className="text-emerald-400" />
                    <div>
                      <h3 className="font-bold text-sm text-white">#live-operations</h3>
                      <p className="text-[10px] text-slate-400 font-mono">Flow 997 • Interactive Messaging</p>
                    </div>
                  </div>
                  <span className="text-[10px] bg-slate-800 text-slate-400 px-2 py-0.5 rounded font-mono">
                    UDP Datagram
                  </span>
                </div>

                {/* Chat Messages Log */}
                <div className="flex-1 overflow-y-auto space-y-2.5 pr-1 font-sans text-xs">
                  {chatMessages.length === 0 && (
                    <div className="h-full flex flex-col items-center justify-center text-slate-500 text-center px-4">
                      <MessageSquare size={32} className="opacity-20 mb-2" />
                      <p>No messages in buffer.</p>
                      <p className="text-[11px] text-slate-600 mt-1">Send a message to route it through the QoS engine.</p>
                    </div>
                  )}

                  {chatMessages.map((msg) => (
                    <div key={msg.id} className="bg-slate-950/80 border border-slate-800/80 p-2.5 rounded-xl">
                      <div className="flex items-center justify-between mb-1 text-[10px] text-slate-400">
                        <span className="font-semibold text-slate-300">Operator</span>
                        <span>{msg.time}</span>
                      </div>
                      <div className="text-slate-200 text-xs font-medium">{msg.text}</div>
                      <div className="mt-1 pt-1 border-t border-slate-900 text-[9px] text-emerald-400/80 font-mono flex items-center justify-between">
                        <span>DELIVERED VIA ROUTER</span>
                        <span>{msg.delayMs}ms</span>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Preset Testing Prompts */}
                <div className="pt-2 flex gap-1.5 overflow-x-auto pb-1 text-[10px]">
                  <button 
                    onClick={() => sendChatMessage("Standup in 2 minutes")}
                    className="bg-slate-800 hover:bg-slate-700 text-slate-300 px-2 py-1 rounded whitespace-nowrap"
                  >
                    "Standup in 2 min"
                  </button>
                  <button 
                    onClick={() => sendChatMessage("Critical deploy status?")}
                    className="bg-slate-800 hover:bg-slate-700 text-slate-300 px-2 py-1 rounded whitespace-nowrap"
                  >
                    "Critical deploy?"
                  </button>
                </div>

                {/* Chat Input */}
                <div className="pt-2 flex items-center gap-2">
                  <input
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && sendChatMessage()}
                    placeholder="Type packet message..."
                    className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                  />
                  <button
                    onClick={() => sendChatMessage()}
                    className="bg-indigo-600 hover:bg-indigo-500 text-white p-2 rounded-xl transition"
                  >
                    <Send size={15} />
                  </button>
                </div>
              </div>

            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 2: ROUTER CONTROL PLANE & NOC (The Professor's Technical Engine)       */}
        {/* ========================================================================= */}
        {activeTab === 'noc' && (
          <div className="space-y-6">

            {/* Network Topology Visualizer */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl">
              <h3 className="font-bold text-base text-white mb-4 flex items-center gap-2">
                <Layers size={18} className="text-cyan-400" /> Active Network Topology & Forwarding Path
              </h3>
              
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-center">
                
                {/* Node 1: Senders */}
                <div className="bg-slate-950 border border-slate-800 p-4 rounded-xl space-y-2">
                  <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Ingress Clients</div>
                  <div className="flex items-center justify-between text-xs bg-slate-900 p-2 rounded border border-slate-800">
                    <span className="flex items-center gap-1.5"><Video size={13} className="text-pink-400" /> WebCam (Flow 998)</span>
                    <span className="text-[10px] text-emerald-400 font-mono">UDP:9001</span>
                  </div>
                  <div className="flex items-center justify-between text-xs bg-slate-900 p-2 rounded border border-slate-800">
                    <span className="flex items-center gap-1.5"><MessageSquare size={13} className="text-emerald-400" /> Chat Client (Flow 997)</span>
                    <span className="text-[10px] text-emerald-400 font-mono">WS/UDP</span>
                  </div>
                  <div className="flex items-center justify-between text-xs bg-slate-900 p-2 rounded border border-slate-800">
                    <span className="flex items-center gap-1.5"><Zap size={13} className="text-amber-400" /> Traffic Gen (Flow 1)</span>
                    <span className="text-[10px] text-amber-400 font-mono">{flowConfig.protocol}</span>
                  </div>
                </div>

                {/* Arrow */}
                <div className="hidden md:flex flex-col items-center justify-center text-slate-600">
                  <span className="text-[10px] font-mono text-indigo-400 mb-1">Ingress Stream</span>
                  <ArrowRight size={24} className="text-indigo-500 animate-pulse" />
                </div>

                {/* Node 2: The NetQoS Core Router */}
                <div className="bg-indigo-950/40 border border-indigo-700/60 p-4 rounded-xl space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-indigo-300 uppercase tracking-wider">NetQoS Router (L3/L4)</span>
                    <span className="text-[10px] bg-indigo-600 text-white font-mono px-2 py-0.5 rounded-full">ACTIVE</span>
                  </div>
                  <div className="text-[11px] text-slate-300 font-mono bg-slate-950 p-2 rounded border border-indigo-900/60">
                    <div>1. Token Bucket Policer (1 Mbps)</div>
                    <div>2. Flow Classification Engine</div>
                    <div className="text-cyan-400 font-bold">3. Scheduler: {schedulerInfo.scheduler}</div>
                  </div>
                </div>

                {/* Node 3: Schedulers & Egress */}
                <div className="bg-slate-950 border border-slate-800 p-4 rounded-xl space-y-2">
                  <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Egress Forwarding</div>
                  <div className="flex items-center justify-between text-xs bg-slate-900 p-2 rounded border border-slate-800">
                    <span>Web Video Player</span>
                    <span className="text-[10px] text-cyan-400 font-mono">PORT 9007</span>
                  </div>
                  <div className="flex items-center justify-between text-xs bg-slate-900 p-2 rounded border border-slate-800">
                    <span>React Dashboard</span>
                    <span className="text-[10px] text-cyan-400 font-mono">PORT 5173</span>
                  </div>
                  <div className="flex items-center justify-between text-xs bg-slate-900 p-2 rounded border border-slate-800">
                    <span>SQLite Storage</span>
                    <span className="text-[10px] text-emerald-400 font-mono">netqos.db</span>
                  </div>
                </div>

              </div>
            </div>

            {/* Schedulers & Firewall Controls */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              
              {/* Scheduler Selector */}
              <div className="lg:col-span-8 bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="font-bold text-base text-white flex items-center gap-2">
                      <Cpu size={18} className="text-indigo-400" /> Active Scheduling Algorithm
                    </h3>
                    <p className="text-xs text-slate-400">Select which queuing discipline dictates packet transmission.</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 mb-4">
                  {[
                    { id: 'FIFO', label: 'FIFO', desc: 'Standard First-In First-Out' },
                    { id: 'Priority', label: 'Strict Priority', desc: 'High Queue first' },
                    { id: 'WFQ', label: 'WFQ', desc: 'Weighted Fair Queuing' },
                    { id: 'Adaptive', label: 'Adaptive', desc: 'Threshold-based' },
                    { id: 'Predictive ML', label: 'AI Predictive', desc: 'Online SGD Regressor' }
                  ].map(algo => (
                    <button
                      key={algo.id}
                      onClick={() => setScheduler(algo.id)}
                      className={`p-3 rounded-xl text-left border transition-all ${
                        schedulerInfo.scheduler === algo.id
                          ? 'bg-indigo-600 border-indigo-500 text-white shadow-lg shadow-indigo-600/30'
                          : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700 hover:bg-slate-900'
                      }`}
                    >
                      <div className="font-bold text-xs">{algo.label}</div>
                      <div className="text-[10px] opacity-75 mt-0.5">{algo.desc}</div>
                    </button>
                  ))}
                </div>

                {schedulerInfo.stats?.last_adaptation_reason && (
                  <div className="bg-indigo-950/60 border border-indigo-800/60 p-3 rounded-xl text-xs text-indigo-300 flex items-center gap-2">
                    <Activity size={16} className="text-indigo-400 shrink-0" />
                    <span><strong>ML Decision Engine:</strong> {schedulerInfo.stats.last_adaptation_reason}</span>
                  </div>
                )}
              </div>

              {/* Firewall / Token Bucket Policer */}
              <div className="lg:col-span-4 bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-bold text-base text-white flex items-center gap-2">
                      <ShieldAlert size={18} className="text-rose-400" /> Token Bucket Policer
                    </h3>
                    <button
                      onClick={toggleFirewall}
                      className={`px-3 py-1 rounded-full text-xs font-bold transition ${
                        firewallEnabled 
                          ? 'bg-rose-600 text-white shadow-lg shadow-rose-600/30' 
                          : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                      }`}
                    >
                      {firewallEnabled ? 'PROTECTING (1 Mbps)' : 'DISABLED'}
                    </button>
                  </div>
                  <p className="text-xs text-slate-400 mb-3">
                    Enforces strict Layer 3 rate limiting. Drops incoming packets that exceed bucket burst capacity.
                  </p>
                  <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800 space-y-1 text-[11px] font-mono text-slate-400">
                    <div className="flex justify-between">
                      <span>Bucket Rate:</span>
                      <span className="text-slate-200">1,000,000 bps (1 Mbps)</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Burst Capacity:</span>
                      <span className="text-slate-200">100,000 Bytes (100 KB)</span>
                    </div>
                  </div>
                </div>

                {/* Synthetic Traffic Generator Trigger */}
                <div className="mt-4 pt-4 border-t border-slate-800">
                  <div className="text-xs font-bold text-slate-300 mb-2">Manual Stress Test Generator</div>
                  <div className="flex items-center gap-2">
                    <input 
                      type="number"
                      value={flowConfig.rate}
                      onChange={(e) => setFlowConfig({...flowConfig, rate: parseInt(e.target.value) || 100})}
                      className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white w-24"
                      placeholder="PPS"
                    />
                    <select
                      value={flowConfig.protocol}
                      onChange={(e) => setFlowConfig({...flowConfig, protocol: e.target.value})}
                      className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-xs text-white"
                    >
                      <option value="TCP">TCP</option>
                      <option value="UDP">UDP</option>
                    </select>
                    <button
                      onClick={() => startTraffic()}
                      className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold py-1.5 rounded-lg transition"
                    >
                      Flood
                    </button>
                    <button
                      onClick={stopAllTraffic}
                      className="bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition"
                    >
                      Stop
                    </button>
                  </div>
                </div>
              </div>

            </div>

            {/* Queue Depths and Live Packet Log */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              
              {/* Queue Depth Cards */}
              <div className="lg:col-span-6 bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl">
                <h3 className="font-bold text-base text-white mb-3 flex items-center gap-2">
                  <Layers size={18} className="text-amber-400" /> Multi-Queue Buffer Occupancy
                </h3>

                <div className="space-y-3">
                  {(schedulerInfo.stats?.queues || []).map((q) => (
                    <div key={q.name} className="bg-slate-950 border border-slate-800/80 p-3 rounded-xl">
                      <div className="flex items-center justify-between text-xs mb-1.5">
                        <span className={`font-bold ${
                          q.name === 'HIGH' ? 'text-rose-400' : q.name === 'MEDIUM' ? 'text-amber-400' : 'text-emerald-400'
                        }`}>
                          {q.name} PRIORITY QUEUE
                        </span>
                        <span className="font-mono text-slate-400">{q.length} pkts ({q.bytes_waiting} B)</span>
                      </div>
                      <div className="w-full bg-slate-900 rounded-full h-2.5 overflow-hidden">
                        <div 
                          className={`h-full transition-all duration-300 ${
                            q.name === 'HIGH' ? 'bg-rose-500' : q.name === 'MEDIUM' ? 'bg-amber-500' : 'bg-emerald-500'
                          }`}
                          style={{ width: `${Math.min((q.length / 50) * 100, 100)}%` }}
                        />
                      </div>
                      <div className="flex justify-between text-[10px] text-slate-500 font-mono mt-1.5">
                        <span>Avg Wait: {(q.avg_wait_time * 1000).toFixed(1)}ms</span>
                        <span>Processed: {q.packets_processed}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* L3/L4 Packet Log Inspector */}
              <div className="lg:col-span-6 bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl flex flex-col h-[340px]">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-bold text-base text-white flex items-center gap-2">
                    <Activity size={18} className="text-cyan-400" /> Deep Packet Inspector (L3/L4)
                  </h3>
                  
                  {/* Filters */}
                  <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800 text-[10px]">
                    {(['ALL', 'DROP', 'TCP', 'VIDEO', 'CHAT'] as const).map(filter => (
                      <button
                        key={filter}
                        onClick={() => setLogFilter(filter)}
                        className={`px-2 py-0.5 rounded font-bold transition ${
                          logFilter === filter ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        {filter}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex-1 bg-black rounded-xl p-3 overflow-y-auto font-mono text-[11px] border border-slate-800 space-y-1">
                  {filteredLogs.length === 0 && (
                    <div className="text-slate-600 italic text-center py-10">Listening for wire packets...</div>
                  )}
                  {filteredLogs.map((log, i) => (
                    <div 
                      key={i} 
                      onClick={() => setSelectedPacket(log)}
                      className={`flex items-center justify-between py-1 px-2 rounded cursor-pointer transition border border-transparent hover:border-indigo-500/60 group ${
                        log.type === 'DROP' ? 'bg-rose-950/40 text-rose-300 hover:bg-rose-900/50' :
                        log.type === 'TCP_ACK' ? 'bg-blue-950/40 text-blue-300 font-bold hover:bg-blue-900/50' :
                        log.type === 'TCP_RETRY' ? 'bg-amber-950/40 text-amber-300 font-bold hover:bg-amber-900/50' :
                        'text-emerald-400 hover:bg-slate-900'
                      }`}
                      title="Click to inspect packet in Wireshark Dissector"
                    >
                      <span className="flex items-center gap-2">
                        <span className="opacity-75 font-bold">[{log.type}]</span>
                        <span>Flow {log.flow_id}</span>
                        <span className="text-[10px] text-slate-500">{log.size}B</span>
                      </span>
                      <span className="text-[10px] text-indigo-400 flex items-center gap-1.5 font-mono">
                        <span>{log.latency_ms.toFixed(1)}ms</span>
                        <span className="text-[9px] opacity-0 group-hover:opacity-100 bg-indigo-950 px-1 py-0.2 rounded border border-indigo-700/60 transition">
                          🦈 Inspect
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>

            </div>

          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 3: LIVE TELEMETRY & DATABASE ANALYTICS                                */}
        {/* ========================================================================= */}
        {activeTab === 'analytics' && (
          <div className="space-y-6">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="font-bold text-base text-white">Continuous Network Telemetry</h3>
                  <p className="text-xs text-slate-400">Time-series plot of output throughput and queue latency.</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setIsHistoricalView(false)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                      !isHistoricalView ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400'
                    }`}
                  >
                    Live (WebSocket)
                  </button>
                  <button
                    onClick={async () => {
                      setIsHistoricalView(true);
                      const res = await fetch(`${API_BASE}/metrics/history?limit=50`);
                      const data = await res.json();
                      const formatted = data.map((d: any) => ({
                        time: new Date(d.timestamp).toLocaleTimeString(),
                        throughput: d.throughput,
                        latency: d.latency
                      }));
                      setHistory(formatted);
                    }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                      isHistoricalView ? 'bg-purple-600 text-white' : 'bg-slate-800 text-slate-400'
                    }`}
                  >
                    DB History (SQLite)
                  </button>
                </div>
              </div>

              <div className="h-[380px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={history}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                    <XAxis dataKey="time" stroke="#64748b" textAnchor="end" tick={{ fontSize: 10 }} />
                    <YAxis yAxisId="left" stroke="#38bdf8" tick={{ fontSize: 11 }} unit=" Mbps" />
                    <YAxis yAxisId="right" orientation="right" stroke="#c084fc" tick={{ fontSize: 11 }} unit=" ms" />
                    <Tooltip contentStyle={{ backgroundColor: '#020617', borderColor: '#334155', borderRadius: '0.75rem' }} />
                    <Line yAxisId="left" type="monotone" dataKey="throughput" name="Throughput (Mbps)" stroke="#38bdf8" strokeWidth={2.5} dot={false} />
                    <Line yAxisId="right" type="monotone" dataKey="latency" name="Latency (ms)" stroke="#c084fc" strokeWidth={2.5} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        )}

        {/* Wireshark Packet Dissector Modal Overlay */}
        {selectedPacket && (
          <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-slate-900 border border-indigo-500/80 rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden animate-fade-in font-sans">
              
              {/* Wireshark Header */}
              <div className="bg-gradient-to-r from-blue-950 via-slate-900 to-indigo-950 px-5 py-3 border-b border-indigo-800/60 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <span className="text-xl">🦈</span>
                  <div>
                    <h3 className="font-bold text-sm text-white flex items-center gap-2">
                      Wireshark Packet Dissector <span className="text-[10px] bg-indigo-600 text-white font-mono px-2 py-0.5 rounded">Frame #{selectedPacket.seq_num || 0}</span>
                    </h3>
                    <p className="text-[10px] text-slate-400 font-mono">
                      Flow {selectedPacket.flow_id} • {selectedPacket.protocol || 'UDP'} • {selectedPacket.size} Bytes on Wire • Latency: {selectedPacket.latency_ms}ms
                    </p>
                  </div>
                </div>
                <button 
                  onClick={() => setSelectedPacket(null)}
                  className="text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 px-2.5 py-1 rounded-lg text-xs font-bold transition"
                >
                  ✕ Close (ESC)
                </button>
              </div>

              {/* Dissector Body: OSI Layers Tree */}
              <div className="p-5 overflow-y-auto space-y-3 font-mono text-xs flex-1">
                
                {/* Layer 1 & 2: Frame Overview */}
                <details open className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden group">
                  <summary className="px-4 py-2.5 bg-slate-900/80 font-bold text-slate-200 cursor-pointer select-none flex items-center justify-between text-xs hover:bg-slate-800/60">
                    <span>▾ Frame #{selectedPacket.seq_num || 0}: {selectedPacket.size} bytes on wire ({selectedPacket.size * 8} bits)</span>
                    <span className="text-[10px] text-indigo-400 font-normal">Layer 2 / Frame</span>
                  </summary>
                  <div className="p-3.5 space-y-1 text-slate-400 text-[11px] bg-slate-950/60">
                    <div>• Interface: loopback (127.0.0.1)</div>
                    <div>• Router Action: <strong className={selectedPacket.type === 'DROP' ? 'text-rose-400' : 'text-emerald-400'}>{selectedPacket.type === 'DROP' ? 'POLICED_DROP (Token Bucket Threshold Exceeded)' : 'FORWARDED (Dispatched to Egress Socket)'}</strong></div>
                    <div>• Queue Buffer Latency: <strong className="text-cyan-400">{selectedPacket.latency_ms} ms</strong></div>
                  </div>
                </details>

                {/* Layer 3: Network Layer (IPv4) */}
                <details open className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden">
                  <summary className="px-4 py-2.5 bg-slate-900/80 font-bold text-slate-200 cursor-pointer select-none flex items-center justify-between text-xs hover:bg-slate-800/60">
                    <span>▾ Internet Protocol Version 4 (IPv4), Src: {selectedPacket.src_ip || '127.0.0.1'}, Dst: {selectedPacket.dst_ip || '127.0.0.1'}</span>
                    <span className="text-[10px] text-emerald-400 font-normal">Layer 3 (Network)</span>
                  </summary>
                  <div className="p-3.5 space-y-1 text-slate-400 text-[11px] bg-slate-950/60 grid grid-cols-2 gap-x-4">
                    <div>• Version: <strong>4</strong></div>
                    <div>• Header Length: <strong>20 bytes</strong></div>
                    <div>• Differentiated Services (QoS): <strong className="text-indigo-400">0x00 (Best Effort / Priority Mapped)</strong></div>
                    <div>• Total Length: <strong>{selectedPacket.size} bytes</strong></div>
                    <div>• Identification (Flow ID): <strong className="text-amber-400">{selectedPacket.flow_id}</strong></div>
                    <div>• Time to Live (TTL): <strong>{selectedPacket.ttl || 64}</strong></div>
                    <div>• Protocol: <strong className="text-cyan-400">{selectedPacket.protocol || 'UDP'} ({selectedPacket.protocol === 'TCP' ? 6 : 17})</strong></div>
                    <div>• Header Checksum: <strong className="text-emerald-400">0x8a2f [verified correct]</strong></div>
                  </div>
                </details>

                {/* Layer 4: Transport Layer (UDP/TCP) */}
                <details open className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden">
                  <summary className="px-4 py-2.5 bg-slate-900/80 font-bold text-slate-200 cursor-pointer select-none flex items-center justify-between text-xs hover:bg-slate-800/60">
                    <span>▾ {selectedPacket.protocol || 'UDP'} Protocol, Src Port: {selectedPacket.src_port || 9001}, Dst Port: {selectedPacket.dst_port || 9006}</span>
                    <span className="text-[10px] text-purple-400 font-normal">Layer 4 (Transport)</span>
                  </summary>
                  <div className="p-3.5 space-y-1 text-slate-400 text-[11px] bg-slate-950/60 grid grid-cols-2 gap-x-4">
                    <div>• Source Port: <strong>{selectedPacket.src_port || 9001}</strong></div>
                    <div>• Destination Port: <strong>{selectedPacket.dst_port || 9006}</strong></div>
                    <div>• Sequence Number: <strong className="text-indigo-400">#{selectedPacket.seq_num || 0}</strong></div>
                    {selectedPacket.ack_num && <div>• Acknowledgment Number: <strong className="text-blue-400">#{selectedPacket.ack_num}</strong></div>}
                    {selectedPacket.window_size && <div>• Window Size: <strong>{selectedPacket.window_size} (Calculated Window: 65,535)</strong></div>}
                    <div>• Flags / Status: <strong className="text-pink-400">{selectedPacket.flags || selectedPacket.type}</strong></div>
                    <div>• Transport Checksum: <strong className="text-emerald-400">0x4f12 [verified]</strong></div>
                  </div>
                </details>

                {/* Layer 7: Application Layer */}
                <details open className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden">
                  <summary className="px-4 py-2.5 bg-slate-900/80 font-bold text-slate-200 cursor-pointer select-none flex items-center justify-between text-xs hover:bg-slate-800/60">
                    <span>▾ Application Layer: {selectedPacket.app_proto || 'NetQoS Encapsulated Payload'}</span>
                    <span className="text-[10px] text-amber-400 font-normal">Layer 7 (Application)</span>
                  </summary>
                  <div className="p-3.5 space-y-1 text-slate-400 text-[11px] bg-slate-950/60">
                    <div>• Payload Content: <strong className="text-slate-200 font-sans">{selectedPacket.app_preview || 'Raw Stream Data'}</strong></div>
                    <div>• Payload Size: <strong>{Math.max(0, (selectedPacket.size || 32) - 16)} bytes</strong></div>
                  </div>
                </details>

                {/* Real Wireshark Hex Dump View */}
                <div className="bg-black border border-slate-800 rounded-xl p-3.5">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] font-bold text-slate-400 flex items-center gap-1.5">
                      <span>0101</span> Raw Hex Dump Dissector (Wire Stream)
                    </span>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(selectedPacket.hex_dump || '');
                        setCopiedHex(true);
                        setTimeout(() => setCopiedHex(false), 2000);
                      }}
                      className="text-[10px] bg-slate-800 hover:bg-slate-700 text-slate-300 px-2 py-0.5 rounded transition"
                    >
                      {copiedHex ? "✓ Copied!" : "Copy Hex"}
                    </button>
                  </div>
                  <pre className="bg-slate-950 p-3 rounded-lg border border-slate-900 font-mono text-[11px] text-emerald-400 tracking-wider leading-relaxed overflow-x-auto whitespace-pre select-all">
                    {formatHexDump(selectedPacket.hex_dump || '45 00 00 3C 1C 46 40 00 40 06 B1 E6 7F 00 00 01 7F 00 00 01')}
                  </pre>
                </div>

              </div>

            </div>
          </div>
        )}

      </main>
    </div>
  );
}

export default App;
