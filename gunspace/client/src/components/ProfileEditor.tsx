import React, { useState, useEffect } from 'react';
import { user } from '../gun';

interface ProfileData {
  displayName: string;
  bio: string;
  mood: string;
  heroes: string;
  avatar: string;
  customCSS: string;
  songURL: string;
}

export const ProfileEditor: React.FC = () => {
  const [profile, setProfile] = useState<ProfileData>({
    displayName: '',
    bio: '',
    mood: '',
    heroes: '',
    avatar: '',
    customCSS: '',
    songURL: ''
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setLoading(false);
    }, 3000); // 3-second fallback

    user.get('profile').on((data: any) => {
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
      setLoading(false);
      clearTimeout(timer);
    });

    return () => clearTimeout(timer);
  }, []);

  const handleSave = () => {
    user.get('profile').put({
      displayName: profile.displayName,
      bio: profile.bio,
      mood: profile.mood,
      heroes: profile.heroes,
      avatar: profile.avatar,
      customCSS: profile.customCSS,
      songURL: profile.songURL
    });
    alert('Profilo salvato!');
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 102400) { // 100kb limit for Gun safety
        alert('File troppo grande! Massimo 100kb.');
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        setProfile({ ...profile, avatar: reader.result as string });
      };
      reader.readAsDataURL(file);
    }
  };

  if (loading) return <div>Caricamento...</div>;

  return (
    <div className="ms-box">
      <div className="ms-box-header">Edit Profile</div>
      <div className="ms-box-content">
        <label>Display Name:</label>
        <input 
          type="text" 
          value={profile.displayName} 
          onChange={(e) => setProfile({...profile, displayName: e.target.value})} 
        />

        <label>Bio / About Me:</label>
        <textarea 
          value={profile.bio} 
          onChange={(e) => setProfile({...profile, bio: e.target.value})} 
          style={{ height: '100px' }}
        />

        <label>Current Mood (e.g. "Enthusiastic"):</label>
        <input 
          type="text" 
          value={profile.mood} 
          onChange={(e) => setProfile({...profile, mood: e.target.value})} 
        />

        <label>My Heroes:</label>
        <textarea 
          value={profile.heroes} 
          onChange={(e) => setProfile({...profile, heroes: e.target.value})} 
          style={{ height: '60px' }}
        />

        <label>Custom CSS (Extreme Customization):</label>
        <textarea 
          value={profile.customCSS} 
          onChange={(e) => setProfile({...profile, customCSS: e.target.value})} 
          placeholder="body { background: pink; } .ms-box { border: 5px solid red; }"
          style={{ height: '100px', fontFamily: 'monospace' }}
        />

        <label>Song URL (YouTube/SoundCloud):</label>
        <input 
          type="text" 
          value={profile.songURL} 
          onChange={(e) => setProfile({...profile, songURL: e.target.value})} 
          placeholder="https://www.youtube.com/watch?v=..."
        />

        <label>Avatar (Max 100kb):</label>
        <input type="file" accept="image/*" onChange={handleFileChange} />
        {profile.avatar && (
          <img 
            src={profile.avatar} 
            alt="Preview" 
            style={{ width: '100px', marginTop: '10px', display: 'block' }} 
          />
        )}

        <button onClick={handleSave} style={{ marginTop: '15px' }}>Save Profile</button>
      </div>
    </div>
  );
};
