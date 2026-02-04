import React, { useState } from 'react';
import { gun, user } from '../gun';

interface AuthProps {
  onLogin: (alias: string) => void;
}

export const Auth: React.FC<AuthProps> = ({ onLogin }) => {
  const [alias, setAlias] = useState('');
  const [pass, setPass] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = () => {
    if (loading) return;
    setError('');
    setLoading(true);
    console.log("Starting login for:", alias);
    
    user.auth(alias, pass, (ack: any) => {
      console.log("Login ack:", ack);
      setLoading(false);
      if (ack.err) {
        setError(ack.err);
      } else {
        // Register in global registry for discovery
        (user as any).get('profile').once((data: any) => {
          gun.get('globalUsers').get(user.is!.pub).put({
            alias: alias,
            pub: user.is!.pub,
            displayName: data?.displayName || alias
          });
        });
        onLogin(alias);
      }
    });
  };

  const handleRegister = () => {
    if (loading) return;
    setError('');
    setLoading(true);
    
    user.create(alias, pass, (ack: any) => {
      setLoading(false);
      if (ack.err) {
        setError(ack.err);
      } else {
        handleLogin();
      }
    });
  };

  return (
    <div className="ms-box" style={{ maxWidth: '400px', margin: '50px auto' }}>
      <div className="ms-box-header">Login / Sign Up</div>
      <div className="ms-box-content">
        <p style={{ fontSize: '11px', color: '#666', marginBottom: '10px' }}>
          <strong>Note:</strong> GunSpace uses cryptographic keys. If you lose your password, you lose your account forever!
        </p>
        
        {error && <p style={{ color: 'red', fontSize: '12px' }}>{error}</p>}
        
        <label style={{ display: 'block', fontSize: '12px', marginBottom: '5px' }}>Username (Alias):</label>
        <input 
          type="text" 
          value={alias} 
          onChange={(e) => setAlias(e.target.value)} 
          placeholder="Alias"
          disabled={loading}
        />
        
        <label style={{ display: 'block', fontSize: '12px', marginBottom: '5px' }}>Password:</label>
        <input 
          type="password" 
          value={pass} 
          onChange={(e) => setPass(e.target.value)} 
          placeholder="Pass"
          disabled={loading}
        />
        
        <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
          <button onClick={handleLogin} disabled={loading}>
            {loading ? 'Processing...' : 'Login'}
          </button>
          <button onClick={handleRegister} disabled={loading}>
            {loading ? 'Processing...' : 'Sign Up'}
          </button>
        </div>
      </div>
    </div>
  );
};
