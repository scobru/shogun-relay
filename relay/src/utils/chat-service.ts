import Gun from "gun";
import "gun/sea.js";
import { loggers } from "./logger";
import { getRelayUser, getRelayKeyPair } from "./relay-user";
import { GUN_PATHS, getGunNode } from "./gun-paths";

const log = loggers.server;

export interface ChatMessage {
  id: string;
  from: string;
  to?: string;
  text: string;
  timestamp: number;
  read: boolean;
  incoming: boolean;
  encrypted?: boolean;
}

export interface ChatThread {
  pub: string;
  lastMessage: ChatMessage;
  unreadCount: number;
}

export interface LobbyMessage {
  id: string;
  from: string;
  alias: string;
  text: string;
  timestamp: number;
}

export class ChatService {
  private gun: any;
  private active: boolean = false;
  private myPub: string = '';
  private messageCache = new Map<string, Map<string, ChatMessage>>();
  private lobbyCache = new Map<string, LobbyMessage>();
  private subscribedChats = new Set<string>();

  public initialize(gunInstance: any) {
    this.gun = gunInstance;
    const checkForUser = setInterval(() => {
      const user = getRelayUser();
      const pair = getRelayKeyPair();
      if (user && user.is && pair) {
        clearInterval(checkForUser);
        this.myPub = pair.pub;
        this.active = true;
        log.info(`💬 Chat Service initialized for ${this.myPub.substring(0, 8)}...`);
        this.startLobbyListener();
        this.startLobbyCleanupJob();
      }
    }, 1000);
  }

  private getChatId(pubA: string, pubB: string): string {
    return [pubA, pubB].sort().join(':');
  }

  public async syncMessagesFrom(peerPub: string): Promise<void> {
      if (!this.active || !this.myPub) return;
      const chatId = this.getChatId(this.myPub, peerPub);
      if (this.subscribedChats.has(chatId)) return;
      this.subscribedChats.add(chatId);
      log.info(`💬 Subscribing to chat ${chatId} with ${peerPub.substring(0, 8)}...`);

      getGunNode(this.gun, GUN_PATHS.CHATS).get(chatId).map().on(async (data: any, msgId: string) => {
          if (!data || !data.content) return;
          try {
              let text = data.content;
              if (data.encrypted) {
                  const pair = getRelayKeyPair();
                  if (!pair || !pair.epriv) return;
                  const otherUserPub = data.from === this.myPub ? data.to : data.from;
                  const otherUserData = await this.getUserData(otherUserPub);

                  if (otherUserData && otherUserData.epub) {
                      const secret = await Gun.SEA.secret(otherUserData.epub, pair as any);
                      if (secret) {
                          const decrypted = await Gun.SEA.decrypt(data.content, secret);
                          if (decrypted) text = decrypted;
                      }
                  }
              }

              // ChatOps logic removed due to missing chat-commands.ts

              const msg: ChatMessage = {
                  id: msgId,
                  from: data.from,
                  to: data.to,
                  text: text,
                  timestamp: data.timestamp || Date.now(),
                  read: data.from === this.myPub, // Read if I sent it
                  incoming: data.from !== this.myPub
              };
              this.cacheMessage(peerPub, msg);
          } catch (e) {
              log.error({ err: e }, "💬 Failed to process message");
          }
      });
  }

  public async sendMessage(toPub: string, text: string): Promise<boolean> {
      if (!this.active) throw new Error("Chat service not active");
      const user = getRelayUser();
      const pair = getRelayKeyPair();
      if (!user || !pair) throw new Error("Relay user not authenticated");

      return new Promise((resolve, reject) => {
          this.gun.get('~' + toPub).once(async (peerData: any) => {
              if (!peerData || !peerData.epub) {
                  log.warn(`💬 Peer ${toPub.substring(0, 8)}... missing epub`);
                  reject(new Error("Peer missing encryption keys"));
                  return;
              }
              try {
                  const secret = await Gun.SEA.secret(peerData.epub, pair as any);
                  if (!secret) throw new Error("Failed to generate secret");
                  const encrypted = await Gun.SEA.encrypt(text, secret);
                  const chatId = this.getChatId(this.myPub, toPub);
                  const timestamp = Date.now();
                  const msgId = `${timestamp}-${Math.random().toString(36).substr(2, 9)}`;
                  const messageData = {
                      from: this.myPub,
                      to: toPub,
                      content: encrypted,
                      timestamp: timestamp,
                      encrypted: true
                  };
                  getGunNode(this.gun, GUN_PATHS.CHATS).get(chatId).get(msgId).put(messageData);
                  const sentMsg: ChatMessage = {
                      id: msgId,
                      from: this.myPub,
                      to: toPub,
                      text: text,
                      timestamp: timestamp,
                      read: true,
                      incoming: false
                  };
                  this.cacheMessage(toPub, sentMsg);
                  log.info(`💬 Sent message to ${toPub}`);
                  resolve(true);
              } catch (e) {
                  reject(e);
              }
          });
      });
  }

