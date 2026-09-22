import React, { useState, useEffect, useRef } from 'react';
import {
  UploadCloud,
  Play,
  Pause,
  Tv,
  CheckCircle,
  AlertCircle,
  Clock,
  Layers,
  ExternalLink,
  RefreshCw,
  Video,
  FileText,
  Radio,
  Settings,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import './AdminPanel.css';
import { apiUrl, assetUrl, getApiBaseUrl, setApiBaseUrl } from '../config/api';

export default function AdminPanel() {
  const [displayState, setDisplayState] = useState(null);
  const [presentations, setPresentations] = useState([]);
  const [selectedPresentation, setSelectedPresentation] = useState(null);
  const [selectedSlides, setSelectedSlides] = useState([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadFeedback, setUploadFeedback] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [backendStatus, setBackendStatus] = useState('checking');
  const [backendUrl, setBackendUrlState] = useState(getApiBaseUrl());
  const [showBackendConfig, setShowBackendConfig] = useState(false);
  const [customUrlInput, setCustomUrlInput] = useState(getApiBaseUrl());

  const fileInputRef = useRef(null);
  const [scrollY, setScrollY] = useState(0);

  // Track window scroll position to toggle floating scroll button
  useEffect(() => {
    const handleScroll = () => {
      setScrollY(window.scrollY || document.documentElement.scrollTop);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const scrollToBottom = () => {
    window.scrollTo({
      top: document.documentElement.scrollHeight,
      behavior: 'smooth'
    });
  };

  const scrollToTop = () => {
    window.scrollTo({
      top: 0,
      behavior: 'smooth'
    });
  };

  // Fetch display state
  const loadDisplayState = async () => {
    try {
      const res = await fetch(apiUrl('/api/display/current'));
      if (res.ok) {
        const data = await res.json();
        setDisplayState(data);
        setBackendStatus('connected');
      } else {
        setBackendStatus('error');
      }
    } catch (err) {
      console.error('Failed to load display state:', err);
      setBackendStatus('error');
    }
  };

  // Fetch all presentations
  const loadPresentations = async () => {
    try {
      const res = await fetch(apiUrl('/api/presentations'));
      if (res.ok) {
        const data = await res.json();
        setPresentations(data.presentations || []);

        if (data.presentations && data.presentations.length > 0) {
          const active = data.presentations.find((p) => p.is_active);
          const target = active || data.presentations[0];
          loadPresentationDetails(target.id);
        } else {
          setSelectedPresentation(null);
          setSelectedSlides([]);
        }
      }
    } catch (err) {
      console.error('Failed to load presentations:', err);
    }
  };

  // Fetch specific presentation details
  const loadPresentationDetails = async (id) => {
    try {
      const res = await fetch(apiUrl(`/api/presentations/${id}`));
      if (res.ok) {
        const data = await res.json();
        setSelectedPresentation(data.presentation);
        setSelectedSlides(data.slides || []);
      }
    } catch (err) {
      console.error('Failed to load presentation details:', err);
    }
  };

  useEffect(() => {
    loadDisplayState();
    loadPresentations();

    // Auto-sync polling every 3 seconds to guarantee operator panel is always live
    const syncInterval = setInterval(() => {
      loadDisplayState();
    }, 3000);

    let eventSource = null;
    try {
      eventSource = new EventSource(apiUrl('/api/display/stream'));

      eventSource.addEventListener('INIT_STATE', (e) => {
        try {
          const data = JSON.parse(e.data);
          setDisplayState(data);
        } catch (err) {
          console.error(err);
        }
      });

      eventSource.addEventListener('PRESENTATION_PUBLISHED', (e) => {
        try {
          const data = JSON.parse(e.data);
          setDisplayState(data);
          loadPresentations();
        } catch (err) {
          console.error(err);
        }
      });

      eventSource.addEventListener('DISPLAY_STATE_CHANGED', (e) => {
        try {
          const data = JSON.parse(e.data);
          setDisplayState(data);
        } catch (err) {
          console.error(err);
        }
      });
    } catch (err) {
      console.warn('SSE connection error:', err);
    }

    return () => {
      clearInterval(syncInterval);
      if (eventSource) eventSource.close();
    };
  }, []);

  // Handle Multi-Format Upload (PDF, PPTX, MP4, MOV, WebM)
  const handleFileUpload = async (file) => {
    if (!file) return;

    const ext = file.name.split('.').pop().toLowerCase();
    const allowed = ['pdf', 'pptx', 'mp4', 'mov', 'webm', 'm4v'];
    if (!allowed.includes(ext)) {
      setUploadFeedback({
        type: 'error',
        message: `Unsupported file format (.${ext}). Supported formats are PDF, PPTX, MP4, MOV, and WebM.`
      });
      return;
    }

    // Cloud hosting request body limit protection (Render / Cloudflare 100MB limit)
    const MAX_CLOUD_SIZE_MB = 100;
    if (file.size > MAX_CLOUD_SIZE_MB * 1024 * 1024) {
      const fileSizeMB = (file.size / (1024 * 1024)).toFixed(1);
      setUploadFeedback({
        type: 'error',
        message: `File size (${fileSizeMB} MB) exceeds the 100 MB cloud transfer limit. In Canva, export as "PDF Standard" (usually <10 MB) or choose 1080p MP4 to ensure instant 4K upload!`
      });
      return;
    }

    setIsUploading(true);
    setUploadFeedback({
      type: 'loading',
      message: `Uploading & processing ${ext.toUpperCase()} media...`
    });

    const formData = new FormData();
    formData.append('presentation', file);
    formData.append('title', file.name.replace(/\.[^/.]+$/, ''));

    try {
      const res = await fetch(apiUrl('/api/presentations/upload'), {
        method: 'POST',
        body: formData
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');

      const pres = data.presentation;
      const detailMsg =
        pres.media_type === 'video'
          ? `Detected ${pres.duration}s ${pres.original_format} Video.`
          : `Detected ${pres.page_count} dynamic slides.`;

      setUploadFeedback({
        type: 'success',
        message: `✅ Successfully processed ${pres.original_format}! ${detailMsg}`
      });

      await loadPresentations();
      await loadPresentationDetails(pres.id);
    } catch (err) {
      let msg = err.message || 'Upload failed';
      if (msg.includes('Failed to fetch')) {
        msg = 'Connection reset during upload. The cloud server may have been restarting or the video took too long to transfer. Please retry now, or export from Canva as "PDF Standard" for instant 1-second processing!';
      }
      setUploadFeedback({
        type: 'error',
        message: `❌ Upload error: ${msg}`
      });
    } finally {
      setIsUploading(false);
    }
  };

  // Operator Action: Publish
  const handlePublish = async (presentationId) => {
    setIsProcessing(true);
    try {
      const res = await fetch(apiUrl('/api/display/publish'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ presentation_id: presentationId })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Publish failed');

      await loadDisplayState();
      await loadPresentations();
      setUploadFeedback({
        type: 'success',
        message: '🚀 Content published! LG 98" display updated automatically.'
      });
    } catch (err) {
      alert(`Publish error: ${err.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  // Operator Action: Pause
  const handlePause = async () => {
    setIsProcessing(true);
    try {
      const res = await fetch(apiUrl('/api/display/pause'), { method: 'POST' });
      if (!res.ok) throw new Error('Pause failed');
      await loadDisplayState();
    } catch (err) {
      alert(`Pause error: ${err.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  // Operator Action: Continue
  const handleContinue = async () => {
    setIsProcessing(true);
    try {
      const res = await fetch(apiUrl('/api/display/continue'), { method: 'POST' });
      if (!res.ok) throw new Error('Continue failed');
      await loadDisplayState();
    } catch (err) {
      alert(`Continue error: ${err.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSaveBackendUrl = () => {
    setApiBaseUrl(customUrlInput);
    setBackendUrlState(customUrlInput);
    setShowBackendConfig(false);
    setBackendStatus('checking');
    setTimeout(() => {
      loadDisplayState();
      loadPresentations();
    }, 200);
  };

  const handleSetInterval = async (seconds) => {
    try {
      const res = await fetch(apiUrl('/api/display/interval'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rotation_interval: seconds })
      });
      if (res.ok) {
        await loadDisplayState();
      }
    } catch (err) {
      console.error('Failed to update interval:', err);
    }
  };

  const isPaused = Boolean(displayState?.state?.is_paused);
  const currentInterval = displayState?.state?.rotation_interval || 10;
  const activeTitle = displayState?.state?.active_title || 'None';
  const activeFormat = displayState?.state?.original_format || 'PDF';
  const activeMediaType = displayState?.state?.media_type || 'presentation';
  const activeSlidesCount = displayState?.state?.page_count || 0;
  const connectedDisplays = displayState?.connected_displays || 0;

  return (
    <div className="admin-container">
      {/* Header */}
      <header className="admin-header">
        <div className="admin-header-brand">
          <img src="/lph-logo.png" alt="LPH Logo" className="admin-header-logo" />
          <div>
            <h1 className="brand-title">LPH LUXURY PROPERTIES HUB</h1>
            <p className="brand-sub">Commercial Display Operations • LG 98TR3DK-BM</p>
          </div>
        </div>
        <div className="header-actions">
          {/* Backend Connection Status Badge & Settings */}
          <button
            className={`backend-status-pill ${backendStatus}`}
            onClick={() => setShowBackendConfig(!showBackendConfig)}
            title="Click to configure backend API URL"
          >
            <Radio size={14} className={backendStatus === 'connected' ? 'pulse' : ''} />
            <span>
              {backendStatus === 'connected'
                ? 'Backend: Live'
                : backendStatus === 'error'
                ? 'Backend: Offline'
                : 'Connecting...'}
            </span>
            <Settings size={14} style={{ opacity: 0.7 }} />
          </button>

          <button
            type="button"
            className="display-link-btn"
            style={{ cursor: 'pointer' }}
            onClick={scrollToBottom}
            title="Scroll down to Uploads & Presentation Previews"
          >
            <ChevronDown size={18} />
            <span>Scroll to Uploads & Slides</span>
          </button>

          <a href="/display" target="_blank" rel="noreferrer" className="display-link-btn">
            <Tv size={18} />
            <span>Open LG Display Player</span>
            <ExternalLink size={14} />
          </a>
        </div>
      </header>

      {/* Backend URL Configuration Modal / Dropdown */}
      {showBackendConfig && (
        <div className="backend-config-box">
          <div className="backend-config-header">
            <strong>Backend Connection Settings</strong>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              Connected to Cloudflare Tunnel or local server
            </span>
          </div>
          <div className="backend-config-row">
            <input
              type="text"
              value={customUrlInput}
              onChange={(e) => setCustomUrlInput(e.target.value)}
              placeholder="e.g. https://xxx.trycloudflare.com or leave empty for local proxy"
              className="backend-config-input"
            />
            <button className="btn-primary" onClick={handleSaveBackendUrl}>
              Save & Reconnect
            </button>
          </div>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '6px' }}>
            Current Target: <code>{backendUrl || '(local proxy / relative)'}</code>
          </div>
        </div>
      )}

      {/* Operator Control & System Status Bar */}
      <div className="operator-bar">
        {/* Manual Pause / Continue Operator Card */}
        <div className="control-card">
          <div className="card-label">Operator Display Controls</div>
          <div className="status-row">
            <div>
              <span style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>
                Automation Status:{' '}
              </span>
              <span className={`status-badge ${isPaused ? 'paused' : 'running'}`}>
                {isPaused ? '🟡 PAUSED' : '🟢 RUNNING'}
              </span>
            </div>
            <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
              {isPaused ? 'Display frozen on current view' : 'Active presentation/video playing'}
            </div>
          </div>

          <div className="operator-buttons">
            <button
              className="btn-operator btn-pause"
              onClick={handlePause}
              disabled={isPaused || isProcessing}
            >
              <Pause size={18} />
              <span>PAUSE DISPLAY</span>
            </button>
            <button
              className="btn-operator btn-continue"
              onClick={handleContinue}
              disabled={!isPaused || isProcessing}
            >
              <Play size={18} />
              <span>CONTINUE ROTATION</span>
            </button>
          </div>

          {/* Slide Rotation Interval / Scenario Speed Selector */}
          <div style={{ marginTop: '16px', paddingTop: '14px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                Slide Rotation Speed:
              </span>
              <span style={{ fontSize: '13px', fontWeight: '600', color: 'var(--accent-gold)' }}>
                {currentInterval} seconds / slide
              </span>
            </div>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {[5, 8, 10, 15, 20, 30].map((sec) => (
                <button
                  key={sec}
                  onClick={() => handleSetInterval(sec)}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '6px',
                    fontSize: '12px',
                    fontWeight: currentInterval === sec ? '700' : '400',
                    background: currentInterval === sec ? 'var(--accent-gold)' : '#1e1d1b',
                    color: currentInterval === sec ? '#000' : '#d1cfca',
                    border: '1px solid rgba(255,255,255,0.1)',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                >
                  {sec}s
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Live Display Telemetry Card */}
        <div className="control-card">
          <div className="card-label">Display Telemetry</div>
          <div className="stats-grid">
            <div className="stat-box">
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Active Presentation</div>
              <div className="stat-value" style={{ fontSize: '15px' }}>
                {activeTitle}
              </div>
            </div>
            <div className="stat-box">
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Format & Media</div>
              <div className="stat-value" style={{ fontSize: '15px' }}>
                {activeFormat} ({activeMediaType === 'video' ? 'Video Loop' : `${activeSlidesCount} Slides`})
              </div>
            </div>
            <div className="stat-box">
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Connected Screens</div>
              <div className="stat-value" style={{ color: '#4ade80' }}>
                {connectedDisplays} Display{connectedDisplays === 1 ? '' : 's'}
              </div>
            </div>
            <div className="stat-box">
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Signage Mode</div>
              <div className="stat-value" style={{ fontSize: '15px' }}>
                {activeMediaType === 'video' ? 'Native Video' : '10s Slideshow'}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Upload Presentation or Video Card */}
      <div className="upload-card">
        <div className="card-label">Upload Presentation or Video</div>
        <div
          className={`dropzone ${isUploading ? 'active' : ''}`}
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (e.dataTransfer.files && e.dataTransfer.files[0]) {
              handleFileUpload(e.dataTransfer.files[0]);
            }
          }}
        >
          <input
            type="file"
            ref={fileInputRef}
            style={{ display: 'none' }}
            accept=".pdf,.pptx,.mp4,.mov,.webm,.m4v"
            onChange={(e) => {
              if (e.target.files && e.target.files[0]) {
                handleFileUpload(e.target.files[0]);
              }
            }}
          />
          <UploadCloud size={48} className="dropzone-icon" />
          <h2 className="dropzone-title">Upload Presentation or Video</h2>
          <p className="dropzone-hint">
            Drag & drop your exported Canva presentation or video here, or click to browse.
          </p>
          <div className="format-tags">
            <span className="format-tag" style={{ background: 'rgba(197, 168, 128, 0.2)', borderColor: 'var(--accent-gold)', color: 'var(--accent-gold)' }}>
              ⭐ PDF Presentation (Instant 1s Processing)
            </span>
            <span className="format-tag">MP4 / MOV Video</span>
            <span className="format-tag">PowerPoint (PPTX)</span>
          </div>
        </div>

        {uploadFeedback && (
          <div className={`upload-feedback ${uploadFeedback.type}`}>
            {uploadFeedback.type === 'loading' && <RefreshCw size={18} className="spin" />}
            {uploadFeedback.type === 'success' && <CheckCircle size={18} />}
            {uploadFeedback.type === 'error' && <AlertCircle size={18} />}
            <span>{uploadFeedback.message}</span>
          </div>
        )}
      </div>

      {/* Selected Presentation Details & Previews */}
      {selectedPresentation && (
        <div className="presentations-section">
          <div className="section-title">
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span>Preview: {selectedPresentation.title}</span>
              <span className={`format-pill ${selectedPresentation.original_format.toLowerCase()}`}>
                {selectedPresentation.original_format}
              </span>
            </div>
            <button
              className="btn-publish"
              onClick={() => handlePublish(selectedPresentation.id)}
              disabled={isProcessing}
            >
              <Play size={18} />
              <span>PUBLISH TO LG DISPLAY</span>
            </button>
          </div>

          <div className="presentation-card active-pres">
            <div className="pres-header">
              <div className="pres-title">
                <span>{selectedPresentation.title}</span>
                {selectedPresentation.is_active && <span className="active-pill">● Published Live</span>}
              </div>
              <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                {selectedPresentation.media_type === 'video'
                  ? `Duration: ${selectedPresentation.duration}s • 1080p`
                  : `${selectedSlides.length} Dynamic Slides`}
              </div>
            </div>

            {/* If MP4 Video: render video player preview */}
            {selectedPresentation.media_type === 'video' ? (
              <div className="video-preview-wrapper">
                <video
                  src={assetUrl(selectedPresentation.media_url)}
                  className="admin-video-player"
                  controls
                  autoPlay
                  muted
                  loop
                />
              </div>
            ) : (
              /* If PDF or PPTX: render slide grid preview */
              <div className="slide-grid">
                {selectedSlides.map((slide) => (
                  <div key={slide.id} className="slide-thumbnail-box">
                    <span className="slide-number-badge">Slide {slide.slide_index}</span>
                    <img
                      src={assetUrl(slide.image_path)}
                      alt=""
                      className="slide-thumbnail-img"
                      loading="lazy"
                      onError={(e) => {
                        e.target.style.opacity = '0';
                      }}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Floating Quick Scroll Button */}
      <button
        type="button"
        className="floating-scroll-btn"
        onClick={scrollY > 200 ? scrollToTop : scrollToBottom}
        title={scrollY > 200 ? 'Scroll to Top' : 'Scroll down to Upload & Slides'}
      >
        {scrollY > 200 ? (
          <>
            <ChevronUp size={18} />
            <span>SCROLL TO TOP</span>
          </>
        ) : (
          <>
            <ChevronDown size={18} />
            <span>SCROLL TO CONTENT</span>
          </>
        )}
      </button>
    </div>
  );
}
