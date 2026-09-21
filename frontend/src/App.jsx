import React, { useState, useEffect } from 'react';
import DisplayPlayer from './pages/DisplayPlayer.jsx';
import AdminPanel from './pages/AdminPanel.jsx';

export default function App() {
  const [currentPath, setCurrentPath] = useState(window.location.pathname);

  useEffect(() => {
    const handlePopState = () => {
      setCurrentPath(window.location.pathname);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  if (currentPath.startsWith('/admin')) {
    return <AdminPanel />;
  }

  // Default to Display Player for kiosk screens
  return <DisplayPlayer />;
}
