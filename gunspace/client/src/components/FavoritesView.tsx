import React, { useState, useEffect } from 'react';
import { user, gun } from '../gun';

export const FavoritesView = () => {
    const [favorites, setFavorites] = useState<any[]>([]);

    useEffect(() => {
        user.get('favorites').map().on((data: any, key: string) => {
            if (data) {
                // Fetch profile for better info
                 gun.user(key).get('profile').once((profileData: any) => {
                     setFavorites(prev => {
                         const newItem = {
                             pub: key,
                             alias: profileData?.displayName || data.alias || 'Unknown',
                             avatar: profileData?.avatar
                         };
                         
                         if (prev.find(f => f.pub === key)) return prev;
                         return [...prev, newItem];
                     });
                 });
            }
        });
    }, []);

    return (
        <div className="ms-box">
            <div className="ms-box-header">My Favorites</div>
            <div className="ms-box-content">
                <div className="ms-friends-grid">
                    {favorites.length === 0 ? (
                        <p>No favorites yet.</p>
                    ) : (
                        favorites.map((f) => (
                            <div key={f.pub} className="ms-friend-item">
                                <p className="ms-friend-name">{f.alias}</p>
                                <img 
                                    src={f.avatar || `https://via.placeholder.com/60?text=${f.alias.charAt(0)}`} 
                                    alt="Favorite" 
                                    onError={(e) => { (e.target as HTMLImageElement).src = `https://via.placeholder.com/60?text=${f.alias.charAt(0)}`; }}
                                />
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
};
