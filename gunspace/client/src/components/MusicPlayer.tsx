import React from 'react';

interface MusicPlayerProps {
  url: string;
}

export const MusicPlayer: React.FC<MusicPlayerProps> = ({ url }) => {
  if (!url) return null;

  // Simple YouTube/SoundCloud embed logic
  let embedUrl = '';
  if (url.includes('youtube.com') || url.includes('youtu.be')) {
    const videoId = url.split('v=')[1]?.split('&')[0] || url.split('/').pop();
    embedUrl = `https://www.youtube.com/embed/${videoId}?autoplay=1`;
  } else if (url.includes('soundcloud.com')) {
    embedUrl = `https://w.soundcloud.com/player/?url=${encodeURIComponent(url)}&auto_play=true`;
  }

  if (!embedUrl) return <p style={{ fontSize: '10px' }}>Invalid Music URL</p>;

  return (
    <div style={{ position: 'fixed', bottom: 0, right: 0, width: '300px', height: '100px', zIndex: 1000, background: '#000', border: '1px solid #6699cc' }}>
      <iframe 
        width="100%" 
        height="100%" 
        scrolling="no" 
        frameBorder="no" 
        allow="autoplay" 
        src={embedUrl}
      ></iframe>
    </div>
  );
};
