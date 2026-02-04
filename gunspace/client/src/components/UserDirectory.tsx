import React, { useState, useEffect } from 'react';
import { gun, user } from '../gun';

interface GlobalUser {
  pub: string;
  alias: string;
  displayName: string;
  avatar?: string;
}

interface UserDirectoryProps {
  onSelectUser: (pub: string) => void;
  searchTerm?: string;
}

export const UserDirectory: React.FC<UserDirectoryProps> = ({ onSelectUser, searchTerm }) => {
  const [users, setUsers] = useState<Record<string, GlobalUser>>({});
  const [loading, setLoading] = useState(true);
  const [myFriends, setMyFriends] = useState<Record<string, boolean>>({});

  useEffect(() => {
    // ... existing effect ...
    const usersRef = gun.get('globalUsers');
    usersRef.map().on((data: any, key: string) => {
      // ...
      if (data && data.pub) {
          setUsers(prev => ({ ...prev, [key]: data }));
      }
      setLoading(false);
    });
    // ... existing friend tracking ...
    if (user.is) {
         user.get('friends').map().on((data: any, pub: string) => {
             if (data) setMyFriends(prev => ({ ...prev, [pub]: true }));
         });
    }

    const timer = setTimeout(() => setLoading(false), 2000);
    return () => clearTimeout(timer);
  }, []);

  const handleAddFriend = (friendPub: string) => {
     // ... existing ... 
     if (!user.is) return;
     user.get('friends').get(friendPub).put({ pub: friendPub, timestamp: Date.now() });
     setMyFriends(prev => ({ ...prev, [friendPub]: true }));
     alert('Aggiunto agli amici!');
  };

  const userList = Object.values(users).filter(u => {
      if (!searchTerm) return true;
      const term = searchTerm.toLowerCase();
      return (u.alias && u.alias.toLowerCase().includes(term)) || 
             (u.displayName && u.displayName.toLowerCase().includes(term));
  });

  return (
    <div className="ms-box">
      <div className="ms-box-header">
          Global Directory {searchTerm ? `(Searching: "${searchTerm}")` : '(Find Friends)'}
      </div>
      <div className="ms-box-content">
        {loading && <p>Searching common space...</p>}
        {!loading && userList.length === 0 && <p>No users found matching "{searchTerm}".</p>}
        
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '10px' }}>
          {userList.map((u) => (
            <div key={u.pub} className="ms-friend-item" style={{ border: '1px solid #ccc', padding: '5px' }}>
              <img 
                src={u.avatar || `https://via.placeholder.com/60?text=${u.alias ? u.alias.charAt(0) : '?'}`} 
                alt={u.alias} 
                style={{ cursor: 'pointer', maxWidth: '60px', maxHeight: '60px', objectFit: 'cover' }}
                onClick={() => onSelectUser(u.pub)}
                onError={(e) => { (e.target as HTMLImageElement).src = `https://via.placeholder.com/60?text=${u.alias ? u.alias.charAt(0) : '?'}`; }}
              />
              <p className="ms-friend-name" style={{ fontWeight: 'bold' }}>{u.displayName || u.alias}</p>
              <button 
                onClick={() => handleAddFriend(u.pub)}
                style={{ fontSize: '10px', padding: '2px 5px' }}
                disabled={u.pub === user.is?.pub || !!myFriends[u.pub]}
              >
                {u.pub === user.is?.pub ? 'Me' : myFriends[u.pub] ? 'Aggiunto' : 'Add Friend'}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
