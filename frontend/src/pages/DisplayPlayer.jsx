import React, { useState, useEffect, useRef } from 'react';
import {
  Play,
  Pause,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Minimize2,
  Moon,
  Sun,
  Clock,
  Sparkles
} from 'lucide-react';
import './DisplayPlayer.css';
import { apiUrl, assetUrl, CLOUD_BACKEND_URL } from '../config/api';
import { saveSlideBlob, getSlideBlob, saveSignageMeta, getSignageMeta } from '../utils/offlineCache';

/**
 * Checks if current local time is outside office operating hours
 * Default: Operating 06:00 to 19:00 (7 PM). Sleep starts at 19:00 and wakes at 06:00.
 */
function isOutsideOperatingHours(now, startTime = '06:00', endTime = '19:00') {
  if (!startTime || !endTime) return false;
  const [startH, startM] = startTime.split(':').map(Number);
  const [endH, endM] = endTime.split(':').map(Number);

  const curMinutes = now.getHours() * 60 + now.getMinutes();
  const startMinutes = (isNaN(startH) ? 6 : startH) * 60 + (isNaN(startM) ? 0 : startM);
  const endMinutes = (isNaN(endH) ? 19 : endH) * 60 + (isNaN(endM) ? 0 : endM);

  if (endMinutes > startMinutes) {
    // Normal day window (e.g. 06:00 - 19:00)
    return curMinutes < startMinutes || curMinutes >= endMinutes;
  } else {
    // Night window spanning midnight
    return curMinutes >= endMinutes && curMinutes < startMinutes;
  }
}

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

  // Preserve and restore yesterday's exact slide position across office shutdowns/restarts
  const [currentSlideIndex, setCurrentSlideIndex] = useState(() => {
    try {
      const saved = localStorage.getItem('lph_saved_slide_index');
      if (saved !== null) {
        const parsed = parseInt(saved, 10);
        return !isNaN(parsed) && parsed >= 0 ? parsed : 0;
      }
    } catch {}
    return 0;
  });

  const [isPaused, setIsPaused] = useState(false);
  const [rotationInterval, setRotationInterval] = useState(10);
  const [connectionStatus, setConnectionStatus] = useState('connecting');
  const [progress, setProgress] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(
    () => Boolean(typeof document !== 'undefined' && (document.fullscreenElement || document.webkitFullscreenElement))
  );

  // Time & Office Operating Schedule State (Default: Sleep 7:00 PM to 6:00 AM)
  const [currentTime, setCurrentTime] = useState(new Date());
  const [manualWakeOverride, setManualWakeOverride] = useState(false);
  const [manualSleepOverride, setManualSleepOverride] = useState(false);

  // Floating Manual Controls HUD Bar Visibility
  const [showControls, setShowControls] = useState(false);
  const controlsTimeoutRef = useRef(null);

  const isPausedRef = useRef(isPaused);
  isPausedRef.current = isPaused;

  const slidesRef = useRef(slides);
  slidesRef.current = slides;

  const currentSlideIndexRef = useRef(currentSlideIndex);
  currentSlideIndexRef.current = currentSlideIndex;

  const lastPublishedAtRef = useRef(displayState?.last_published_at || null);
  const activePresIdRef = useRef(displayState?.active_presentation_id || null);
  const mediaTypeRef = useRef(displayState?.media_type || 'presentation');
  const mediaUrlRef = useRef(displayState?.media_url || null);
  const slidesHashRef = useRef('');

  // Always-fresh ref to handleDisplayPayload so SSE (captured at mount) never uses a stale closure
  const handleDisplayPayloadRef = useRef(null);

  const videoRef = useRef(null);

  // Determine whether display should be in night sleep/standby mode
  const scheduleEnabled = displayState?.schedule_enabled !== false;
  const isNightSchedule = isOutsideOperatingHours(
    currentTime,
    displayState?.schedule_start_time || '06:00',
    displayState?.schedule_end_time || '19:00'
  );
  const isEffectiveSleep =
    manualSleepOverride ||
    Boolean(displayState?.is_scheduled_sleep) ||
    (scheduleEnabled && isNightSchedule && !manualWakeOverride);

  // Persist current slide index in local storage whenever it advances
  useEffect(() => {
    if (slides.length > 0 && currentSlideIndex < slides.length) {
      try {
        localStorage.setItem('lph_saved_slide_index', String(currentSlideIndex));
      } catch {}
    }
  }, [currentSlideIndex, slides.length]);

  // Handle office schedule time ticks every second (clock & auto-transition at 6:00 AM)
  useEffect(() => {
    const clockTimer = setInterval(() => {
      const now = new Date();
      setCurrentTime(now);

      // Reset manual wake override when morning schedule naturally starts (at 6:00 AM)
      if (manualWakeOverride) {
        const isNight = isOutsideOperatingHours(
          now,
          displayState?.schedule_start_time || '06:00',
          displayState?.schedule_end_time || '19:00'
        );
        if (!isNight) {
          setManualWakeOverride(false);
        }
      }
    }, 1000);

    return () => clearInterval(clockTimer);
  }, [manualWakeOverride, displayState?.schedule_start_time, displayState?.schedule_end_time]);

  // When sleep activates or deactivates, manage pause & restore yesterday's slide
  useEffect(() => {
    if (isEffectiveSleep) {
      // 1. Save current slide index for next morning
      if (slides.length > 0) {
        try {
          localStorage.setItem('lph_saved_slide_index', String(currentSlideIndexRef.current));
          fetch(apiUrl('/api/display/save-slide'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ slide_index: currentSlideIndexRef.current })
          }).catch(() => {});
        } catch {}
      }

      // 2. Pause video if video mode
      if (videoRef.current) {
        try {
          videoRef.current.pause();
        } catch {}
      }
    } else {
      // Waking up at 6:00 AM: Restore saved slide from yesterday!
      try {
        const saved = localStorage.getItem('lph_saved_slide_index');
        if (saved !== null) {
          const idx = parseInt(saved, 10);
          if (!isNaN(idx) && idx >= 0 && idx < slidesRef.current.length) {
            setCurrentSlideIndex(idx);
          }
        }
      } catch {}

      if (videoRef.current && !isPausedRef.current) {
        videoRef.current.play().catch(() => {});
      }
    }
  }, [isEffectiveSleep]);

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
          } catch {}
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
    // NOTE: always update the ref so SSE stale-closure callers get the fresh version
    // (The ref assignment below in the useEffect keeps it current)
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

    if (newState?.last_published_at) lastPublishedAtRef.current = newState.last_published_at;
    if (newState?.active_presentation_id) activePresIdRef.current = newState.active_presentation_id;
    if (newState?.media_type) mediaTypeRef.current = newState.media_type;
    if (newState?.media_url) mediaUrlRef.current = newState.media_url;

    if (isVideo) {
      setSlides([]);
      slidesHashRef.current = '';
      if (videoRef.current && !isEffectiveSleep) {
        if (newState?.is_paused) {
          videoRef.current.pause();
        } else {
          videoRef.current.play().catch(() => {});
        }
      }
    } else if (payload.slides && Array.isArray(payload.slides) && payload.slides.length > 0) {
      const newHash = payload.slides.map((s) => `${s.id}_${s.image_path}`).join('|');
      const isSlidesChanged = newHash !== slidesHashRef.current;

      if (
        isNewPublish ||
        isNewPres ||
        isMediaTypeChanged ||
        isSlidesChanged ||
        slidesRef.current.length === 0
      ) {
        slidesHashRef.current = newHash;
        setSlides(payload.slides);

        // Resume from saved slide index if this is a refresh / continuation of existing presentation
        if (isNewPres) {
          setCurrentSlideIndex(0);
          setProgress(0);
        } else {
          try {
            const saved = localStorage.getItem('lph_saved_slide_index');
            const savedIdx = saved !== null ? parseInt(saved, 10) : 0;
            if (!isNaN(savedIdx) && savedIdx >= 0 && savedIdx < payload.slides.length) {
              setCurrentSlideIndex(savedIdx);
            }
          } catch {}
        }

        hydrateSlidesWithBlobs(payload.slides)
          .then((hydrated) => {
            if (hydrated && Array.isArray(hydrated) && hydrated.length > 0) {
              setSlides(hydrated);
            }
          })
          .catch(() => {});

        try {
          localStorage.setItem('lph_cached_slides', JSON.stringify(payload.slides));
          await saveSignageMeta('cached_slides', payload.slides);
        } catch (e) {
          console.error('Storage write failed:', e);
        }
      }
    } else if (!newState?.active_presentation_id || (Array.isArray(payload.slides) && payload.slides.length === 0)) {
      setSlides([]);
      slidesHashRef.current = '';
      try {
        localStorage.removeItem('lph_cached_slides');
        await saveSignageMeta('cached_slides', []);
      } catch (e) {
        console.error(e);
      }
    }

    setConnectionStatus(newState?.is_paused ? 'paused' : 'live');
  };

  // Initial fetch on mount + offline IndexedDB hydration
  useEffect(() => {
    (async () => {
      const cachedMetaSlides = await getSignageMeta('cached_slides');
      if (cachedMetaSlides && cachedMetaSlides.length > 0 && slidesRef.current.length === 0) {
        const hydrated = await hydrateSlidesWithBlobs(cachedMetaSlides);
        setSlides(hydrated);
      }
    })();

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
        setIsPaused(false);
      });
  }, []);

  // Keep the handleDisplayPayload ref always fresh so SSE event handlers never use stale closures
  useEffect(() => {
    handleDisplayPayloadRef.current = handleDisplayPayload;
  });

  // Neon & Memory Optimized Polling:
  // Daytime: poll every 10s (SSE handles immediate updates).
  // Night Sleep (7PM–6AM): NO active polling, but a 60s safety check still runs so that if the
  // SSE connection dropped on the LG screen it will detect the sleep/wake state change within 60s.
  useEffect(() => {
    if (isEffectiveSleep) {
      // During sleep, only run a slow 60s safety poll to detect wake signals if SSE dropped
      const safetyInterval = setInterval(() => {
        fetch(`${apiUrl('/api/display/current')}?_t=${Date.now()}`, {
          cache: 'no-store',
          headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache' }
        })
          .then((res) => (res.ok ? res.json() : null))
          .then((data) => {
            if (data) {
              handleDisplayPayloadRef.current?.(data);
            }
          })
          .catch(() => {});
      }, 60000); // 60s — minimal Neon wakeups but catches SSE drops

      return () => clearInterval(safetyInterval);
    }

    const syncInterval = setInterval(() => {
      fetch(`${apiUrl('/api/display/current')}?_t=${Date.now()}`, {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache' }
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data) {
            handleDisplayPayloadRef.current?.(data);
            setConnectionStatus(data.state?.is_paused ? 'paused' : 'live');
          }
        })
        .catch(() => {});
    }, 10000);

    return () => clearInterval(syncInterval);
  }, [isEffectiveSleep]);

  // Server-Sent Events (SSE) listener for real-time updates and manual slide skip on the fly
  useEffect(() => {
    let eventSource = null;
    let reconnectTimeout = null;

    const connectSSE = () => {
      eventSource = new EventSource(apiUrl('/api/display/stream'));

      eventSource.addEventListener('INIT_STATE', (e) => {
        try {
          const data = JSON.parse(e.data);
          handleDisplayPayloadRef.current?.(data);
        } catch (err) {
          console.error('Failed to parse INIT_STATE:', err);
        }
      });

      eventSource.addEventListener('PRESENTATION_PUBLISHED', (e) => {
        try {
          const data = JSON.parse(e.data);
          handleDisplayPayloadRef.current?.(data);
        } catch (err) {
          console.error('Failed to parse PRESENTATION_PUBLISHED:', err);
        }
      });

      eventSource.addEventListener('DISPLAY_STATE_CHANGED', (e) => {
        try {
          const data = JSON.parse(e.data);
          handleDisplayPayloadRef.current?.(data);
        } catch (err) {
          console.error('Failed to parse DISPLAY_STATE_CHANGED:', err);
        }
      });

      // On-the-fly manual slide navigation received from Admin remote control
      eventSource.addEventListener('SLIDE_NAVIGATE', (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data.action === 'goto' && typeof data.slide_index === 'number') {
            if (data.slide_index >= 0 && data.slide_index < slidesRef.current.length) {
              setCurrentSlideIndex(data.slide_index);
              setProgress(0);
            }
          } else if (data.action === 'next') {
            if (slidesRef.current.length > 0) {
              setCurrentSlideIndex((prev) => (prev + 1) % slidesRef.current.length);
              setProgress(0);
            }
          } else if (data.action === 'prev') {
            if (slidesRef.current.length > 0) {
              setCurrentSlideIndex((prev) => (prev - 1 + slidesRef.current.length) % slidesRef.current.length);
              setProgress(0);
            }
          }
        } catch (err) {
          console.error('Failed to parse SLIDE_NAVIGATE:', err);
        }
      });

      eventSource.addEventListener('SCHEDULE_CHANGED', (e) => {
        try {
          const data = JSON.parse(e.data);
          handleDisplayPayloadRef.current?.(data);
        } catch (err) {
          console.error('Failed to parse SCHEDULE_CHANGED:', err);
        }
      });

      eventSource.addEventListener('RELOAD_DISPLAY', () => {
        console.log('Received remote reload signal. Reloading display player...');
        window.location.reload();
      });

      eventSource.onopen = () => {
        setConnectionStatus(isPausedRef.current ? 'paused' : 'live');
      };

      eventSource.onerror = () => {
        eventSource.close();
        reconnectTimeout = setTimeout(connectSSE, 8000);
      };
    };

    connectSSE();

    return () => {
      if (eventSource) eventSource.close();
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
    };
  }, []);

  // Video playback control on pause or sleep state change
  useEffect(() => {
    if (displayState?.media_type === 'video' && videoRef.current) {
      if (isPaused || isEffectiveSleep) {
        videoRef.current.pause();
      } else {
        videoRef.current.play().catch(() => {});
      }
    }
  }, [isPaused, isEffectiveSleep, displayState?.media_type]);

  // Slide auto-rotation timer (pauses automatically during night sleep or operator pause)
  useEffect(() => {
    if (
      displayState?.media_type === 'video' ||
      isPaused ||
      isEffectiveSleep ||
      slides.length <= 1
    ) {
      setProgress(0);
      return;
    }

    const intervalMs = Math.max(2, rotationInterval || 10) * 1000;
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
  }, [slides.length, rotationInterval, isPaused, isEffectiveSleep, displayState?.media_type]);

  // User activity tracker: shows controls on mouse movement, touch, or keypress
  const handleUserActivity = () => {
    setShowControls(true);
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
    }
    controlsTimeoutRef.current = setTimeout(() => {
      setShowControls(false);
    }, 3500);
  };

  // Manual Slide Navigation on the Fly
  const handlePrevSlide = (e) => {
    e?.stopPropagation?.();
    if (slides.length <= 1) return;
    setCurrentSlideIndex((prev) => (prev - 1 + slides.length) % slides.length);
    setProgress(0);
    handleUserActivity();
  };

  const handleNextSlide = (e) => {
    e?.stopPropagation?.();
    if (slides.length <= 1) return;
    setCurrentSlideIndex((prev) => (prev + 1) % slides.length);
    setProgress(0);
    handleUserActivity();
  };

  const handleJumpToSlide = (idx, e) => {
    e?.stopPropagation?.();
    if (idx >= 0 && idx < slides.length) {
      setCurrentSlideIndex(idx);
      setProgress(0);
      handleUserActivity();
    }
  };

  const handleTogglePause = (e) => {
    e?.stopPropagation?.();
    const nextState = !isPaused;
    setIsPaused(nextState);
    fetch(apiUrl(nextState ? '/api/display/pause' : '/api/display/continue'), {
      method: 'POST'
    }).catch(() => {});
    handleUserActivity();
  };

  const handleToggleSleep = (e) => {
    e?.stopPropagation?.();
    if (isEffectiveSleep) {
      setManualWakeOverride(true);
      setManualSleepOverride(false);
      fetch(apiUrl('/api/display/schedule'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_scheduled_sleep: false })
      }).catch(() => {});
    } else {
      setManualSleepOverride(true);
      setManualWakeOverride(false);
      fetch(apiUrl('/api/display/schedule'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_scheduled_sleep: true })
      }).catch(() => {});
    }
    handleUserActivity();
  };

  // Fullscreen toggle (F key, double-click, or HUD button)
  const toggleFullscreen = (e) => {
    e?.stopPropagation?.();
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
    handleUserActivity();
  };

  // Keyboard navigation shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      handleUserActivity();
      if (e.key === 'f' || e.key === 'F') {
        toggleFullscreen();
      } else if (e.key === 'ArrowRight' || e.key === 'PageDown') {
        if (slides.length > 0) {
          setCurrentSlideIndex((prev) => (prev + 1) % slides.length);
          setProgress(0);
        }
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        if (slides.length > 0) {
          setCurrentSlideIndex((prev) => (prev - 1 + slides.length) % slides.length);
          setProgress(0);
        }
      } else if (e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        handleTogglePause();
      } else if (e.key === 's' || e.key === 'S') {
        handleToggleSleep();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [slides.length, isPaused, isEffectiveSleep]);

  const isVideo = displayState?.media_type === 'video';
  const hasContent = isVideo ? Boolean(displayState?.media_url) : slides.length > 0;

  // Format current time for the sleep ambient clock
  const timeFormatted = currentTime.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  });
  const dateFormatted = currentTime.toLocaleDateString([], {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  return (
    <div
      className={`display-viewport ${isFullscreen ? 'is-fullscreen' : ''} ${showControls ? 'show-controls' : ''}`}
      onMouseMove={handleUserActivity}
      onTouchStart={handleUserActivity}
      onDoubleClick={toggleFullscreen}
    >
      <div className="display-stage">
        {/* 1. Office Night Standby Screen (7:00 PM to 6:00 AM) */}
        {isEffectiveSleep ? (
          <div className="display-standby-screen">
            <div className="standby-content">
              <div className="standby-logo-box">
                <img src="/lph-logo.png" alt="LPH Luxury Properties Hub" className="standby-logo" />
              </div>

              <div className="standby-badge">
                <Moon size={16} className="standby-moon-icon" />
                <span>OFFICE STANDBY MODE • 7:00 PM – 6:00 AM</span>
              </div>

              <div className="standby-clock">{timeFormatted}</div>
              <div className="standby-date">{dateFormatted}</div>

              <div className="standby-schedule-info">
                <div className="standby-info-pill">
                  <Sparkles size={14} color="var(--accent-gold)" />
                  <span>
                    Resuming playback tomorrow at{' '}
                    <strong>{displayState?.schedule_start_time || '06:00 AM'}</strong> from{' '}
                    <strong>
                      {isVideo
                        ? 'Video Loop'
                        : `Slide ${currentSlideIndex + 1} of ${slides.length || 1}`}
                    </strong>
                  </span>
                </div>
                <div className="standby-subtext">
                  Neon serverless database & Render compute are in scale-to-zero eco sleep.
                </div>
              </div>

              <div className="standby-actions">
                <button
                  type="button"
                  className="btn-standby-wake"
                  onClick={() => {
                    setManualWakeOverride(true);
                    setManualSleepOverride(false);
                    fetch(apiUrl('/api/display/schedule'), {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ is_scheduled_sleep: false })
                    }).catch(() => {});
                  }}
                >
                  <Sun size={18} />
                  <span>WAKE SCREEN / MANUAL OVERRIDE</span>
                </button>
                <button
                  type="button"
                  className="btn-standby-fs"
                  onClick={toggleFullscreen}
                >
                  {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                  <span>{isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}</span>
                </button>
              </div>
            </div>
          </div>
        ) : !hasContent ? (
          /* 2. Empty State Awaiting Presentation */
          <div className="display-empty-state">
            <img src="/lph-logo.png" alt="LPH Luxury Properties Hub" className="empty-logo-img" />
            <div className="empty-help">
              Awaiting Presentation or Video. Open <strong>/admin</strong> to upload and publish.
            </div>
          </div>
        ) : isVideo ? (
          /* 3. Native 4K Video Playback */
          <video
            ref={videoRef}
            key={displayState.media_url}
            src={assetUrl(displayState.media_url)}
            className="video-layer"
            autoPlay
            muted
            loop
            playsInline
            onLoadedMetadata={(e) => {
              if (!isPausedRef.current && !isEffectiveSleep) {
                e.target.play().catch(() => {});
              }
            }}
            onCanPlay={(e) => {
              if (!isPausedRef.current && !isEffectiveSleep) {
                e.target.play().catch(() => {});
              }
            }}
            onError={(e) => {
              console.warn('Video element error:', e);
              if (!e.target.dataset.cloudFallback && !e.target.src.includes('onrender.com') && displayState?.media_url) {
                e.target.dataset.cloudFallback = '1';
                const cleanPath = displayState.media_url.startsWith('/') ? displayState.media_url : `/${displayState.media_url}`;
                e.target.src = `${CLOUD_BACKEND_URL}${cleanPath}`;
                e.target.load();
                e.target.play().catch(() => {});
              }
            }}
          />
        ) : (
          /* 4. Dynamic Presentation Slides */
          <>
            {slides.map((slide, idx) => (
              <img
                key={slide.id || idx}
                src={slide.blobUrl || assetUrl(slide.image_path)}
                alt=""
                className={`slide-layer ${idx === currentSlideIndex ? 'active' : ''}`}
                loading={idx <= 1 ? 'eager' : 'lazy'}
                onError={(e) => {
                  if (slide.blobUrl && e.target.src !== slide.blobUrl) {
                    e.target.src = slide.blobUrl;
                  } else if (!e.target.dataset.cloudFallback && !e.target.src.includes('onrender.com')) {
                    e.target.dataset.cloudFallback = '1';
                    const cleanPath = slide.image_path.startsWith('/') ? slide.image_path : `/${slide.image_path}`;
                    e.target.src = `${CLOUD_BACKEND_URL}${cleanPath}`;
                  } else if (!e.target.dataset.retried) {
                    e.target.dataset.retried = '1';
                    setTimeout(() => {
                      const sep = slide.image_path.includes('?') ? '&' : '?';
                      e.target.src = assetUrl(slide.image_path) + sep + '_retry=' + Date.now();
                    }, 1500);
                  }
                }}
              />
            ))}

            {/* Bottom Slide Progress Line */}
            {slides.length > 1 && !isPaused && !isEffectiveSleep && (
              <div className="slide-progress-bar" style={{ width: `${progress}%` }} />
            )}
          </>
        )}

        {/* 5. Floating "On-The-Fly" Slide Show Controls HUD */}
        {!isEffectiveSleep && hasContent && (
          <div className={`display-controls-hud ${showControls ? 'visible' : ''}`}>
            <button
              type="button"
              className="hud-btn"
              onClick={handlePrevSlide}
              title="Previous Slide (Left Arrow)"
              disabled={slides.length <= 1}
            >
              <ChevronLeft size={18} />
              <span className="hud-btn-label">Prev</span>
            </button>

            <button
              type="button"
              className={`hud-btn hud-play-pause ${isPaused ? 'is-paused' : ''}`}
              onClick={handleTogglePause}
              title={isPaused ? 'Resume Slideshow (Space)' : 'Pause Slideshow (Space)'}
            >
              {isPaused ? <Play size={18} /> : <Pause size={18} />}
              <span className="hud-btn-label">{isPaused ? 'Play' : 'Pause'}</span>
            </button>

            <button
              type="button"
              className="hud-btn"
              onClick={handleNextSlide}
              title="Next Slide (Right Arrow)"
              disabled={slides.length <= 1}
            >
              <span className="hud-btn-label">Next</span>
              <ChevronRight size={18} />
            </button>

            {/* On-the-fly Slide Pill Switcher */}
            {!isVideo && slides.length > 1 && (
              <>
                <div className="hud-divider" />
                <div className="hud-slide-picker">
                  {slides.map((s, idx) => (
                    <button
                      key={s.id || idx}
                      type="button"
                      className={`hud-slide-pill ${idx === currentSlideIndex ? 'active' : ''}`}
                      onClick={(e) => handleJumpToSlide(idx, e)}
                      title={`Jump to Slide ${idx + 1} on the fly`}
                    >
                      {idx + 1}
                    </button>
                  ))}
                </div>
              </>
            )}

            <div className="hud-divider" />

            <button
              type="button"
              className="hud-btn hud-sleep-btn"
              onClick={handleToggleSleep}
              title="Put into Night Standby / Power Save (S)"
            >
              <Moon size={16} />
              <span className="hud-btn-label">Sleep</span>
            </button>

            <button
              type="button"
              className="hud-btn"
              onClick={toggleFullscreen}
              title="Toggle Fullscreen (F)"
            >
              {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </button>
          </div>
        )}

        {/* 6. Live Signage Status Badge - hidden in fullscreen */}
        {!isFullscreen && !isEffectiveSleep && (
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
