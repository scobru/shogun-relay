import { loggers } from "../logger";
import Client from "./Client";
import TunnelAgent from "./TunnelAgent";
import { hri } from "human-readable-ids";

const DEFAULT_PORT_START = 8767;
const DEFAULT_PORT_COUNT = 10; // Ports 8767-8776

interface ClientManagerOptions {
  maxTcpSockets?: number;
  portStart?: number; // Starting port for tunnel TCP connections (default: 8767)
  portCount?: number; // Number of ports in the range (default: 10)
}

interface NewClientResult {
  id: string;
  port: number;
  maxConnCount: number;
}

/**
 * ClientManager - Manages sets of tunnel clients
 *
 * A client is a "user session" established to service a remote localtunnel client.
 * Uses a port pool (default 8767-8776) to support multiple simultaneous tunnels.
 */
class ClientManager {
  private clients: Map<string, Client> = new Map();
  private clientPorts: Map<string, number> = new Map(); // Track port used by each client
  private usedPorts: Set<number> = new Set(); // Track which ports are in use
  private opt: ClientManagerOptions;
  private portStart: number;
  private portCount: number;
  public stats = {
    tunnels: 0,
  };

  constructor(opt?: ClientManagerOptions) {
    this.opt = opt || {};
    this.portStart = opt?.portStart || DEFAULT_PORT_START;
    this.portCount = opt?.portCount || DEFAULT_PORT_COUNT;
  }

  /**
   * Get an available port from the pool
   * Returns undefined if no ports are available
   */
  private getAvailablePort(): number | undefined {
    for (let i = 0; i < this.portCount; i++) {
      const port = this.portStart + i;
      if (!this.usedPorts.has(port)) {
        return port;
      }
    }
    return undefined;
  }

  /**
   * Mark a port as in use
   */
  private reservePort(port: number, clientId: string): void {
    this.usedPorts.add(port);
    this.clientPorts.set(clientId, port);
  }

  /**
   * Release a port back to the pool
   */
  private releasePort(clientId: string): void {
    const port = this.clientPorts.get(clientId);
    if (port !== undefined) {
      this.usedPorts.delete(port);
      this.clientPorts.delete(clientId);
      loggers.server.debug({ port, clientId }, "Port released back to pool");
    }
  }

  /**
   * Create a new tunnel with the given ID
   * If the ID is already used, a random ID is assigned
   * @param requestedId - The requested tunnel ID
   * @returns Promise with tunnel info
   */
  async newClient(requestedId?: string): Promise<NewClientResult> {
    // Check if we have available ports
    const port = this.getAvailablePort();
    if (port === undefined) {
      throw new Error(`No available tunnel ports. Maximum ${this.portCount} tunnels allowed.`);
    }

    let id: string = requestedId || hri.random();

    // If ID already in use, generate a new random one
    if (this.clients.has(id)) {
      id = hri.random();
    }

    // Validate subdomain format (4-63 lowercase alphanumeric characters with optional hyphens)
    if (!/^(?:[a-z0-9][a-z0-9\-]{2,61}[a-z0-9]|[a-z0-9]{4,63})$/.test(id)) {
      // If invalid, generate a random one
      id = hri.random();
    }

    const maxSockets = this.opt.maxTcpSockets || 10;

    // Reserve the port before creating the agent
    this.reservePort(port, id);

    const agent = new TunnelAgent({
      clientId: id,
      maxTcpSockets: maxSockets,
      port: port, // Use port from pool
    });

    const client = new Client({
      id,
      agent,
    });

    // Add to clients map immediately to avoid races with other clients requesting same ID
    this.clients.set(id, client);
    loggers.server.info({ tunnelId: id, port }, "New tunnel client created");

    client.once("close", () => {
      this.removeClient(id);
    });

    try {
      const info = await agent.listen();
      this.stats.tunnels++;

      loggers.server.info(
        { tunnelId: id, port: info.port, totalTunnels: this.stats.tunnels, availablePorts: this.portCount - this.usedPorts.size },
        "Tunnel listening"
      );

      return {
        id: id,
        port: info.port,
        maxConnCount: maxSockets,
      };
    } catch (err) {
      // Cleanup on failure - release the port
      this.releasePort(id);
      this.clients.delete(id);
      throw err;
    }
  }

  /**
   * Remove a client by ID
   */
  removeClient(id: string) {
    const client = this.clients.get(id);
    if (!client) {
      return;
    }

    loggers.server.info({ tunnelId: id }, "Removing tunnel client");
    this.stats.tunnels--;
    this.releasePort(id); // Release the port back to the pool
    this.clients.delete(id);
    client.close();
  }

  /**
   * Check if a client with the given ID exists
   */
  hasClient(id: string): boolean {
    return this.clients.has(id);
  }

  /**
   * Get a client by ID
   */
  getClient(id: string): Client | undefined {
    return this.clients.get(id);
  }

  /**
   * Get all active tunnel IDs
   */
  getClientIds(): string[] {
    return Array.from(this.clients.keys());
  }

  /**
   * Get the total number of active tunnels
   */
  getTunnelCount(): number {
    return this.clients.size;
  }

  /**
   * Get the number of available ports
   */
  getAvailablePortCount(): number {
    return this.portCount - this.usedPorts.size;
  }

  /**
   * Get port range info
   */
  getPortRange(): { start: number; end: number; count: number } {
    return {
      start: this.portStart,
      end: this.portStart + this.portCount - 1,
      count: this.portCount,
    };
  }
}

export default ClientManager;
