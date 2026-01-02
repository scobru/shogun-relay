import { loggers } from "../logger";
import Client from "./Client";
import TunnelAgent from "./TunnelAgent";
import { hri } from "human-readable-ids";

interface ClientManagerOptions {
  maxTcpSockets?: number;
  port?: number; // Fixed port for tunnel TCP connections (0 = random)
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
 */
class ClientManager {
  private clients: Map<string, Client> = new Map();
  private opt: ClientManagerOptions;
  public stats = {
    tunnels: 0,
  };

  constructor(opt?: ClientManagerOptions) {
    this.opt = opt || {};
  }

  /**
   * Create a new tunnel with the given ID
   * If the ID is already used, a random ID is assigned
   * @param requestedId - The requested tunnel ID
   * @returns Promise with tunnel info
   */
  async newClient(requestedId?: string): Promise<NewClientResult> {
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

    const agent = new TunnelAgent({
      clientId: id,
      maxTcpSockets: maxSockets,
      port: this.opt.port, // Use configured port
    });

    const client = new Client({
      id,
      agent,
    });

    // Add to clients map immediately to avoid races with other clients requesting same ID
    this.clients.set(id, client);
    loggers.server.info({ tunnelId: id }, "New tunnel client created");

    client.once("close", () => {
      this.removeClient(id);
    });

    try {
      const info = await agent.listen();
      this.stats.tunnels++;

      loggers.server.info(
        { tunnelId: id, port: info.port, totalTunnels: this.stats.tunnels },
        "Tunnel listening"
      );

      return {
        id: id,
        port: info.port,
        maxConnCount: maxSockets,
      };
    } catch (err) {
      // Cleanup on failure
      this.removeClient(id);
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
}

export default ClientManager;
