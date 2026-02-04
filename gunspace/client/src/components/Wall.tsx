import React, { useState, useEffect } from 'react';
import { gun, user } from '../gun';

interface Message {
  id: string;
  from: string;
  fromAlias: string;
  text: string;
  timestamp: number;
}

interface WallProps {
  ownerPub: string;
  ownerAlias: string;
}

export const Wall: React.FC<WallProps> = ({ ownerPub, ownerAlias }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');

  useEffect(() => {
    const wallRef = gun.get('wall-' + ownerPub);
    
    setMessages([]); // Reset messages on owner change

    wallRef.map().on((data: any, id: string) => {
      if (data && data.text) {
        setMessages(prev => {
          // Check if message already exists
          if (prev.find(m => m.id === id)) return prev;
          
          const newMsg = {
            id,
            from: data.from,
            fromAlias: data.fromAlias,
            text: data.text,
            timestamp: data.timestamp
          };
          
          const updated = [...prev, newMsg];
          // Sort by timestamp descending
          return updated.sort((a, b) => b.timestamp - a.timestamp);
        });
      }
    });
  }, [ownerPub]);

  const handlePost = () => {
    if (!input.trim()) return;
    if (!user.is) {
      alert('Devi essere loggato per scrivere sulla bacheca!');
      return;
    }

    const wallRef = gun.get('wall-' + ownerPub);
    const msgId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
    
    wallRef.get(msgId).put({
      from: user.is.pub,
      fromAlias: (user as any)._.alias || 'Unknown',
      text: input,
      timestamp: Date.now()
    });

    setInput('');
  };

  return (
    <div className="ms-box">
      <div className="ms-box-header">{ownerAlias}'s Wall</div>
      <div className="ms-box-content">
        {user.is && (
          <div style={{ marginBottom: '15px', borderBottom: '1px solid #ccc', paddingBottom: '10px' }}>
            <textarea 
              value={input} 
              onChange={(e) => setInput(e.target.value)} 
              placeholder="Scrivi un messaggio sulla bacheca..."
              style={{ height: '50px' }}
            />
            <button onClick={handlePost} style={{ marginTop: '5px' }}>Post Message</button>
          </div>
        )}

        {messages.length === 0 ? (
          <p style={{ fontStyle: 'italic', fontSize: '11px' }}>No messages yet. Be the first to post!</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {messages.map((m) => (
              <div key={m.id} style={{ fontSize: '12px', borderBottom: '1px dotted #ccc', paddingBottom: '5px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <strong>{m.fromAlias}:</strong>
                  <span style={{ fontSize: '10px', color: '#666' }}>
                    {new Date(m.timestamp).toLocaleString()}
                  </span>
                </div>
                <p style={{ margin: '5px 0' }}>{m.text}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
