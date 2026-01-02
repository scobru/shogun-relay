import net, { AddressInfo } from "net";
import { EventEmitter } from "events";
import { loggers } from "../logger";

const DEFAULT_MAX_SOCKETS = 10;

/**
 * TunnelAgent - Provides a pool of tunnel sockets for proxying HTTP requests
 *
 * A tunnel socket is a TCP connection FROM a localtunnel client that will
 * service HTTP requests. This class manages the TCP server and socket pool.
 */
class TunnelAgent extends EventEmitter {
  private availableSockets: net.Socket[] = [];
  private waitingCreateConn: Array<(err: Error | null, socket: net.Socket | null) => void> = [];
  private connectedSockets: number = 0;
  private maxTcpSockets: number;
  private server: net.Server;
  private started: boolean = false;
  private closed: boolean = false;
  private clientId: string;
  private eventEmitter: EventEmitter;

  constructor(options: { clientId: string; maxTcpSockets?: number }) {
    super();

    this.clientId = options.clientId;
    this.maxTcpSockets = options.maxTcpSockets || DEFAULT_MAX_SOCKETS;
    this.server = net.createServer();
    this.eventEmitter = new EventEmitter();
  }

  /**
   * Get current connection stats
   */
  stats() {
    return {
      connectedSockets: this.connectedSockets,
      availableSockets: this.availableSockets.length,
      waitingConnections: this.waitingCreateConn.length,
    };
  }

  /**
   * Start listening for client connections
   * @returns Promise with the port info
   */
  async listen(): Promise<{ port: number }> {
    if (this.started) {
      throw new Error("TunnelAgent already started");
    }
    this.started = true;

    this.server.on("close", this._onClose.bind(this));
    this.server.on("connection", this._onConnection.bind(this));
    this.server.on("error", (err: NodeJS.ErrnoException) => {
      // These errors happen from killed connections, we don't worry about them
      if (err.code === "ECONNRESET" || err.code === "ETIMEDOUT") {
        return;
      }
      loggers.server.error({ err, clientId: this.clientId }, "TunnelAgent server error");
    });

    return new Promise((resolve) => {
      this.server.listen(0, () => {
        const addr = this.server.address() as AddressInfo;
        loggers.server.debug({ port: addr.port, clientId: this.clientId }, "TunnelAgent TCP server listening");
        resolve({ port: addr.port });
      });
    });
  }

  /**
   * Handle server close
   */
  private _onClose() {
    this.closed = true;
    loggers.server.debug({ clientId: this.clientId }, "TunnelAgent closed");

    // Flush any waiting connections with error
    for (const conn of this.waitingCreateConn) {
      conn(new Error("TunnelAgent closed"), null);
    }
    this.waitingCreateConn = [];
    this.eventEmitter.emit("end");
  }

  /**
   * Handle new socket connection from localtunnel client
   */
  private _onConnection(socket: net.Socket) {
    // No more socket connections allowed
    if (this.connectedSockets >= this.maxTcpSockets) {
      loggers.server.debug({ clientId: this.clientId }, "TunnelAgent max sockets reached, rejecting connection");
      socket.destroy();
      return;
    }

    socket.once("close", (hadError) => {
      loggers.server.debug({ clientId: this.clientId, hadError }, "TunnelAgent socket closed");
      this.connectedSockets -= 1;

      // Remove the socket from available list
      const idx = this.availableSockets.indexOf(socket);
      if (idx >= 0) {
        this.availableSockets.splice(idx, 1);
      }

      if (this.connectedSockets <= 0) {
        loggers.server.debug({ clientId: this.clientId }, "TunnelAgent all sockets disconnected");
        this.eventEmitter.emit("offline");
      }
    });

    // Close will be emitted after this
    socket.once("error", (err: NodeJS.ErrnoException) => {
      // We do not log these errors, sessions can drop from clients for many reasons
      socket.destroy();
    });

    if (this.connectedSockets === 0) {
      this.eventEmitter.emit("online");
    }

    this.connectedSockets += 1;
    loggers.server.debug({ clientId: this.clientId, connectedSockets: this.connectedSockets }, "TunnelAgent new connection");

    // If there are queued callbacks, give this socket now and don't queue into available
    const fn = this.waitingCreateConn.shift();
    if (fn) {
      loggers.server.debug({ clientId: this.clientId }, "TunnelAgent giving socket to queued request");
      setTimeout(() => {
        fn(null, socket);
      }, 0);
      return;
    }

    // Make socket available for those waiting on sockets
    this.availableSockets.push(socket);
  }

  /**
   * Fetch a socket from the available socket pool for the agent
   * If no socket is available, queue the callback
   */
  createConnection(
    options: object,
    cb: (err: Error | null, socket?: net.Socket | null) => void
  ): void {
    if (this.closed) {
      cb(new Error("TunnelAgent closed"));
      return;
    }

    loggers.server.debug({ clientId: this.clientId }, "TunnelAgent createConnection requested");

    // Socket is a TCP connection back to the user hosting the site
    const sock = this.availableSockets.shift();

    // No available sockets - wait until we have one
    if (!sock) {
      this.waitingCreateConn.push(cb as (err: Error | null, socket: net.Socket | null) => void);
      loggers.server.debug(
        { clientId: this.clientId, waiting: this.waitingCreateConn.length, connected: this.connectedSockets },
        "TunnelAgent waiting for available socket"
      );
      return;
    }

    loggers.server.debug({ clientId: this.clientId }, "TunnelAgent socket given");
    cb(null, sock);
  }

  /**
   * Add event listener
   */
  on(event: string, listener: (...args: any[]) => void): this {
    this.eventEmitter.on(event, listener);
    return this;
  }

  /**
   * Add one-time event listener
   */
  once(event: string, listener: (...args: any[]) => void): this {
    this.eventEmitter.once(event, listener);
    return this;
  }

  /**
   * Emit an event
   */
  emit(event: string, ...args: any[]): boolean {
    return this.eventEmitter.emit(event, ...args);
  }

  /**
   * Destroy the agent and close the server
   */
  destroy(): void {
    this.closed = true;
    this.server.close();
    this.removeAllListeners();
    this.eventEmitter.removeAllListeners();
  }
}

export default TunnelAgent;
