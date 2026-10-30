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
import { saveSlideBlob, getSlideBlob, pruneSlideBlobs, saveSignageMeta, getSignageMeta } from '../utils/offlineCache';

// Vercel's /uploads rewrite to Easypanel intermittently fails: some requests hang ~30s and then
// return 502 ROUTER_EXTERNAL_TARGET_CONNECTION_ERROR, which left slides blank on the screen.
// Never wait on a single path — time-box it and fall back to the backend directly.
const VERCEL_FETCH_TIMEOUT_MS = 4000;
const DIRECT_FETCH_TIMEOUT_MS = 25000;
const IMG_WATCHDOG_MS = 3000;

function directAssetUrl(path) {
  if (!path) return '';
  if (/^(https?:|data:|blob:)/.test(path)) return path;
  return `${CLOUD_BACKEND_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

async function fetchBlobWithTimeout(url, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    if (!blob.type.startsWith('image/')) throw new Error(`Unexpected content type ${blob.type}`);
    return blob;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchSlideBlob(path) {
  const viaVercel = assetUrl(path);
  const direct = directAssetUrl(path);
  try {
    return await fetchBlobWithTimeout(viaVercel, VERCEL_FETCH_TIMEOUT_MS);
  } catch (err) {
    if (direct === viaVercel) throw err;
    return await fetchBlobWithTimeout(direct, DIRECT_FETCH_TIMEOUT_MS);
  }
}

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

  // Last slide whose image actually painted. It stays visible underneath the active slide until
  // the active image has loaded, so a slow image never shows as a black sheet.
  const [shownSlideIndex, setShownSlideIndex] = useState(currentSlideIndex);
  const slideImgRefs = useRef({});

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

  // Auto-reload when a new frontend build is deployed (unattended sales-floor screen)
  useEffect(() => {
    const current = document.querySelector('script[type="module"][src*="/assets/"]')?.getAttribute('src');
    if (!current) return; // dev server: no hashed bundle
    const id = setInterval(async () => {
      try {
        const html = await (await fetch('/', { cache: 'no-store' })).text();
        const latest = html.match(/src="(\/assets\/[^"]+\.js)"/)?.[1];
        if (latest && latest !== current) window.location.reload();
      } catch {}
    }, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

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

  // Hydrate slide list with offline IndexedDB Blobs progressively without choking bandwidth
  const hydrateSlidesWithBlobs = async (slideList, activeIdx = 0) => {
    if (!Array.isArray(slideList) || slideList.length === 0) return slideList;

    // 1. Immediately attach any already-cached blobs from IndexedDB
    const result = await Promise.all(
      slideList.map(async (slide) => {
        const key = `slide_${slide.id}`;
        const blob = await getSlideBlob(key);
        return {
          ...slide,
          blobUrl: blob ? URL.createObjectURL(blob) : null
        };
      })
    );

    // 2. Prioritize background caching in play order: active slide, then the ones coming up next
    const n = slideList.length;
    const start = n > 0 ? activeIdx % n : 0;
    const queue = Array.from({ length: n }, (_, i) => (start + i) % n);

    // Background progressive cache worker (gentle sequential downloads).
    // Each fetch is time-boxed with a direct-backend fallback, and slides that still fail are
    // retried in later passes so the whole deck ends up in IndexedDB instead of staying blank.
    (async () => {
      let pending = queue;
      for (let pass = 0; pass < 4 && pending.length > 0; pass++) {
        if (pass > 0) await new Promise((r) => setTimeout(r, 5000 * pass));
        const failed = [];
        for (const idx of pending) {
          const slide = slideList[idx];
          if (!slide || !slide.image_path) continue;
          const key = `slide_${slide.id}`;
          try {
            // Another hydration run may already have cached it — still attach it to the
            // current slide list, otherwise this slide keeps loading over the network.
            let blob = await getSlideBlob(key);
            if (!blob) {
              blob = await fetchSlideBlob(slide.image_path);
              await saveSlideBlob(key, blob);
              await new Promise((r) => setTimeout(r, 150));
            }
            const current = slidesRef.current[idx];
            if (current && current.id === slide.id && !current.blobUrl) {
              const blobUrl = URL.createObjectURL(blob);
              setSlides((prev) =>
                prev.map((s, i) => (i === idx && s.id === slide.id && !s.blobUrl ? { ...s, blobUrl } : s))
              );
            }
          } catch {
            failed.push(idx);
          }
        }
        pending = failed;
      }

      // Drop blobs of older decks so the screen's storage doesn't grow with every Canva sync.
      const liveIds = slidesRef.current.map((s) => s.id);
      const isStillCurrent =
        liveIds.length === slideList.length && slideList.every((s, i) => s.id === liveIds[i]);
      if (isStillCurrent && pending.length === 0) {
        pruneSlideBlobs(slideList.map((s) => `slide_${s.id}`));
      }
    })();

    return result;
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

        hydrateSlidesWithBlobs(payload.slides, isNewPres ? 0 : (currentSlideIndexRef.current || 0))
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
        const hydrated = await hydrateSlidesWithBlobs(cachedMetaSlides, currentSlideIndexRef.current || 0);
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

  // If the new active slide was already preloaded (or comes from the offline cache), it is
  // painted straight away and no load event will fire again — mark it as shown here.
  useEffect(() => {
    const el = slideImgRefs.current[currentSlideIndex];
    if (el && el.complete && el.naturalWidth > 0) setShownSlideIndex(currentSlideIndex);
  }, [currentSlideIndex, slides]);

  // Watchdog: if a mounted slide image still hasn't loaded after a few seconds, the Vercel rewrite
  // is probably hanging — point that <img> straight at the backend instead of waiting 30s for a 502.
  useEffect(() => {
    if (slides.length === 0) return undefined;
    const timer = setTimeout(() => {
      document.querySelectorAll('img.slide-layer[data-path]').forEach((img) => {
        if (img.complete && img.naturalWidth > 0) return;
        if (img.dataset.cloudFallback || img.src.startsWith('blob:')) return;
        img.dataset.cloudFallback = '1';
        img.src = directAssetUrl(img.dataset.path);
      });
    }, IMG_WATCHDOG_MS);
    return () => clearTimeout(timer);
  }, [currentSlideIndex, slides.length, displayState?.last_published_at]);

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

    const currentSlide = slides[currentSlideIndex];
    const isSlide4 = (currentSlide?.slide_index === 4) || (currentSlideIndex === 3);
    const baseInterval = Math.max(2, rotationInterval || 8);
    const slide4Duration = Number(displayState?.slide_4_duration) || 25;

    // Slide 4 stays for a longer time (25 seconds default), other slides rotate faster at base speed (8-10s)
    const slideDurationSec = (currentSlide && currentSlide.duration)
      ? Number(currentSlide.duration)
      : isSlide4
      ? slide4Duration
      : baseInterval;

    const intervalMs = slideDurationSec * 1000;
    const tickMs = 100;
    let startTime = Date.now();

    const timer = setInterval(() => {
      const now = Date.now();
      const elapsed = now - startTime;
      if (elapsed >= intervalMs) {
        setCurrentSlideIndex((prev) => (prev + 1) % slides.length);
        setProgress(0);
      } else {
        setProgress(Math.min((elapsed / intervalMs) * 100, 100));
      }
    }, tickMs);

    return () => clearInterval(timer);
  }, [slides, currentSlideIndex, rotationInterval, displayState?.slide_4_duration, isPaused, isEffectiveSleep, displayState?.media_type]);

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
        ) : (!hasContent || isPaused) ? (
          /* 2. Paused or Empty / Idle State: Show LPH Brand Cover Sheet (slide_p1.png) */
          <div className="display-main-sheet-view" style={{ width: '100%', height: '100%', position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#000' }}>
            <img
              src="/slide_p1.png"
              alt="LPH Luxury Properties Hub"
              className="slide-layer active"
              style={{ width: '100%', height: '100%', objectFit: 'contain', opacity: 1, zIndex: 10, backgroundColor: '#000' }}
              onError={(e) => {
                if (!e.target.dataset.fallback) {
                  e.target.dataset.fallback = '1';
                  e.target.src = assetUrl('/uploads/slide_p1.png');
                }
              }}
            />
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
            {slides.map((slide, idx) => {
              // Only mount prev/current/next: 30 stacked 1080p layers exhaust TV GPU memory
              // (LG webOS browser then paints just the top tiles, rest black).
              const n = slides.length;
              const d = (idx - currentSlideIndex + n) % n;
              const isActive = idx === currentSlideIndex;
              const isBehind = !isActive && idx === shownSlideIndex;
              if (d > 1 && d !== n - 1 && !isBehind) return null;
              return (
              <img
                key={slide.id || idx}
                ref={(el) => {
                  if (el) slideImgRefs.current[idx] = el;
                  else delete slideImgRefs.current[idx];
                }}
                src={slide.blobUrl || assetUrl(slide.image_path)}
                data-path={slide.image_path}
                alt=""
                className={`slide-layer ${isActive ? 'active' : ''} ${isBehind ? 'behind' : ''}`}
                onLoad={() => {
                  if (idx === currentSlideIndexRef.current) setShownSlideIndex(idx);
                }}
                loading={
                  Math.abs(idx - currentSlideIndex) <= 1 ||
                  (currentSlideIndex === slides.length - 1 && idx === 0) ||
                  idx <= 1
                    ? 'eager'
                    : 'lazy'
                }
                decoding="async"
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
              );
            })}

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
        {!isFullscreen && !isEffectiveSleep && hasContent && !isPaused && (
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
