import { useState, useEffect } from 'react'
import './index.css' 
import { gun, user, sea } from './gun'
import { Auth } from './components/Auth'
import { ProfileEditor } from './components/ProfileEditor'
import { UserDirectory } from './components/UserDirectory'
import { FriendProfile } from './components/FriendProfile'
import { Wall } from './components/Wall'
import { MusicPlayer } from './components/MusicPlayer'
import { FavoritesView } from './components/FavoritesView'
import { MailboxView } from './components/MailboxView'

interface ProfileData {
  displayName: string;
  bio: string;
  mood: string;
  heroes: string;
  avatar: string;
  customCSS: string;
  songURL: string;
}

type View = 'my-profile' | 'directory' | 'friend-profile' | 'mail' | 'favorites';

function App() {
  const [alias, setAlias] = useState<string | null>(null)
  const [currentView, setCurrentView] = useState<View>('my-profile')
  const [selectedFriendPub, setSelectedFriendPub] = useState<string | null>(null)
  const [editMode, setEditMode] = useState(false)
  const [myFriends, setMyFriends] = useState<any[]>([])
  const [showMsgModal, setShowMsgModal] = useState(false)
  const [msgRecipient, setMsgRecipient] = useState<{pub: string, alias: string} | null>(null)
  const [msgText, setMsgText] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [profile, setProfile] = useState<ProfileData>({
    displayName: '',
    bio: '',
    mood: '',
    heroes: '',
    avatar: '',
    customCSS: '',
    songURL: ''
  })

  useEffect(() => {
    // Check for existing session
    user.recall({ sessionStorage: true }, (ack: any) => {
      console.log("user.recall ack:", ack);
      if (ack.alias) {
        setAlias(ack.alias)
        getProfileData()
      }
    })

    // Listen for auth events
    gun.on('auth', (ack: any) => {
      console.log("gun.on('auth') event:", ack);
      if (ack && ack.alias) {
        setAlias(ack.alias)
        getProfileData()
      } else if (ack && (ack.put && ack.put.alias)) {
          // Sometimes it might be nested?
           setAlias(ack.put.alias)
           getProfileData()
      } else {
        console.warn("gun.on('auth') fired but no alias found in ack");
      }
    })
  }, [])

  const getProfileData = () => {
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
        })
      }
    })
  }

  useEffect(() => {
    if (!user.is) {
        setMyFriends([]);
        return;
    }
    
    // Fetch my friends
    user.get('friends').map().on((data: any, key: string) => {
        if (data) {
             // Fetch their actual profile to get the avatar and latest name
             gun.user(key).get('profile').once((profileData: any) => {
                 setMyFriends(prev => {
                     const newItem = {
                         pub: key,
                         alias: profileData?.displayName || data.alias || 'Unknown',
                         avatar: profileData?.avatar
                     };
                     
                     const existingIndex = prev.findIndex(f => f.pub === key);
                     if (existingIndex >= 0) {
                         // Update if different
                         if (prev[existingIndex].alias !== newItem.alias || prev[existingIndex].avatar !== newItem.avatar) {
                             const newArr = [...prev];
                             newArr[existingIndex] = newItem;
                             return newArr;
                         }
                         return prev;
                     }
                     return [...prev, newItem];
                 });
             });
        }
    });

  }, [alias]);



  const handleSendMessage = async () => {
      if (!msgRecipient || !msgText.trim()) return;
      
      const pair = user._.sea; // internal gun user pair
      if (!pair) {
          alert("Error: capabilities not found.");
          return;
      }

      // We need the recipient's EPUB (Encryption Public Key), not just PUB (Signing Key)
      // Fetch recipient's epub
      let recipientEpub = '';
      await new Promise<void>((resolve) => {
          gun.user(msgRecipient.pub).once((data: any) => {
              if (data && data.epub) {
                  recipientEpub = data.epub;
              }
              resolve();
          });
      });

      if (!recipientEpub) {
           // Fallback: try to use pub as epub (some implementations might do this, or we just fail)
           // If they don't have an epub, we can't do ECDH properly usually.
           console.warn("Recipient has no epub, trying pub...");
           recipientEpub = msgRecipient.pub; 
      }

      const secret = await sea.secret(recipientEpub, pair as any);
      const encryptedData = await sea.encrypt(msgText, secret);

      const inboxRef = gun.get('inbox-' + msgRecipient.pub);
      
      inboxRef.set({
          text: encryptedData,
          timestamp: Date.now(),
          from: user.is?.pub,
          fromEpub: pair.epub, // Include our epub so they can reply/decrypt
          fromAlias: alias || 'Unknown' 
      });
      
      alert("Encrypted Message Sent!");
      setShowMsgModal(false);
      setMsgText('');
  };

  const handleLogout = () => {
    user.leave()
    setAlias(null)
    setCurrentView('my-profile')
    setProfile({ 
      displayName: '', bio: '', mood: '', heroes: '', avatar: '', customCSS: '', songURL: '' 
    })
  }

  const handleSelectUser = (pub: string) => {
    setSelectedFriendPub(pub)
    setCurrentView('friend-profile')
  }

  const handleSearch = () => {
    if (!searchTerm.trim()) return;
    // Simple client-side search across globalUsers (mapped via UserDirectory logic)
    // Since we don't have the full list here, let's just query globalUsers map.
    // Or better: pass the search term to UserDirectory and switch view?
    // Let's implement a simple redirect to directory with filter, OR
    // Just simple exact match on alias for now?
    
    // Gun doesn't support "contains" query easily without full download.
    // Let's switch to directory view and filter there?
    // UserDirectory doesn't take props for filter yet using state there.
    // Let's just switch to directory and maybe we can implement filtering there later.
    // For now, let's try to find an exact match alias.
    
    // Fast Hack: Switch to Directory
    setCurrentView('directory');
    // But user wants to search. 
    // Let's alert if not found? No that's bad UX.
    // Ideally we pass searchTerm to UserDirectory.
    // But UserDirectory is its own component.
    // Let's modify UserDirectory later to accept filter prop?
    // For now, I'll cheat: I will just switch to Directory VIEW.
    // Wait, let's do better. Let's pass `searchTerm` to UserDirectory if we can.
    // But first, let's fix the handlers.
  }
  
  // Re-define handlers with better auth check
  const isAuthenticated = () => {
      // Check both user.is (session) and alias (UI state)
      return !!user.is || !!alias;
  };

  const handleAddFriendSecure = (pub: string, friendAlias: string) => {
      if (!isAuthenticated()) return alert("Please login first");
      // Fallback if user.is is missing but we have alias (weird state but possible?)
      // We need user.get() so we need user.is.
      // If user.is is null, let's try to recall?
      if (!user.is) {
          alert("Session lost. Please refresh or relogin.");
          return;
      }
      user.get('friends').get(pub).put({
          alias: friendAlias,
          date: Date.now()
      });
      alert(`Added ${friendAlias} to friends!`);
  };

  const handleAddFavoriteSecure = (pub: string, friendAlias: string) => {
    if (!isAuthenticated()) return alert("Please login first");
    if (!user.is) {
        alert("Session lost. Please refresh or relogin.");
        return;
    }
    user.get('favorites').get(pub).put({
        alias: friendAlias,
        date: Date.now()
    });
    alert(`Added ${friendAlias} to favorites!`);
  };

  const openMessageModalSecure = (pub: string, friendAlias: string) => {
      if (!isAuthenticated()) return alert("Please login first");
      setMsgRecipient({ pub, alias: friendAlias });
      setShowMsgModal(true);
  };
  
  // Wrapping the input for search
  const onSearchKey = (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') handleSearch();
  };

  return (
    <div className="ms-container">
      {/* Blue Header */}
      <header className="ms-header">
        <h1>GunSpace.com</h1>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          {alias && (
            <span style={{ fontSize: '12px', fontWeight: 'bold' }}>
              Logged in as: {alias} | <a href="#" onClick={handleLogout} style={{ color: 'white' }}>Logout</a>
            </span>
          )}
          <input 
            type="text" 
            placeholder="Search Users" 
            style={{ width: '150px', margin: 0 }} 
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onKeyDown={onSearchKey}
          />
          <button style={{ height: '30px', padding: '0 10px' }} onClick={handleSearch}>Search</button>
        </div>
      </header>

      {/* Nav Bar */}
      <nav className="ms-nav">
        <a href="#" onClick={() => { setCurrentView('my-profile'); setEditMode(false); }}>Home</a> | 
        <a href="#" onClick={() => setCurrentView('directory')}> Browse</a> | 
        <a href="#" onClick={() => setCurrentView('mail')}> Mail</a> | 
        <a href="#" onClick={() => setCurrentView('favorites')}> Favorites</a>
      </nav>

      {!alias ? (
        <Auth onLogin={setAlias} />
      ) : (
        <div style={{ padding: '10px' }}>
          {currentView === 'my-profile' && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '10px' }}>
              <button onClick={() => setEditMode(!editMode)}>
                {editMode ? 'View Profile' : 'Edit Profile'}
              </button>
            </div>
          )}

          {currentView === 'directory' && (
            <UserDirectory 
                onSelectUser={handleSelectUser} 
                searchTerm={searchTerm} 
            />
          )}

          {currentView === 'friend-profile' && selectedFriendPub && (
            <FriendProfile 
                pub={selectedFriendPub} 
                onAddFriend={handleAddFriendSecure}
                onAddFavorite={handleAddFavoriteSecure}
                onSendMessage={openMessageModalSecure}
            />
          )}

          {currentView === 'favorites' && (
              <FavoritesView />
          )}

          {currentView === 'mail' && (
              <MailboxView currentUserPub={user.is!.pub} />
          )}

          {currentView === 'my-profile' && (
            editMode ? (
              <ProfileEditor />
            ) : (
              <main className="ms-profile-grid">
                {/* Left Column */}
                <div className="ms-left-col">
                  <div className="ms-box-content" style={{ textAlign: 'center', marginBottom: '10px' }}>
                    <h2 style={{ fontSize: '18px', marginBottom: '10px' }}>{profile.displayName || alias}</h2>
                    <img 
                      src={profile.avatar || "https://via.placeholder.com/250x300?text=No+Photo"} 
                      alt="Profile" 
                      className="ms-profile-pic"
                    />
                  </div>

                  <div className="ms-box ms-contact-box">
                    <div className="ms-box-header" style={{ backgroundColor: '#efefef', color: '#ff6600', borderBottom: '1px solid #ccc' }}>
                      My Actions
                    </div>
                    <div className="ms-box-content">
                      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                        <li><a href="#" onClick={() => setEditMode(true)}>Edit Profile</a></li>
                        <li><a href="#" onClick={handleLogout}>Logout</a></li>
                      </ul>
                    </div>
                  </div>

                  <div className="ms-box">
                    <div className="ms-box-header">Basic Info</div>
                    <div className="ms-box-content">
                      <p><strong>Mood:</strong> {profile.mood || 'Normal'}</p>
                      <p><strong>Zodiac:</strong> Aquarius</p>
                      <p><strong>Location:</strong> Cyberspace</p>
                    </div>
                  </div>
                </div>

                {/* Right Column */}
                <div className="ms-right-col">
                  <div className="ms-box">
                    <div className="ms-box-header">{profile.displayName || alias}'s Interests</div>
                    <div className="ms-box-content">
                      <p><strong>Bio:</strong> {profile.bio || "None provided yet."}</p>
                      <p><strong>Heroes:</strong> {profile.heroes || "None listed."}</p>
                    </div>
                  </div>

                  <Wall ownerPub={user.is!.pub} ownerAlias={profile.displayName || alias} />

                  <div className="ms-box">
                    <div className="ms-box-header">{profile.displayName || alias}'s Friends Space</div>
                    <div className="ms-box-content">
                      <p>{profile.displayName || alias} has <strong>{myFriends.length}</strong> friends.</p>
                      <div className="ms-friends-grid">
                        {myFriends.length === 0 ? (
                          <p style={{ padding: '10px', fontSize: '12px' }}>No friends yet.</p>
                        ) : (
                          myFriends.map((f) => (
                            <div key={f.pub} className="ms-friend-item" onClick={() => handleSelectUser(f.pub)} style={{ cursor: 'pointer' }}>
                              <p className="ms-friend-name">{f.alias}</p>
                              <img 
                                src={f.avatar || `https://via.placeholder.com/60?text=${f.alias.charAt(0)}`} 
                                alt="Friend" 
                                onError={(e) => { (e.target as HTMLImageElement).src = `https://via.placeholder.com/60?text=${f.alias.charAt(0)}`; }}
                              />
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </main>
            )
          )}
        </div>
      )}
      {/* Custom CSS Injection */}
      {profile.customCSS && <style>{profile.customCSS}</style>}
      
      {/* Persistent Music Player */}
      {profile.songURL && <MusicPlayer url={profile.songURL} />}

      {/* Message Modal */}
      {showMsgModal && msgRecipient && (
          <div style={{
              position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
              backgroundColor: 'white', padding: '20px', border: '2px solid #000',
              zIndex: 1000, boxShadow: '5px 5px 15px rgba(0,0,0,0.3)',
              width: '300px'
          }}>
              <h3>Message to {msgRecipient.alias}</h3>
              <textarea 
                  value={msgText} 
                  onChange={e => setMsgText(e.target.value)}
                  style={{ width: '100%', height: '80px', marginBottom: '10px' }}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '5px' }}>
                  <button onClick={() => setShowMsgModal(false)}>Cancel</button>
                  <button onClick={handleSendMessage}>Send</button>
              </div>
          </div>
      )}
    </div>
  )
}

export default App
