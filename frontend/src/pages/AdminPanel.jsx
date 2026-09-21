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
  FileText
} from 'lucide-react';
import './AdminPanel.css';

export default function AdminPanel() {
  const [displayState, setDisplayState] = useState(null);
  const [presentations, setPresentations] = useState([]);
  const [selectedPresentation, setSelectedPresentation] = useState(null);
  const [selectedSlides, setSelectedSlides] = useState([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadFeedback, setUploadFeedback] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const fileInputRef = useRef(null);

  // Fetch display state
  const loadDisplayState = async () => {
    try {
      const res = await fetch('/api/display/current');
      if (res.ok) {
        const data = await res.json();
        setDisplayState(data);
      }
    } catch (err) {
      console.error('Failed to load display state:', err);
    }
  };

  // Fetch all presentations
  const loadPresentations = async () => {
    try {
      const res = await fetch('/api/presentations');
      if (res.ok) {
        const data = await res.json();
        setPresentations(data.presentations || []);

        if (data.presentations && data.presentations.length > 0) {
          const active = data.presentations.find((p) => p.is_active);
          const target = active || data.presentations[0];
          loadPresentationDetails(target.id);
        }
      }
    } catch (err) {
      console.error('Failed to load presentations:', err);
    }
  };

  // Fetch specific presentation details
  const loadPresentationDetails = async (id) => {
    try {
      const res = await fetch(`/api/presentations/${id}`);
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

    const eventSource = new EventSource('/api/display/stream');

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

    return () => {
      eventSource.close();
    };
  }, []);

  // Handle Multi-Format Upload (PDF, PPTX, MP4)
  const handleFileUpload = async (file) => {
    if (!file) return;

    const ext = file.name.split('.').pop().toLowerCase();
    if (!['pdf', 'pptx', 'mp4'].includes(ext)) {
      setUploadFeedback({
        type: 'error',
        message: 'Unsupported format. Please select a PDF, PPTX, or MP4 file.'
      });
      return;
    }

    setIsUploading(true);
    setUploadFeedback({
      type: 'loading',
      message: `Ingesting ${ext.toUpperCase()} export and processing media pipeline...`
    });

    const formData = new FormData();
    formData.append('presentation', file);
    formData.append('title', file.name.replace(/\.[^/.]+$/, ''));

    try {
      const res = await fetch('/api/presentations/upload', {
        method: 'POST',
        body: formData
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');

      const pres = data.presentation;
      const detailMsg =
        pres.media_type === 'video'
          ? `Detected ${pres.duration}s MP4 Video.`
          : `Detected ${pres.page_count} dynamic slides.`;

      setUploadFeedback({
        type: 'success',
        message: `✅ Successfully processed ${pres.original_format}! ${detailMsg}`
      });

      await loadPresentations();
      await loadPresentationDetails(pres.id);
    } catch (err) {
      setUploadFeedback({
        type: 'error',
        message: `❌ Upload error: ${err.message}`
      });
    } finally {
      setIsUploading(false);
    }
  };

  // Operator Action: Publish
  const handlePublish = async (presentationId) => {
    setIsProcessing(true);
    try {
      const res = await fetch('/api/display/publish', {
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
      const res = await fetch('/api/display/pause', { method: 'POST' });
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
      const res = await fetch('/api/display/continue', { method: 'POST' });
      if (!res.ok) throw new Error('Continue failed');
      await loadDisplayState();
    } catch (err) {
      alert(`Continue error: ${err.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const isPaused = Boolean(displayState?.state?.is_paused);
  const activeTitle = displayState?.state?.active_title || 'None';
  const activeFormat = displayState?.state?.original_format || 'PDF';
  const activeMediaType = displayState?.state?.media_type || 'presentation';
  const activeSlidesCount = displayState?.state?.page_count || 0;
  const connectedDisplays = displayState?.connected_displays || 0;

  return (
    <div className="admin-container">
      {/* Header */}
      <header className="admin-header">
        <div>
          <h1 className="brand-title">LPH LUXURY PROPERTIES HUB</h1>
          <p className="brand-sub">Commercial Display Operations • LG 98TR3DK-BM</p>
        </div>
        <div className="header-actions">
          <a href="/display" target="_blank" rel="noreferrer" className="display-link-btn">
            <Tv size={18} />
            <span>Open LG Display Player</span>
            <ExternalLink size={14} />
          </a>
        </div>
      </header>

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
            accept=".pdf,.pptx,.mp4"
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
            <span className="format-tag">PDF Presentation</span>
            <span className="format-tag">PowerPoint (PPTX)</span>
            <span className="format-tag">MP4 Video</span>
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
                  src={selectedPresentation.media_url}
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
                      src={slide.image_path}
                      alt={`Slide ${slide.slide_index}`}
                      className="slide-thumbnail-img"
                      loading="lazy"
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
