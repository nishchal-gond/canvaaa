import React, { useState, useEffect, useRef } from 'react';
import './DisplayPlayer.css';
import { apiUrl, assetUrl } from '../config/api';

export default function DisplayPlayer() {
  const [displayState, setDisplayState] = useState(() => {
    try {
      const cached = localStorage.getItem('lph_cached_state');
      return cached ? JSON.parse(cached) : null;
    } catch {
      return null;
    }
  });

  const [slides, setSlides] = useState(() => {
    try {
      const cached = localStorage.getItem('lph_cached_slides');
      return cached ? JSON.parse(cached) : [];
    } catch {
      return [];
    }
  });

  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [rotationInterval, setRotationInterval] = useState(10);
  const [connectionStatus, setConnectionStatus] = useState('connecting');
  const [progress, setProgress] = useState(0);

  const timerRef = useRef(null);
  const progressTimerRef = useRef(null);
  const isPausedRef = useRef(isPaused);
  isPausedRef.current = isPaused;

  const slidesRef = useRef(slides);
  slidesRef.current = slides;

  const videoRef = useRef(null);

  // Preload images into memory for zero-latency slide transitions
  const preloadImages = (slideList) => {
    slideList.forEach((slide) => {
      const img = new Image();
      img.src = assetUrl(slide.image_path);
    });
  };

  // Process incoming display payload from API or SSE
  const handleDisplayPayload = (payload) => {
    if (!payload) return;

    if (payload.state) {
      setDisplayState(payload.state);
      setIsPaused(Boolean(payload.state.is_paused));
      if (payload.state.rotation_interval) {
        setRotationInterval(payload.state.rotation_interval);
      }
      try {
        localStorage.setItem('lph_cached_state', JSON.stringify(payload.state));
      } catch (e) {
        console.error(e);
      }
    }

    if (payload.state?.media_type === 'video') {
      setSlides([]);
      // When media is video, pause or play according to pause state
      if (videoRef.current) {
        if (payload.state.is_paused) {
          videoRef.current.pause();
        } else {
          videoRef.current.play().catch(() => {});
        }
      }
    } else if (payload.slides && Array.isArray(payload.slides) && payload.slides.length > 0) {
      const newIds = payload.slides.map((s) => s.id).join(',');
      const oldIds = slidesRef.current.map((s) => s.id).join(',');
      if (newIds !== oldIds) {
        setSlides(payload.slides);
        preloadImages(payload.slides);
        setCurrentSlideIndex(0);
        setProgress(0);
        try {
          localStorage.setItem('lph_cached_slides', JSON.stringify(payload.slides));
        } catch (e) {
          console.error('LocalStorage write failed:', e);
        }
      }
    }

    setConnectionStatus(payload.state?.is_paused ? 'paused' : 'live');
  };

  // Initial fetch on mount
  useEffect(() => {
    fetch(apiUrl('/api/display/current'))
      .then((res) => {
        if (!res.ok) throw new Error('Network error');
        return res.json();
      })
      .then((data) => {
        handleDisplayPayload(data);
      })
      .catch((err) => {
        console.warn('Initial fetch failed, playing from offline cache:', err);
        setConnectionStatus('offline');
      });
  }, []);

  // Continuous background synchronization (every 2.5s)
  // Guarantees display automatically changes content immediately whenever admin publishes
  useEffect(() => {
    const syncInterval = setInterval(() => {
      fetch(apiUrl('/api/display/current'))
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data) handleDisplayPayload(data);
        })
        .catch(() => {});
    }, 2500);

    return () => clearInterval(syncInterval);
  }, []);

  // Server-Sent Events (SSE) listener
  useEffect(() => {
    let eventSource = null;
    let reconnectTimeout = null;

    const connectSSE = () => {
      eventSource = new EventSource(apiUrl('/api/display/stream'));

      eventSource.addEventListener('INIT_STATE', (e) => {
        try {
          const data = JSON.parse(e.data);
          handleDisplayPayload(data);
        } catch (err) {
          console.error('Failed to parse INIT_STATE:', err);
        }
      });

      eventSource.addEventListener('PRESENTATION_PUBLISHED', (e) => {
        try {
          const data = JSON.parse(e.data);
          console.log('⚡ Received published update:', data);
          handleDisplayPayload(data);
        } catch (err) {
          console.error('Failed to parse PRESENTATION_PUBLISHED:', err);
        }
      });

      eventSource.addEventListener('DISPLAY_STATE_CHANGED', (e) => {
        try {
          const data = JSON.parse(e.data);
          console.log('Display state changed (pause/continue):', data);
          handleDisplayPayload(data);
        } catch (err) {
          console.error('Failed to parse DISPLAY_STATE_CHANGED:', err);
        }
      });

      eventSource.onopen = () => {
        setConnectionStatus(isPausedRef.current ? 'paused' : 'live');
      };

      eventSource.onerror = () => {
        setConnectionStatus('offline');
        eventSource.close();
        reconnectTimeout = setTimeout(connectSSE, 4000);
      };
    };

    connectSSE();

    return () => {
      if (eventSource) eventSource.close();
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
    };
  }, []);

  // Video playback control on pause state change
  useEffect(() => {
    if (displayState?.media_type === 'video' && videoRef.current) {
      if (isPaused) {
        videoRef.current.pause();
      } else {
        videoRef.current.play().catch(() => {});
      }
    }
  }, [isPaused, displayState?.media_type]);

  // Slide auto-rotation timer (for presentation mode)
  useEffect(() => {
    if (displayState?.media_type === 'video' || isPaused || slides.length <= 1) {
      setProgress(0);
      return;
    }

    const intervalMs = (rotationInterval || 10) * 1000;
    const tickMs = 100;
    let elapsed = 0;

    const timer = setInterval(() => {
      elapsed += tickMs;
      if (elapsed >= intervalMs) {
        elapsed = 0;
        setCurrentSlideIndex((prev) => (prev + 1) % slides.length);
        setProgress(0);
      } else {
        setProgress(Math.min((elapsed / intervalMs) * 100, 100));
      }
    }, tickMs);

    return () => clearInterval(timer);
  }, [slides.length, rotationInterval, isPaused, displayState?.media_type, currentSlideIndex]);

  // Fullscreen toggle (F) and Manual Slide navigation (Arrow keys / Space)
  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'f' || e.key === 'F') {
        toggleFullscreen();
      } else if (e.key === 'ArrowRight') {
        if (slides.length > 0) {
          setCurrentSlideIndex((prev) => (prev + 1) % slides.length);
          setProgress(0);
        }
      } else if (e.key === 'ArrowLeft') {
        if (slides.length > 0) {
          setCurrentSlideIndex((prev) => (prev - 1 + slides.length) % slides.length);
          setProgress(0);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [slides.length]);

  const isVideo = displayState?.media_type === 'video';
  const hasContent = isVideo ? Boolean(displayState?.media_url) : slides.length > 0;

  return (
    <div className="display-viewport" onDoubleClick={toggleFullscreen}>
      <div className="display-stage">
        {!hasContent ? (
          <div className="display-empty-state">
            <div className="empty-logo">LPH</div>
            <div className="empty-sub">LUXURY PROPERTIES HUB</div>
            <div className="empty-help">
              Awaiting Presentation or Video. Open <strong>/admin</strong> to upload and publish.
            </div>
          </div>
        ) : isVideo ? (
          <video
            ref={videoRef}
            key={displayState.media_url}
            src={assetUrl(displayState.media_url)}
            className="video-layer"
            autoPlay
            muted
            loop
            playsInline
          />
        ) : (
          <>
            {slides.map((slide, idx) => (
              <img
                key={slide.id || idx}
                src={assetUrl(slide.image_path)}
                alt={`Slide ${slide.slide_index}`}
                className={`slide-layer ${idx === currentSlideIndex ? 'active' : ''}`}
              />
            ))}

            {/* Bottom Progress Bar */}
            {!isPaused && slides.length > 1 && (
              <div className="slide-progress-bar" style={{ width: `${progress}%` }} />
            )}
          </>
        )}

        {/* Live Signage Status Badge */}
        <div className="signage-badge">
          <div
            className={`status-dot ${
              connectionStatus === 'paused' ? 'paused' : connectionStatus === 'offline' ? 'offline' : ''
            }`}
          />
          <span>
            {connectionStatus === 'paused'
              ? 'PAUSED'
              : connectionStatus === 'offline'
              ? 'OFFLINE (CACHED)'
              : 'LIVE DISPLAY'}
          </span>
          <span className="badge-divider" />
          <span className="slide-counter">
            {isVideo
              ? 'VIDEO LOOP'
              : slides.length > 0
              ? `${currentSlideIndex + 1} / ${slides.length}`
              : '0 / 0'}
          </span>
          <span className="badge-divider" />
          <span>LG 98"</span>
        </div>
      </div>
    </div>
  );
}
