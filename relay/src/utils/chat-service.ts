
import Gun from 'gun';
import 'gun/sea';
import { loggers } from './logger';
import { getRelayUser, getRelayKeyPair } from './relay-user';

const log = loggers.server; // Use server logger for now, or add chat logger

export interface ChatMessage {
  id: string;
  from: string;
  to: string;
  text: string;
  timestamp: number;
  read: boolean;
  incoming: boolean;
}

export interface ChatThread {
  pub: string; // The other party's pub key
  alias?: string;
  lastMessage?: ChatMessage;
  unreadCount: number;
}

class ChatService {
  private gun: any;
  private active: boolean = false;
  private myPub: string = '';
  private signalsUnsub: Function | null = null;
  
  // Cache for decrypted messages
  // peerPub -> messageId -> message
  private messageCache = new Map<string, Map<string, ChatMessage>>();
  
  // Synchronous lock to prevent parallel GunDB callback spam
  // Format: "peerPub:messageId"
  private processingMessages = new Set<string>();

  initialize(gunInstance: any) {
    this.gun = gunInstance;
    
    // Wait for relay user to be ready
    const checkForUser = setInterval(() => {
      const user = getRelayUser();
      const pair = getRelayKeyPair();
      
      if (user && user.is && pair) {
        clearInterval(checkForUser);
        this.myPub = pair.pub;
        this.active = true;
        log.info(`💬 Chat Service initialized for ${this.myPub.substring(0, 8)}...`);
        this.startSignalListener();
        this.startLobbyListener();
        this.startLobbyCleanupJob();
      }
    }, 1000);
  }

  // Track last sync time per peer to avoid spam
  private lastSyncTime = new Map<string, number>();
  // Track processed signal IDs to avoid reprocessing
  private processedSignals = new Set<string>();
  
  private startSignalListener() {
    if (!this.active || !this.myPub) return;

    // Listen for signals aimed at me - use .once() to avoid repeated firing
    // Path: shogun/chat-signals/<MyPub>
    this.gun.get('shogun').get('chat-signals').get(this.myPub).map().once((data: any, key: string) => {
        if (!data || !data.from) return;
        
        // Skip if we already processed this signal key
        if (this.processedSignals.has(key)) return;
        this.processedSignals.add(key);
        
        // Limit processedSignals size to prevent memory leak
        if (this.processedSignals.size > 1000) {
            const toDelete = Array.from(this.processedSignals).slice(0, 500);
            toDelete.forEach(k => this.processedSignals.delete(k));
        }
        
        const timestamp = data.timestamp || 0;
        // Ignore very old signals (older than 1 day now, more aggressive)
        if (Date.now() - timestamp > 24 * 3600 * 1000) return;

        // Throttle: only sync from same peer every 30 seconds (very aggressive)
        const lastSync = this.lastSyncTime.get(data.from) || 0;
        if (Date.now() - lastSync < 30000) return;
        this.lastSyncTime.set(data.from, Date.now());

        // Sync messages from this sender
        log.info(`💬 Signal from ${data.from.substring(0,6)}... - syncing messages`);
        this.syncMessagesFrom(data.from);
    });

    log.info("💬 Listening for chat signals");
  }

  /**
   * Sync messages from a specific peer
   */
  public async syncMessagesFrom(peerPub: string): Promise<void> {
      if (!this.active) return;

      const user = getRelayUser();
      const pair = getRelayKeyPair();
      if (!user || !pair) return;

      // Their outbox for me: ~TheirPub/chat/MyPub
      this.gun.get('~' + peerPub).get('chat').get(this.myPub).map().once(async (encrypted: string, id: string) => {
          if (!encrypted) return;
          
          // SYNCHRONOUS LOCK - prevents parallel GunDB callbacks from processing same message
          const lockKey = `${peerPub}:${id}`;
          if (this.processingMessages.has(lockKey)) return;
          this.processingMessages.add(lockKey);
          
          // Also check cache (for messages already fully processed)
          if (!this.messageCache.has(peerPub)) {
              this.messageCache.set(peerPub, new Map());
          }
          if (this.messageCache.get(peerPub)?.has(id)) {
              this.processingMessages.delete(lockKey);
              return;
          }

          try {
              // Get their epub to decrypt
              // We need to fetch their user node to get 'epub'
              this.gun.get('~' + peerPub).once(async (peerData: any) => {
                  // SECOND dedup check (in case parallel callbacks)
                  if (this.messageCache.get(peerPub)?.has(id)) return;
                  
                  if (peerData && peerData.epub && pair && pair.epriv) {
                      const secret = await Gun.SEA.secret(peerData.epub, pair as any); 
                      // secret returns Promise<string | undefined>
                      if (secret) {
                          const decrypted = await Gun.SEA.decrypt(encrypted, secret);
                          
                          if (decrypted) {
                              // THIRD dedup check before processing
                              if (this.messageCache.get(peerPub)?.has(id)) return;

                              // Check for ChatOps commands
                              const { chatCommands } = await import("./chat-commands");
                              const commandResponse = await chatCommands.handleCommand(decrypted, peerPub, this.sendMessage.bind(this));

                              if (commandResponse) {
                                  log.info(`🤖 ChatOps executed for ${peerPub.substring(0,6)}...`);
                                  // Send response back - wrapped in try-catch to avoid unhandled rejection
                                  try {
                                      await this.sendMessage(peerPub, commandResponse);
                                  } catch (e: any) {
                                      log.warn({ err: e.message }, `💬 Failed to send command response to ${peerPub.substring(0,6)}...`);
                                  }
                              }

                              const msg: ChatMessage = {
                                  id,
                                  from: peerPub,
                                  to: this.myPub,
                                  text: decrypted, // Assuming simple text for now
                                  timestamp: parseFloat(id) || Date.now(), // timestamp used as key often
                                  read: false,
                                  incoming: true
                              };
                              
                              this.messageCache.get(peerPub)?.set(id, msg);
                              log.debug(`💬 Received message from ${peerPub.substring(0,6)}...`);
                          }
                      }
                  }
              });
          } catch (e) {
              log.error({ err: e }, "💬 Failed to decrypt message");
          }
      });
  }

