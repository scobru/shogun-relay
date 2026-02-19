// torrentManager import removed
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
        // Torrent status removed
        const uptime = process.uptime();
        const uptimeString = new Date(uptime * 1000).toISOString().substr(11, 8);

        return `📊 **Relay Status**\n` +
          `Version: v${packageJson.version}\n` +
          `Uptime: ${uptimeString}\n`;
      },
    });

    // Torrent commands (search, add, reindex, list) removed
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

    // System catalog commands removed

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
    // Browse command removed

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
