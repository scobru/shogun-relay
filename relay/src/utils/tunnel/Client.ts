import http, { IncomingMessage, ServerResponse } from "http";
import { EventEmitter } from "events";
import { Socket } from "net";
import { loggers } from "../logger";
import TunnelAgent from "./TunnelAgent";

// Use dynamic import for pump since it might not have proper TS types
const pump = require("pump");

/**
 * Client - Encapsulates req/res handling using a TunnelAgent
 *
 * If the agent is destroyed, the request handling will error.
 * The caller is responsible for handling a failed request.
 */
class Client extends EventEmitter {
  public readonly id: string;
  private agent: TunnelAgent;
  private graceTimeout: NodeJS.Timeout | null = null;

  constructor(options: { id: string; agent: TunnelAgent }) {
    super();

    this.id = options.id;
    this.agent = options.agent;

    // Client is given a grace period in which they can connect before they are removed
    this.graceTimeout = setTimeout(() => {
      this.close();
    }, 10000); // 10 seconds grace period
    this.graceTimeout.unref();

    this.agent.on("online", () => {
      loggers.server.debug({ clientId: this.id }, "Tunnel client online");
      if (this.graceTimeout) {
        clearTimeout(this.graceTimeout);
        this.graceTimeout = null;
      }
    });

    this.agent.on("offline", () => {
      loggers.server.debug({ clientId: this.id }, "Tunnel client offline");

      // If there was a previous timeout set, we don't want to double trigger
      if (this.graceTimeout) {
        clearTimeout(this.graceTimeout);
      }

      // Client is given a grace period in which they can re-connect before they are removed
      this.graceTimeout = setTimeout(() => {
        this.close();
      }, 5000); // 5 seconds grace period for reconnection
      this.graceTimeout.unref();
    });

    this.agent.once("error", (err: Error) => {
      loggers.server.error({ err, clientId: this.id }, "Tunnel agent error");
      this.close();
    });
  }

  /**
   * Get tunnel statistics
   */
  stats() {
    return this.agent.stats();
  }

  /**
   * Close the tunnel client
   */
  close() {
    if (this.graceTimeout) {
      clearTimeout(this.graceTimeout);
      this.graceTimeout = null;
    }
    this.agent.destroy();
    this.emit("close");
  }

  /**
   * Handle an incoming HTTP request through the tunnel
   */
  handleRequest(req: IncomingMessage, res: ServerResponse) {
    loggers.server.debug({ clientId: this.id, url: req.url, method: req.method }, "Tunnel handling request");

    const opt: http.RequestOptions = {
      path: req.url,
      agent: this.agent as unknown as http.Agent,
      method: req.method,
      headers: req.headers,
    };

    const clientReq = http.request(opt, (clientRes) => {
      loggers.server.debug({ clientId: this.id, url: req.url, status: clientRes.statusCode }, "Tunnel response received");

      // Write response code and headers
      res.writeHead(clientRes.statusCode || 500, clientRes.headers);

      // Using pump to handle stream piping
      pump(clientRes, res);
    });

    // This can happen when underlying agent produces an error
    clientReq.once("error", (err: Error) => {
      loggers.server.error({ err, clientId: this.id, url: req.url }, "Tunnel request error");
      if (!res.headersSent) {
        res.writeHead(502, { "Content-Type": "text/plain" });
        res.end("Bad Gateway: Tunnel connection failed");
      }
    });

    // Pipe the incoming request to the tunnel
    pump(req, clientReq);
  }

  /**
   * Handle WebSocket upgrade through the tunnel
   */
  handleUpgrade(req: IncomingMessage, socket: Socket) {
    loggers.server.debug({ clientId: this.id, url: req.url }, "Tunnel handling upgrade");

    socket.once("error", (err: NodeJS.ErrnoException) => {
      // These client side errors can happen if the client dies while we are reading
      if (err.code === "ECONNRESET" || err.code === "ETIMEDOUT") {
        return;
      }
      loggers.server.error({ err, clientId: this.id }, "Tunnel upgrade socket error");
    });

    this.agent.createConnection({}, (err, conn) => {
      loggers.server.debug({ clientId: this.id, url: req.url, hasConnection: !!conn }, "Tunnel upgrade connection created");

      // Any errors getting a connection mean we cannot service this request
      if (err || !conn) {
        loggers.server.error({ err, clientId: this.id }, "Tunnel upgrade connection failed");
        socket.end();
        return;
      }

      // Socket may have disconnected while we waiting for a socket
      if (!socket.readable || !socket.writable) {
        conn.destroy();
        socket.end();
        return;
      }

      // WebSocket requests are special - we simply re-create the header info
      // then directly pipe the socket data
      const arr = [`${req.method} ${req.url} HTTP/${req.httpVersion}`];
      for (let i = 0; i < (req.rawHeaders?.length || 0) - 1; i += 2) {
        arr.push(`${req.rawHeaders![i]}: ${req.rawHeaders![i + 1]}`);
      }
      arr.push("");
      arr.push("");

      // Using pump to handle stream piping
      pump(conn, socket);
      pump(socket, conn);
      conn.write(arr.join("\r\n"));
    });
  }
}

export default Client;
