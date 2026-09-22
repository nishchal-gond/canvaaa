import React, { useState, useEffect, useRef } from 'react';
import './DisplayPlayer.css';
import { apiUrl, assetUrl } from '../config/api';
import { saveSlideBlob, getSlideBlob, saveSignageMeta, getSignageMeta } from '../utils/offlineCache';

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
  const [isFullscreen, setIsFullscreen] = useState(
    () => Boolean(typeof document !== 'undefined' && (document.fullscreenElement || document.webkitFullscreenElement))
  );

  const isPausedRef = useRef(isPaused);
  isPausedRef.current = isPaused;

  const slidesRef = useRef(slides);
  slidesRef.current = slides;

  const lastPublishedAtRef = useRef(displayState?.last_published_at || null);
  const activePresIdRef = useRef(displayState?.active_presentation_id || null);
  const mediaTypeRef = useRef(displayState?.media_type || 'presentation');
  const mediaUrlRef = useRef(displayState?.media_url || null);
  const slidesHashRef = useRef('');

  const videoRef = useRef(null);

  // Track fullscreen changes across all browsers
  useEffect(() => {
    const handleFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement || document.webkitFullscreenElement));
    };

    document.addEventListener('fullscreenchange', handleFsChange);
    document.addEventListener('webkitfullscreenchange', handleFsChange);
    document.addEventListener('mozfullscreenchange', handleFsChange);
    document.addEventListener('MSFullscreenChange', handleFsChange);

    return () => {
      document.removeEventListener('fullscreenchange', handleFsChange);
      document.removeEventListener('webkitfullscreenchange', handleFsChange);
      document.removeEventListener('mozfullscreenchange', handleFsChange);
      document.removeEventListener('MSFullscreenChange', handleFsChange);
    };
  }, []);

  // Hydrate slide list with offline IndexedDB Blobs
  const hydrateSlidesWithBlobs = async (slideList) => {
    if (!Array.isArray(slideList) || slideList.length === 0) return slideList;
    return Promise.all(
      slideList.map(async (slide) => {
        const key = `slide_${slide.id}`;
        let blob = await getSlideBlob(key);
        if (!blob) {
          try {
            const res = await fetch(assetUrl(slide.image_path));
            if (res.ok) {
              blob = await res.blob();
              await saveSlideBlob(key, blob);
            }
          } catch {
            // offline or tunnel down, will use existing or fallback
          }
        }
        return {
          ...slide,
          blobUrl: blob ? URL.createObjectURL(blob) : null
        };
      })
    );
  };

  // Process incoming display payload from API, SSE, or offline cache
  const handleDisplayPayload = async (payload) => {
    if (!payload) return;

    const newState = payload.state;
    if (newState) {
      setDisplayState(newState);
      setIsPaused(Boolean(newState.is_paused));
      if (newState.rotation_interval) {
        setRotationInterval(newState.rotation_interval);
      }
      try {
        localStorage.setItem('lph_cached_state', JSON.stringify(newState));
        await saveSignageMeta('cached_state', newState);
      } catch (e) {
        console.error(e);
      }
    }

    const isVideo = newState?.media_type === 'video';
    const isNewPublish = newState?.last_published_at && newState.last_published_at !== lastPublishedAtRef.current;
    const isNewPres = newState?.active_presentation_id && newState.active_presentation_id !== activePresIdRef.current;
    const isMediaTypeChanged = newState?.media_type && newState.media_type !== mediaTypeRef.current;
    const isMediaUrlChanged = isVideo && newState?.media_url !== mediaUrlRef.current;

    // Save tracking refs
    if (newState?.last_published_at) lastPublishedAtRef.current = newState.last_published_at;
    if (newState?.active_presentation_id) activePresIdRef.current = newState.active_presentation_id;
    if (newState?.media_type) mediaTypeRef.current = newState.media_type;
    if (newState?.media_url) mediaUrlRef.current = newState.media_url;

    if (isVideo) {
      setSlides([]);
      slidesHashRef.current = '';
      if (videoRef.current) {
        if (newState?.is_paused) {
          videoRef.current.pause();
        } else {
          videoRef.current.play().catch(() => {});
        }
      }
    } else if (payload.slides && Array.isArray(payload.slides) && payload.slides.length > 0) {
      const newHash = payload.slides.map((s) => `${s.id}_${s.image_path}`).join('|');
      const isSlidesChanged = newHash !== slidesHashRef.current;

      // Update slides if newly published, new presentation, media type switched, slides changed, or blobs missing
      if (
        isNewPublish ||
        isNewPres ||
        isMediaTypeChanged ||
        isSlidesChanged ||
        slidesRef.current.some((s) => !s.blobUrl)
      ) {
        slidesHashRef.current = newHash;
        const hydrated = await hydrateSlidesWithBlobs(payload.slides);
        setSlides(hydrated);
        setCurrentSlideIndex(0);
        setProgress(0);
        try {
          localStorage.setItem('lph_cached_slides', JSON.stringify(payload.slides));
          await saveSignageMeta('cached_slides', payload.slides);
        } catch (e) {
          console.error('Storage write failed:', e);
        }
      }
    }

    setConnectionStatus(newState?.is_paused ? 'paused' : 'live');
  };

  // Initial fetch on mount + offline IndexedDB hydration
  useEffect(() => {
    // 1. Instantly hydrate from local IndexedDB storage
    (async () => {
      const cachedMetaSlides = await getSignageMeta('cached_slides');
      if (cachedMetaSlides && cachedMetaSlides.length > 0 && slidesRef.current.length === 0) {
        const hydrated = await hydrateSlidesWithBlobs(cachedMetaSlides);
        setSlides(hydrated);
      }
    })();

    // 2. Fetch live state from API with cache-busting
    fetch(`${apiUrl('/api/display/current')}?_t=${Date.now()}`, {
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache' }
    })
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
        // If offline, ensure playback is UNPAUSED so cached slides loop forever
        setIsPaused(false);
      });
  }, []);

  // Continuous background synchronization (every 2.5s) with cache busting
  useEffect(() => {
    const syncInterval = setInterval(() => {
      fetch(`${apiUrl('/api/display/current')}?_t=${Date.now()}`, {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache' }
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data) handleDisplayPayload(data);
        })
        .catch(() => {
          // Keep running cached slides uninterrupted
        });
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
  // Continuous smooth looping: will NEVER freeze, regardless of network or status changes
  useEffect(() => {
    if (displayState?.media_type === 'video' || isPaused || slides.length <= 1) {
      setProgress(0);
      return;
    }

    const intervalMs = Math.max(2, (rotationInterval || 10)) * 1000;
    const tickMs = 100;
    let startTime = Date.now();

    const timer = setInterval(() => {
      const now = Date.now();
      const elapsed = now - startTime;
      if (elapsed >= intervalMs) {
        startTime = Date.now();
        setCurrentSlideIndex((prev) => (prev + 1) % slides.length);
        setProgress(0);
      } else {
        setProgress(Math.min((elapsed / intervalMs) * 100, 100));
      }
    }, tickMs);

    return () => clearInterval(timer);
  }, [slides.length, rotationInterval, isPaused, displayState?.media_type]);

  // Fullscreen toggle (F or double-click) and Manual Slide navigation (Arrow keys)
  const toggleFullscreen = () => {
    if (!document.fullscreenElement && !document.webkitFullscreenElement) {
      const elem = document.documentElement;
      if (elem.requestFullscreen) {
        elem.requestFullscreen().catch(() => {});
      } else if (elem.webkitRequestFullscreen) {
        elem.webkitRequestFullscreen();
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      } else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
      }
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
    <div
      className={`display-viewport ${isFullscreen ? 'is-fullscreen' : ''}`}
      onDoubleClick={toggleFullscreen}
    >
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
                src={slide.blobUrl || assetUrl(slide.image_path)}
                alt={`Slide ${slide.slide_index}`}
                className={`slide-layer ${idx === currentSlideIndex ? 'active' : ''}`}
                onError={(e) => {
                  // If remote asset fails to load, try fallback
                  if (slide.blobUrl && e.target.src !== slide.blobUrl) {
                    e.target.src = slide.blobUrl;
                  }
                }}
              />
            ))}

            {/* Bottom Progress Bar */}
            {slides.length > 1 && (
              <div className="slide-progress-bar" style={{ width: `${progress}%` }} />
            )}
          </>
        )}

        {/* Live Signage Status Badge - completely hidden when in fullscreen mode */}
        {!isFullscreen && (
          <div className="signage-badge">
            <div
              className={`status-dot ${
                connectionStatus === 'paused'
                  ? 'paused'
                  : connectionStatus === 'offline'
                  ? 'offline'
                  : ''
              }`}
            />
            <span>
              {connectionStatus === 'paused'
                ? 'PAUSED'
                : connectionStatus === 'offline'
                ? 'OFFLINE (PLAYING CACHE)'
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
        )}
      </div>
    </div>
  );
}