  /**
   * Send a message to a peer
   */
  public async sendMessage(toPub: string, text: string): Promise<boolean> {
      if (!this.active) throw new Error("Chat service not active");
      
      const user = getRelayUser();
      const pair = getRelayKeyPair();
      if (!user || !pair) throw new Error("Relay user not authenticated");

      // 1. Get recipient epub with timeout
      return new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
              reject(new Error(`Peer lookup timed out for ${toPub.substring(0, 8)}... - peer may be offline or not registered`));
          }, 5000);

          this.gun.get('~' + toPub).once(async (peerData: any) => {
              clearTimeout(timeout);

              if (!peerData) {
                  log.warn(`💬 Peer not found in GunDB: ${toPub.substring(0, 8)}...`);
                  reject(new Error(`Peer not found: ${toPub.substring(0, 8)}... - they may not be a registered relay`));
                  return;
              }

              if (!peerData.epub) {
                  log.warn(`💬 Peer found but missing epub key: ${toPub.substring(0, 8)}...`);
                  reject(new Error(`Peer ${toPub.substring(0, 8)}... has no encryption key - they may not have fully initialized`));
                  return;
              }

              if (!pair.epriv) {
                  reject(new Error("Missing local encryption keys"));
                  return;
              }

              try {
                  // 2. Encrypt
                  const secret = await Gun.SEA.secret(peerData.epub, pair as any);
                  if (!secret) {
                      throw new Error("Failed to generate secret");
                  }

                  const encrypted = await Gun.SEA.encrypt(text, secret);
                  
                  // 3. Write to My Outbox: ~MyPub/chat/ToPub
                  const timestamp = Date.now();
                  const msgId = timestamp.toString(); // Use timestamp as ID for ordering/simplicity
                  
                  user.get('chat').get(toPub).get(msgId).put(encrypted);

                  // 4. Send Signal: shogun/chat-signals/ToPub
                  this.gun.get('shogun').get('chat-signals').get(toPub).get(msgId).put({
                      from: this.myPub,
                      timestamp: timestamp
                  });

                  // Cache my own message
                  if (!this.messageCache.has(toPub)) {
                      this.messageCache.set(toPub, new Map());
                  }
                  const sentMsg: ChatMessage = {
                      id: msgId,
                      from: this.myPub,
                      to: toPub,
                      text,
                      timestamp,
                      read: true,
                      incoming: false
                  };
                  this.messageCache.get(toPub)?.set(msgId, sentMsg);

                  log.info(`💬 Sent message to ${toPub}`);
                  resolve(true);

              } catch (e) {
                  reject(e);
              }
          });
      });
  }

  /**
   * Get conversation history with a peer
   */
  public async getHistory(peerPub: string): Promise<ChatMessage[]> {
      // Trigger sync
      this.syncMessagesFrom(peerPub);
      
      const cache = this.messageCache.get(peerPub);
      if (!cache) return [];
      
      return Array.from(cache.values()).sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * List all conversations (based on cache + discovery)
   * This is a "best effort" list based on who we messaged or messaged us.
   */
  public getConversations(): ChatThread[] {
      const threads: ChatThread[] = [];
      
      for (const [pub, messages] of this.messageCache.entries()) {
          const sorted = Array.from(messages.values()).sort((a, b) => b.timestamp - a.timestamp);
          const last = sorted[0];
          const unread = sorted.filter(m => m.incoming && !m.read).length; // "read" status logic needed in DB?
          
          threads.push({
              pub,
              lastMessage: last,
              unreadCount: unread
          });
      }
      
      return threads;
  }

  // ============================================================================
  // PUBLIC LOBBY (Non-encrypted global chat room)
  // ============================================================================

  private lobbyCache = new Map<string, LobbyMessage>();

  /**
   * Start listening to the public lobby
   */
  private startLobbyListener() {
      // Path: shogun/lobby/<msgId>
      this.gun.get('shogun').get('lobby').map().on((data: any, msgId: string) => {
          if (!data || !data.text || !data.from) return;
          
          // Ignore old messages (older than 24 hours)
          const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
          if (data.timestamp && data.timestamp < oneDayAgo) return;

          // Cache the message
          if (!this.lobbyCache.has(msgId)) {
              this.lobbyCache.set(msgId, {
                  id: msgId,
                  from: data.from,
                  alias: data.alias || data.from.substring(0, 8) + '...',
                  text: data.text,
                  timestamp: data.timestamp || parseInt(msgId) || Date.now()
              });
          }
      });

      log.info("📢 Listening to public lobby");
  }

  /**
   * Send a message to the public lobby
   */
  public async sendLobbyMessage(text: string): Promise<boolean> {
      if (!this.active) throw new Error("Chat service not active");
      
      const pair = getRelayKeyPair();
      if (!pair) throw new Error("Relay not authenticated");

      const msgId = Date.now().toString();
      const lobbyMsg = {
          from: this.myPub,
          alias: process.env.RELAY_NAME || this.myPub.substring(0, 8) + '...',
          text: text,
          timestamp: Date.now()
      };

      // Write to public lobby (no encryption!)
      this.gun.get('shogun').get('lobby').get(msgId).put(lobbyMsg);

      // Cache our own message
      this.lobbyCache.set(msgId, {
          id: msgId,
          ...lobbyMsg
      });

      log.info(`📢 Sent lobby message`);
      return true;
  }

  /**
   * Get recent lobby messages
   */
  public getLobbyMessages(limit: number = 50): LobbyMessage[] {
      const messages = Array.from(this.lobbyCache.values())
          .sort((a, b) => a.timestamp - b.timestamp)
          .slice(-limit);
      
      return messages;
  }

  // ============================================================================
  // MESSAGE DELETION / CLEANUP
  // ============================================================================

  /**
   * Clear a private conversation (local cache + GunDB)
   */
  public async clearConversation(peerPub: string): Promise<boolean> {
      if (!this.active) throw new Error("Chat service not active");
      
      const user = getRelayUser();
      if (!user) throw new Error("Relay not authenticated");

      // Clear local cache
      this.messageCache.delete(peerPub);

      // Clear from GunDB (our outbox to them)
      user.get('chat').get(peerPub).put(null);
      
      // Clear signals we sent to them
      this.gun.get('shogun').get('chat-signals').get(peerPub).put(null);

      log.info(`💬 Cleared conversation with ${peerPub.substring(0, 8)}...`);
      return true;
  }

  /**
   * Delete a single message from conversation
   */
  public async deleteMessage(peerPub: string, messageId: string): Promise<boolean> {
      if (!this.active) throw new Error("Chat service not active");
      
      const user = getRelayUser();
      if (!user) throw new Error("Relay not authenticated");

      // Remove from cache
      this.messageCache.get(peerPub)?.delete(messageId);

      // Remove from GunDB (only our own outbox - we can't delete their messages)
      user.get('chat').get(peerPub).get(messageId).put(null);

      log.info(`💬 Deleted message ${messageId} from conversation`);
      return true;
  }

  /**
   * Cleanup old lobby messages (older than 24h)
   * Call this periodically
   */
  public cleanupOldLobbyMessages(): number {
      const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
      let cleaned = 0;

      for (const [msgId, msg] of this.lobbyCache.entries()) {
          if (msg.timestamp < oneDayAgo) {
              this.lobbyCache.delete(msgId);
              // Also mark as null in GunDB (can only delete our own, but we try)
              this.gun.get('shogun').get('lobby').get(msgId).put(null);
              cleaned++;
          }
      }

      if (cleaned > 0) {
          log.info(`📢 Cleaned up ${cleaned} old lobby messages`);
      }
      return cleaned;
  }

  /**
   * Start periodic lobby cleanup (every hour)
   */
  public startLobbyCleanupJob() {
      // Run immediately
      this.cleanupOldLobbyMessages();
      
      // Then every hour
      setInterval(() => {
          this.cleanupOldLobbyMessages();
      }, 60 * 60 * 1000);
      
      log.info("📢 Lobby cleanup job started (every 1h)");
  }
}

export interface LobbyMessage {
  id: string;
  from: string;
  alias: string;
  text: string;
  timestamp: number;
}

export const chatService = new ChatService();
