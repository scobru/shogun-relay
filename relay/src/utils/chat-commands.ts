import { torrentManager } from "./torrent";
import { loggers } from "./logger";
import { getRelayUser, getRelayKeyPair } from "./relay-user";
import packageJson from "../../package.json";

export interface ChatCommand {
  name: string;
  description: string;
  usage: string;
  execute: (args: string[], fromPub: string) => Promise<string>;
}

export class ChatCommandHandler {
  private commands: Map<string, ChatCommand> = new Map();

  constructor() {
    this.registerCommands();
  }

  private registerCommands() {
    // /help
    this.register({
      name: "help",
      description: "List available commands",
      usage: "/help",
      execute: async () => {
        let response = "🤖 **Shogun Relay ChatOps**\n\nAvailable commands:\n";
        for (const cmd of this.commands.values()) {
          response += `- \`/${cmd.name}\`: ${cmd.description}\n`;
        }
        return response;
      },
    });

    // /status
    this.register({
      name: "status",
      description: "Get relay status",
      usage: "/status",
      execute: async () => {
        const status = torrentManager.getStatus();
        const storage = torrentManager.getStorageStats();
        const uptime = process.uptime();
        
        const uptimeString = new Date(uptime * 1000).toISOString().substr(11, 8);

        return `📊 **Relay Status**\n` +
               `Version: v${packageJson.version}\n` +
               `Uptime: ${uptimeString}\n` +
               `Active Torrents: ${status.activeTorrents}\n` +
               `Storage Used: ${storage.totalGB.toFixed(2)} GB (${storage.fileCount} files)\n` +
               `Download Speed: ${(status.downloadSpeed / 1024 / 1024).toFixed(2)} MB/s\n` +
               `Upload Speed: ${(status.uploadSpeed / 1024 / 1024).toFixed(2)} MB/s`;
      },
    });

    // /search <query>
    this.register({
      name: "search",
      description: "Search global torrent registry",
      usage: "/search <query>",
      execute: async (args) => {
        if (args.length === 0) {
          return "❌ Usage: /search <query>";
        }

        const query = args.join(" ");
        const results = await torrentManager.searchGlobalRegistry(query, 5); // Limit to 5 for chat

        if (results.length === 0) {
          return `🔍 No results found for "${query}"`;
        }

        let response = `🔍 **Search Results for "${query}"**\n`;
        results.forEach((r, i) => {
          const size = (r.size / 1024 / 1024).toFixed(2);
          response += `\n${i + 1}. **${r.name}** (${size} MB)\n   Magnet: \`${r.magnetURI}\`\n`;
        });

        return response;
      },
    });
    
    // /add <magnet>
    this.register({
        name: "add",
        description: "Add a torrent by magnet link",
        usage: "/add <magnet>",
        execute: async (args) => {
            if (args.length === 0) return "❌ Usage: /add <magnet_link>";
            const magnet = args[0];
            try {
                // Ensure the magnet link is valid (basic check)
                if (!magnet.startsWith("magnet:?")) {
                     return "❌ Invalid magnet link";
                }
                
                const torrent = torrentManager.addTorrent(magnet);
                
                // If it returns a torrent object (which we just updated it to do)
                if (torrent) {
                    return `✅ **Torrent Added**\nName: ${torrent.name}\nHash: ${torrent.infoHash}`;
                } else {
                     return "⚠️ Torrent added but no detail returned (check logs)";
                }
            } catch (err: any) {
                return `❌ Failed to add torrent: ${err.message}`;
            }
        }
    });

    // /list [limit]
    this.register({
      name: "list",
      description: "List all torrents in the global registry",
      usage: "/list [limit]",
      execute: async (args) => {
        const limit = parseInt(args[0]) || 10;
        const results = await torrentManager.browseGlobalRegistry(limit);
        
        if (results.length === 0) {
          return "📂 No torrents found in the global registry";
        }
        
        let response = `📂 **Global Torrent Registry** (${results.length} results)\n`;
        results.forEach((r, i) => {
          const size = ((r.size || 0) / 1024 / 1024).toFixed(2);
          response += `\n${i + 1}. **${r.name}** (${size} MB)`;
        });
        
        return response;
      }
    });
  }

