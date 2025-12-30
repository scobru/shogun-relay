
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
      }
    }, 1000);
  }

  private startSignalListener() {
    if (!this.active || !this.myPub) return;

    // Listen for signals aimed at me
    // Path: shogun/chat-signals/<MyPub>
    this.gun.get('shogun').get('chat-signals').get(this.myPub).map().on((data: any, key: string) => {
        if (!data || !data.from) return;
        
        const timestamp = data.timestamp || 0;
        // Ignore very old signals (older than 7 days)
        if (Date.now() - timestamp > 7 * 24 * 3600 * 1000) return;

        // Sync messages from this sender
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
          
          // Check if we already have this message
          if (!this.messageCache.has(peerPub)) {
              this.messageCache.set(peerPub, new Map());
          }
          if (this.messageCache.get(peerPub)?.has(id)) return;

          try {
              // Get their epub to decrypt
              // We need to fetch their user node to get 'epub'
              this.gun.get('~' + peerPub).once(async (peerData: any) => {
                  if (peerData && peerData.epub && pair && pair.epriv) {
                      const secret = await Gun.SEA.secret(peerData.epub, pair as any); 
                      // secret returns Promise<string | undefined>
                      if (secret) {
                          const decrypted = await Gun.SEA.decrypt(encrypted, secret);
                          
                          if (decrypted) {
                              // Check for ChatOps commands
                              const { chatCommands } = await import("./chat-commands");
                              const commandResponse = await chatCommands.handleCommand(decrypted, peerPub, this.sendMessage.bind(this));

                              if (commandResponse) {
                                  log.info(`🤖 ChatOps executed for ${peerPub}`);
                                  // Send response back
                                  await this.sendMessage(peerPub, commandResponse);
                                  
                                  // Don't show the command itself in the UI history (optional, but cleaner)
                                  // But for now, let's keep it so user sees their own command history if looking at logs
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
                              log.info(`💬 Received message from ${peerPub.substring(0,6)}...`);
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

      // 1. Get recipient epub
      return new Promise((resolve, reject) => {
          this.gun.get('~' + toPub).once(async (peerData: any) => {
              if (!peerData || !peerData.epub) {
                  log.warn(`💬 Could not find epub for ${toPub}`);
                  reject(new Error("Peer not found or invalid keys"));
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
}

export const chatService = new ChatService();
