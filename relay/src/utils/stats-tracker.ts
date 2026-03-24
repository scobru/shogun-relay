import { loggers } from "./logger";
import { packageConfig } from "../config/env-config";

export interface PeerStats {
  id: string;
  addr: string;
  connectedAt: number;
  msgCount: number;
  bytesSent: number;
  uptime: number; // calculated on demand
}

export interface MetricPoint {
  ts: number;
  v: number;
}

export class StatsTracker {
  private startTime = Date.now();
  private totalMessages = 0;
  private totalBytes = 0;
  private peers = new Map<string, PeerStats>();
  private msgHistory: MetricPoint[] = []; // 120 ticks rolling buffer
  private byteHistory: MetricPoint[] = []; // 120 ticks rolling buffer
  private peakPeers = 0;
  private putCount = 0;
  private getCount = 0;
  private ackCount = 0;
  private errorCount = 0;

  private tickMsgs = 0;
  private tickBytes = 0;
  private timer: NodeJS.Timeout;

  constructor() {
    this.timer = setInterval(() => this.tick(), 1000);
  }

  private pushHistory(arr: MetricPoint[], value: number) {
    arr.push({ ts: Date.now(), v: value });
    if (arr.length > 120) arr.shift();
  }

  private tick() {
    this.pushHistory(this.msgHistory, this.tickMsgs);
    this.pushHistory(this.byteHistory, this.tickBytes);
    this.tickMsgs = 0;
    this.tickBytes = 0;
  }

  public patchSocket(socket: any, addr: string) {
    if (!socket) return;
    
    // Check if already patched
    if (socket.__patchedStats) return;
    socket.__patchedStats = true;

    const id = addr + "_" + Date.now();
    const peer: PeerStats = { id, addr, connectedAt: Date.now(), msgCount: 0, bytesSent: 0, uptime: 0 };
    this.peers.set(id, peer);

    if (this.peers.size > this.peakPeers) {
      this.peakPeers = this.peers.size;
    }

    loggers.server.info(`[+] Peer connected: ${addr} (Total: ${this.peers.size})`);

    const origSend = typeof socket.send === "function" ? socket.send.bind(socket) : null;
    if (origSend) {
      socket.send = (data: any, ...args: any[]) => {
        const bytes = typeof data === "string" ? Buffer.byteLength(data) : data?.length || 0;
        peer.bytesSent += bytes;
        this.totalBytes += bytes;
        this.tickBytes += bytes;
        return origSend(data, ...args);
      };
    }

    const onMessage = (raw: any) => {
      const bytes = typeof raw === "string" ? Buffer.byteLength(raw) : raw?.length || 0;
      peer.msgCount += 1;
      this.totalMessages += 1;
      this.tickMsgs += 1;
      this.totalBytes += bytes;
      this.tickBytes += bytes;

      try {
        const msg = typeof raw === "string" ? JSON.parse(raw) : raw;
        if (msg.put) this.putCount++;
        if (msg.get) this.getCount++;
        if (msg["@"]) this.ackCount++;
      } catch (_) {
        this.errorCount++;
      }
    };

    socket.on("message", onMessage);
    
    socket.on("close", () => {
      this.peers.delete(id);
      loggers.server.info(`[-] Peer disconnected: ${addr} (Total: ${this.peers.size})`);
    });

    socket.on("error", () => {
      this.errorCount++;
    });
  }

  public getStats() {
    const now = Date.now();
    const uptimeMs = now - this.startTime;
    
    const peersArr = Array.from(this.peers.values()).map(p => ({
      ...p,
      uptime: now - p.connectedAt
    }));

    const memoryUsage = process.memoryUsage();

    return {
      success: true,
      timestamp: now,
      version: packageConfig.version || "1.0.0",
      uptime: uptimeMs,
      totalMessages: this.totalMessages,
      totalBytes: this.totalBytes,
      connectedPeers: this.peers.size,
      peakPeers: this.peakPeers,
      putCount: this.putCount,
      getCount: this.getCount,
      ackCount: this.ackCount,
      errorCount: this.errorCount,
      msgHistory: this.msgHistory,
      byteHistory: this.byteHistory,
      peers: peersArr,
      
      // Legacy structure for existing React components (mapped to new values)
      up: { time: uptimeMs },
      memory: {
        heapUsed: memoryUsage.heapUsed,
        heapTotal: memoryUsage.heapTotal,
        external: memoryUsage.external,
        rss: memoryUsage.rss,
      },
      cpu: process.cpuUsage(),
      dam: {
        in: {
          rate: this.msgHistory.length > 0 ? this.msgHistory[this.msgHistory.length - 1].v : 0,
          count: this.totalMessages
        },
        out: {
          rate: this.byteHistory.length > 0 ? this.byteHistory[this.byteHistory.length - 1].v : 0,
          count: this.totalBytes
        }
      }
    };
  }

  public destroy() {
    clearInterval(this.timer);
  }
}