  private async getUserData(pub: string): Promise<any> {
      return new Promise((resolve) => {
         this.gun.get('~' + pub).once((data: any) => resolve(data));
      });
  }

  private cacheMessage(peerPub: string, msg: ChatMessage) {
      if (!this.messageCache.has(peerPub)) {
          this.messageCache.set(peerPub, new Map());
      }
      this.messageCache.get(peerPub)?.set(msg.id, msg);
  }

  private hasMessage(peerPub: string, msgId: string): boolean {
      return this.messageCache.get(peerPub)?.has(msgId) || false;
  }

  public async getHistory(peerPub: string): Promise<ChatMessage[]> {
      this.syncMessagesFrom(peerPub);
      const cache = this.messageCache.get(peerPub);
      if (!cache) return [];
      return Array.from(cache.values()).sort((a, b) => a.timestamp - b.timestamp);
  }

  public getConversations(): ChatThread[] {
      const threads: ChatThread[] = [];
      for (const [pub, messages] of this.messageCache.entries()) {
          const sorted = Array.from(messages.values()).sort((a, b) => b.timestamp - a.timestamp);
          if (sorted.length === 0) continue;
          const last = sorted[0];
          const unread = sorted.filter(m => m.incoming && !m.read).length;
          threads.push({
              pub,
              lastMessage: last,
              unreadCount: unread
          });
      }
      return threads;
  }

  private startLobbyListener() {
      getGunNode(this.gun, GUN_PATHS.LOBBY).map().on((data: any, msgId: string) => {
          if (!data || !data.text || !data.from) return;
          const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
          const timestamp = data.timestamp || 0;
          if (timestamp < oneDayAgo) return;
          if (!this.lobbyCache.has(msgId)) {
              this.lobbyCache.set(msgId, {
                  id: msgId,
                  from: data.from,
                  alias: data.alias || data.from.substring(0, 8) + '...',
                  text: data.text,
                  timestamp: timestamp
              });
          }
      });
      log.info("📢 Listening to public lobby");
  }

  public async sendLobbyMessage(text: string): Promise<boolean> {
      if (!this.active) throw new Error("Chat service not active");
      const msgId = Date.now().toString();
      const lobbyMsg = {
          from: this.myPub,
          alias: process.env.RELAY_NAME || this.myPub.substring(0, 8) + '...',
          text: text,
          timestamp: Date.now()
      };
      getGunNode(this.gun, GUN_PATHS.LOBBY).get(msgId).put(lobbyMsg);
      this.lobbyCache.set(msgId, {
          id: msgId,
          ...lobbyMsg
      });
      log.info(`📢 Sent lobby message`);
      return true;
  }

  public getLobbyMessages(limit: number = 50): LobbyMessage[] {
      return Array.from(this.lobbyCache.values())
          .sort((a, b) => a.timestamp - b.timestamp)
          .slice(-limit);
  }

  public async clearConversation(peerPub: string): Promise<boolean> {
      this.messageCache.delete(peerPub);
      return true;
  }

  public async deleteMessage(peerPub: string, messageId: string): Promise<boolean> {
      this.messageCache.get(peerPub)?.delete(messageId);
      return true;
  }

  public cleanupOldLobbyMessages(): number {
      const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
      let cleaned = 0;
      for (const [msgId, msg] of this.lobbyCache.entries()) {
          if (msg.timestamp < oneDayAgo) {
              this.lobbyCache.delete(msgId);
              cleaned++;
          }
      }
      return cleaned;
  }

  public startLobbyCleanupJob() {
      this.cleanupOldLobbyMessages();
      setInterval(() => {
          this.cleanupOldLobbyMessages();
      }, 60 * 60 * 1000);
      log.info("📢 Lobby cleanup job started (every 1h)");
  }
}

export const chatService = new ChatService();
