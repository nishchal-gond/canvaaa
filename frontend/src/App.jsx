import React, { useState, useEffect } from 'react';
import DisplayPlayer from './pages/DisplayPlayer.jsx';
import AdminPanel from './pages/AdminPanel.jsx';
import AdminLock from './components/AdminLock.jsx';

export default function App() {
  const [currentPath, setCurrentPath] = useState(window.location.pathname);
  const [isAdminAuthed, setIsAdminAuthed] = useState(() => {
    try {
      return (
        sessionStorage.getItem('lph_admin_authed') === 'true' ||
        localStorage.getItem('lph_admin_authed') === 'true'
      );
    } catch {
      return false;
    }
  });

  useEffect(() => {
    const handlePopState = () => {
      setCurrentPath(window.location.pathname);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const handleAdminLock = () => {
    try {
      sessionStorage.removeItem('lph_admin_authed');
      localStorage.removeItem('lph_admin_authed');
    } catch {}
    setIsAdminAuthed(false);
  };

  if (currentPath.startsWith('/admin')) {
    if (!isAdminAuthed) {
      return <AdminLock onUnlock={() => setIsAdminAuthed(true)} />;
    }
    return <AdminPanel onLock={handleAdminLock} />;
  }

  // Default to Display Player for kiosk screens
  return <DisplayPlayer />;
}
