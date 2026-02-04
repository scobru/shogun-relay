import React, { useState, useEffect } from 'react';
import { gun } from '../gun';
import { Wall } from './Wall';

interface ProfileData {
  displayName: string;
  bio: string;
  mood: string;
  heroes: string;
  avatar: string;
  customCSS: string;
  songURL: string;
}

interface FriendProfileProps {
  pub: string;
  onAddFriend: (pub: string, alias: string) => void;
  onAddFavorite: (pub: string, alias: string) => void;
  onSendMessage: (pub: string, alias: string) => void;
}

export const FriendProfile: React.FC<FriendProfileProps> = ({ pub, onAddFriend, onAddFavorite, onSendMessage }) => {
  const [profile, setProfile] = useState<ProfileData>({
    displayName: '',
    bio: '',
    mood: '',
    heroes: '',
    avatar: '',
    customCSS: '',
    songURL: ''
  });
  const [friends, setFriends] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const timer = setTimeout(() => {
        // Fallback or just let it spin for a moment?
        // Actually if we just rely on Gun it might be fast.
        // Let's keep existing logic but ensure we don't flash too much.
        setLoading(false);
    }, 2000); 

    // Fetch user by public key
    gun.user(pub).get('profile').on((data: any) => {
      if (data) {
        setProfile({
          displayName: data.displayName || '',
          bio: data.bio || '',
          mood: data.mood || '',
          heroes: data.heroes || '',
          avatar: data.avatar || '',
          customCSS: data.customCSS || '',
          songURL: data.songURL || ''
        });
      }
      // If we got data, stop loading earlier
      setLoading(false);
      clearTimeout(timer);
    });

    // Fetch friends
    setFriends([]);
    gun.user(pub).get('friends').map().on((data: any) => {
      if (data && data.pub) {
        // Fetch friend's basic info
        gun.user(data.pub).get('profile').once((p: any) => {
          setFriends(prev => {
            if (prev.find(f => f.pub === data.pub)) return prev;
            return [...prev, { pub: data.pub, alias: p?.displayName || 'Unknown' }];
          });
        });
      }
    });

    return () => clearTimeout(timer);
  }, [pub]);

  if (loading) return <div>Caricamento profilo...</div>;

  const handleAction = (e: React.MouseEvent, action: () => void) => {
      e.preventDefault();
      action();
  };

  return (
    <>
      <main className="ms-profile-grid">
        {/* Left Column */}
        <div className="ms-left-col">
          <div className="ms-box-content" style={{ textAlign: 'center', marginBottom: '10px' }}>
            <h2 style={{ fontSize: '18px', marginBottom: '10px' }}>{profile.displayName || "Unknown"}</h2>
            <img 
              src={profile.avatar || "https://via.placeholder.com/250x300?text=No+Photo"} 
              alt="Profile" 
              className="ms-profile-pic"
            />
          </div>

          <div className="ms-box ms-contact-box">
            <div className="ms-box-header" style={{ backgroundColor: '#efefef', color: '#ff6600', borderBottom: '1px solid #ccc' }}>
              Contacting {profile.displayName || "this user"}
            </div>
            <div className="ms-box-content">
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                <li><a href="#" onClick={(e) => handleAction(e, () => onSendMessage(pub, profile.displayName))}>Send Message</a></li>
                <li><a href="#" onClick={(e) => handleAction(e, () => onAddFriend(pub, profile.displayName))}>Add to Friends</a></li>
                <li><a href="#" onClick={(e) => handleAction(e, () => onAddFavorite(pub, profile.displayName))}>Add to Favorites</a></li>
              </ul>
            </div>
          </div>

          <div className="ms-box">
            <div className="ms-box-header">Basic Info</div>
            <div className="ms-box-content">
              <p><strong>Mood:</strong> {profile.mood || 'Normal'}</p>
            </div>
          </div>
        </div>

        {/* Right Column */}
        <div className="ms-right-col">
          <div className="ms-box">
            <div className="ms-box-header">{profile.displayName || "User"}'s Interests</div>
            <div className="ms-box-content">
              <p><strong>Bio:</strong> {profile.bio || "None provided."}</p>
              <p><strong>Heroes:</strong> {profile.heroes || "None listed."}</p>
            </div>
          </div>

          <Wall ownerPub={pub} ownerAlias={profile.displayName || "User"} />

          <div className="ms-box">
            <div className="ms-box-header">{profile.displayName || "User"}'s Friends Space</div>
            <div className="ms-box-content">
              <p>{profile.displayName || "User"} has <strong>{friends.length}</strong> friends.</p>
              <div className="ms-friends-grid">
                {friends.map((f, i) => (
                  <div key={i} className="ms-friend-item">
                    <p className="ms-friend-name">{f.alias}</p>
                    <img src={`https://via.placeholder.com/60?text=${f.alias.charAt(0)}`} alt="Friend" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </main>
      {/* Custom CSS Injection */}
      {profile.customCSS && <style>{profile.customCSS}</style>}
    </>
  );
};