  private register(command: ChatCommand) {
    this.commands.set(command.name, command);
  }

  public async handleCommand(
    message: string, 
    fromPub: string, 
    sendMessage: (to: string, text: string) => Promise<boolean>
  ): Promise<string | null> {
    if (!message.startsWith("/")) return null;

    const parts = message.slice(1).trim().split(/\s+/);
    const commandName = parts[0].toLowerCase();
    const args = parts.slice(1);

    // SYSTEM COMMANDS (Handle regardless of auth for now, or check peer perms)
    // In a real system, we'd check if 'fromPub' is a trusted peer or friend
    
    if (commandName === 'sys-req-catalog') {
        // Peer requested our catalog
        // Fetch top 20 latest torrents
        const catalog = torrentManager.getCatalog();
        // Sort by completedAt desc
        const latest = catalog
            .sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0))
            .slice(0, 20)
            .map(t => ({
                name: t.torrentName,
                hash: t.torrentHash, 
                size: t.files?.reduce((acc, f) => acc + f.size, 0) || 0
            }));
        
        const payload = JSON.stringify(latest);
        // Reply with response command
        // Note: Gun max message size might be an issue for very large lists
        return `/sys-resp-catalog ${payload}`;
    }

    if (commandName === 'sys-resp-catalog') {
        // We received a catalog from someone
        try {
            const jsonStr = args.join(" ");
            const items = JSON.parse(jsonStr);
            
            let response = `📂 **User Catalog (${fromPub.substring(0, 8)}...)**\n`;
            if (Array.isArray(items) && items.length > 0) {
                items.forEach((item: any, i: number) => {
                    const sizeMB = (item.size / 1024 / 1024).toFixed(2);
                    response += `\n${i+1}. **${item.name}** (${sizeMB} MB)\n   Magnet: magnet:?xt=urn:btih:${item.hash}\n`;
                });
            } else {
                response += "No files shared.";
            }
            
            // We return the formatted list. 
            // In the ChatService, this string is normally sent BACK to the sender. 
            // BUT for 'sys-resp-catalog', the sender is the REMOTE peer. 
            // We want to display this locally to us.
            // Returning it here means 'ChatMessage' will be logged locally as if they sent us this text.
            // Which is exactly what we want! The user sees the file list as a message from the peer.
            return null; // Special handling needed? 
            // Wait, if we return string, ChatService sends it back to Peer. 
            // We DON'T want to send the file list back to them.
            // The logic in ChatService needs to change to handle "Local Only" responses 
            // OR we handle the display here by logging and return null.
            
            loggers.server.info(`\n${response}`); // Log it so it appears in server output
            
            // To make it appear in 'chat history', we'd need to insert it into messageCache manaually 
            // or return a special signal. For now, returning null and logging is safest MVP.
            return null; 
        } catch (e) {
            return null;
        }
    }

    // AUTH CHECK FOR ADMIN COMMANDS
    const relayKeyPair = getRelayKeyPair();
    // If we can't identify ourselves, ignore
    if (!relayKeyPair || !relayKeyPair.pub) return null;

    // Allow self-commands (loopback) OR if we implement an admin list later
    if (fromPub !== relayKeyPair.pub) {
         loggers.server.warn({ fromPub }, "⛔ Ignored unauthorized chat command");
         return null; 
    }

    // /browse <pubkey>
    if (commandName === 'browse') {
        if (args.length === 0) return "❌ Usage: /browse <pubkey>";
        const targetPub = args[0];
        
        // Send request
        await sendMessage(targetPub, "/sys-req-catalog");
        return `⏳ Requesting catalog from ${targetPub.substring(0, 8)}...`;
    }

    const command = this.commands.get(commandName);
    if (!command) {
      return "❓ Unknown command. Type `/help` for list.";
    }

    try {
      loggers.server.info({ command: commandName, from: fromPub }, "🤖 Executing ChatOps command");
      return await command.execute(args, fromPub);
    } catch (error: any) {
      loggers.server.error({ err: error }, "Command execution failed");
      return `❌ Error executing command: ${error.message}`;
    }
  }
}

export const chatCommands = new ChatCommandHandler();
