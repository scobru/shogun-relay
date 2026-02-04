import React, { useState, useEffect } from 'react';
import { gun, user, sea } from '../gun';

interface MailboxProps {
    currentUserPub: string;
}

export const MailboxView: React.FC<MailboxProps> = ({ currentUserPub }) => {
    const [messages, setMessages] = useState<any[]>([]);


    const [myPair, setMyPair] = useState<any>(null);

    // 1. Listen for Auth/Pair availability
    useEffect(() => {
        // Initial check
        if (user._.sea) {
            setMyPair(user._.sea);
        }

        // Listen for auth events (login/recall completion)
        const onAuth = () => {
             if (user._.sea) {
                 console.log("Auth detected, pair available.");
                 setMyPair(user._.sea);
             }
        };
        gun.on('auth', onAuth);
        
        // Also simple polling just in case (hacky but reliable for race conditions)
        const interval = setInterval(() => {
            if (!myPair && user._.sea) {
                setMyPair(user._.sea);
            }
        }, 1000);

        return () => {
            // gun.off('auth', onAuth); // Gun types might verify off
            clearInterval(interval);
        }
    }, [myPair]);

    // 2. Incoming Messages
    useEffect(() => {
        const inbox = gun.get('inbox-' + currentUserPub);
        
        inbox.map().on((data: any) => {
            if (data && data.text) {
                setMessages(prev => {
                    const key = `${data.timestamp}-${data.from}`;
                    if (prev.find(m => `${m.timestamp}-${m.from}` === key)) return prev;
                    // Add raw message first
                    return [...prev, { ...data, decrypted: false }].sort((a, b) => b.timestamp - a.timestamp);
                });
            }
        });
    }, [currentUserPub]);

    // 3. Decrypt Effect
    useEffect(() => {
        if (!myPair || messages.length === 0) return;

        console.log("Attempting decryption for", messages.length, "messages");

        const attemptDecryption = async () => {
            let updated = false;
            const newMessages = await Promise.all(messages.map(async (msg) => {
                if (msg.decrypted) return msg; // Already decrypted
                
                // Check string content
                if (typeof msg.text !== 'string' || !msg.text.startsWith('SEA{')) {
                    // Not encrypted or invalid format, mark as processed/decrypted so we don't check again
                    return { ...msg, decrypted: true };
                }

                if (msg.from) {
                    try {
                       // We need sender's EPUB.
                       let senderEpub = msg.fromEpub;
                       
                       // If not in msg, try to help by fetching it (backward compatibility or retry)
                       if (!senderEpub) {
                           await new Promise<void>((resolve) => {
                               gun.user(msg.from).once((u: any) => {
                                   if (u && u.epub) senderEpub = u.epub;
                                   resolve();
                               });
                           });
                       }

                       if (!senderEpub) {
                           // Fallback
                           senderEpub = msg.from;
                       }
                       
                       console.log("Decrypting with senderEpub:", senderEpub);

                       // Ensure we have correct types for TS
                       const secret = await sea.secret(senderEpub, myPair as any);
                       if (!secret) throw new Error("Could not derive secret");
                       
                       const decrypted = await sea.decrypt(msg.text, secret);
                       if (decrypted) {
                           updated = true;
                           console.log("Decrypted msg from", msg.from);
                           return { ...msg, text: decrypted, decrypted: true };
                       } else {
                           console.warn("Decryption returned null", msg.text);
                       }
                    } catch (e) {
                        console.error("Decryption error for msg", msg, e);
                    }
                } else {
                    console.warn("Message missing 'from' field, cannot decrypt", msg);
                }
                return msg;
            }));

            if (updated) {
                setMessages(newMessages);
            }
        };

        attemptDecryption();

    }, [messages, myPair]);

    return (
        <div className="ms-box">
            <div className="ms-box-header">My Mailbox</div>
            <div className="ms-box-content">
                {messages.length === 0 ? (
                    <p>No messages.</p>
                ) : (
                    <table style={{ width: '100%', fontSize: '12px', borderCollapse: 'collapse' }}>
                        <thead>
                            <tr style={{ backgroundColor: '#ccc', textAlign: 'left' }}>
                                <th style={{ padding: '5px' }}>From</th>
                                <th style={{ padding: '5px' }}>Date</th>
                                <th style={{ padding: '5px' }}>Message</th>
                            </tr>
                        </thead>
                        <tbody>
                            {messages.map((msg, i) => (
                                <tr key={i} style={{ borderBottom: '1px solid #eee' }}>
                                    <td style={{ padding: '5px' }}>{msg.fromAlias || 'Unknown'}</td>
                                    <td style={{ padding: '5px' }}>{new Date(msg.timestamp).toLocaleString()}</td>
                                    <td style={{ padding: '5px' }}>{msg.text}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
};
