import React, { useState } from 'react';
import { Lock, Eye, EyeOff, ArrowLeft, Key, AlertCircle } from 'lucide-react';
import { apiUrl } from '../config/api';
import './AdminLock.css';

export default function AdminLock({ onUnlock }) {
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [isShaking, setIsShaking] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!password.trim()) {
      setError('Please enter the admin password');
      triggerShake();
      return;
    }

    setIsLoading(true);
    setError('');

    const trimmedPassword = password.trim();

    try {
      // 1. Attempt verification with backend API
      const res = await fetch(apiUrl('/api/admin/verify'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: trimmedPassword })
      });

      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          grantAccess();
          return;
        }
      }

      if (res.status === 401) {
        setError('Incorrect password. Please try again.');
        triggerShake();
        setIsLoading(false);
        return;
      }
    } catch {
      // 2. Client-side fallback if backend is offline or sleeping
      const defaultPassword = import.meta.env.VITE_ADMIN_PASSWORD || 'lph2026';
      if (trimmedPassword === defaultPassword) {
        grantAccess();
        return;
      }
      setError('Incorrect password. Please try again.');
      triggerShake();
      setIsLoading(false);
      return;
    }

    // Fallback if response wasn't handled
    const defaultPassword = import.meta.env.VITE_ADMIN_PASSWORD || 'lph2026';
    if (trimmedPassword === defaultPassword) {
      grantAccess();
      return;
    }

    setError('Incorrect password. Please try again.');
    triggerShake();
    setIsLoading(false);
  };

  const grantAccess = () => {
    sessionStorage.setItem('lph_admin_authed', 'true');
    if (rememberMe) {
      localStorage.setItem('lph_admin_authed', 'true');
    }
    setIsLoading(false);
    onUnlock();
  };

  const triggerShake = () => {
    setIsShaking(true);
    setTimeout(() => setIsShaking(false), 500);
  };

  return (
    <div className="admin-lock-wrapper">
      <div className={`admin-lock-card ${isShaking ? 'shake' : ''}`}>
        <div className="lock-branding">
          <img src="/lph-logo.png" alt="LPH Luxury Properties Hub" className="lock-logo" />
        </div>

        <div className="lock-icon-container">
          <div className="lock-glow-ring">
            <Lock size={28} className="lock-icon-inner" />
          </div>
        </div>

        <h2 className="lock-title">ADMIN ACCESS RESTRICTED</h2>
        <p className="lock-subtitle">
          Enter the security password to access commercial display controls and Canva sync operations.
        </p>

        {error && (
          <div className="lock-error-banner">
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="lock-form">
          <div className="lock-input-group">
            <Key size={18} className="input-key-icon" />
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (error) setError('');
              }}
              placeholder="Enter Admin Password"
              autoFocus
              className="lock-input"
              autoComplete="current-password"
            />
            <button
              type="button"
              className="toggle-password-btn"
              onClick={() => setShowPassword(!showPassword)}
              tabIndex={-1}
              title={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>

          <div className="lock-options">
            <label className="remember-label">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="remember-checkbox"
              />
              <span>Remember this browser</span>
            </label>
          </div>

          <button
            type="submit"
            className="lock-submit-btn"
            disabled={isLoading}
          >
            {isLoading ? (
              <span className="btn-loading-text">Verifying...</span>
            ) : (
              <>
                <Lock size={16} />
                <span>UNLOCK ADMIN PANEL</span>
              </>
            )}
          </button>
        </form>

        <div className="lock-footer">
          <a href="/display" className="back-display-link">
            <ArrowLeft size={14} />
            <span>Return to Live Display Player</span>
          </a>
        </div>
      </div>
    </div>
  );
}
