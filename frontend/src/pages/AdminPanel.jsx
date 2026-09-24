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
  ChevronUp,
  Sparkles,
  Check,
  Copy,
  Sliders,
  Eye,
  ArrowRight,
  Trash2
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

  // Canva Direct Sync State
  const [canvaStatus, setCanvaStatus] = useState(null);
  const [canvaVersions, setCanvaVersions] = useState([]);
  const [isCanvaSyncing, setIsCanvaSyncing] = useState(false);
  const [canvaFeedback, setCanvaFeedback] = useState(null);
  const [showCanvaConfig, setShowCanvaConfig] = useState(false);
  const [showVersionsDrawer, setShowVersionsDrawer] = useState(false);
  const [canvaConfigForm, setCanvaConfigForm] = useState({
    client_id: 'OC-AAdIyAng356N',
    client_secret: '',
    design_id: 'DAHVb9pmJzQ',
    design_title: 'Copy of Dashboard Screen 16/9',
    access_token: '',
    export_format: 'mp4',
    auto_publish: true,
    simulation_mode: false
  });

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

  // Helper: Format timestamps cleanly
  const formatTimestamp = (ts) => {
    if (!ts) return 'Never';
    if (typeof ts === 'string' && /^\d+$/.test(ts)) {
      const num = parseInt(ts, 10);
      const date = new Date(num > 1e11 ? num : num * 1000);
      return date.toLocaleString();
    }
    const date = new Date(ts);
    if (isNaN(date.getTime())) return String(ts);
    return date.toLocaleString();
  };

  // Load Canva connection status and versions
  const loadCanvaStatus = async () => {
    try {
      const [statusRes, versionsRes] = await Promise.all([
        fetch(apiUrl('/api/canva/status')),
        fetch(apiUrl('/api/canva/versions'))
      ]);
      if (statusRes.ok) {
        const data = await statusRes.json();
        setCanvaStatus(data);
        if (data.connection) {
          setCanvaConfigForm((prev) => ({
            ...prev,
            client_id: data.connection.client_id || prev.client_id || 'OC-AAdIyAng356N',
            client_secret: data.connection.client_secret_masked || prev.client_secret || '',
            design_id: data.connection.design_id || 'DAHVb9pmJzQ',
            design_title: data.connection.design_title || 'Copy of Dashboard Screen 16/9',
            export_format: data.connection.export_format || 'mp4',
            auto_publish: data.connection.auto_publish !== false
          }));
        }
      }
      if (versionsRes.ok) {
        const vData = await versionsRes.json();
        setCanvaVersions(vData.versions || []);
      }
    } catch (err) {
      console.error('Failed to load Canva status:', err);
    }
  };

  // Manual Trigger: Sync From Canva
  const handleSyncCanva = async (force = false) => {
    setIsCanvaSyncing(true);
    const chosenFormat = canvaStatus?.connection?.export_format || canvaConfigForm.export_format || 'mp4';
    const isVideo = chosenFormat === 'mp4';
    setCanvaFeedback({
      type: 'loading',
      message: isVideo
        ? 'Connecting to Canva API & rendering 4K MP4 Video...'
        : 'Connecting to Canva API & rasterizing presentation slides...'
    });
    try {
      const res = await fetch(apiUrl('/api/canva/sync'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          design_id: canvaStatus?.connection?.design_id || 'DAHVb9pmJzQ',
          force,
          format: chosenFormat,
          auto_publish: canvaConfigForm.auto_publish !== false
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Canva sync failed');

      if (data.already_up_to_date) {
        setCanvaFeedback({
          type: 'info',
          message: '⚡ Canva design is already up to date. (Canva timestamp matches latest sync).'
        });
      } else {
        const isVideoSync = data.version?.export_format === 'MP4';
        setCanvaFeedback({
          type: 'success',
          message: data.is_published
            ? `🚀 Canva ${isVideoSync ? '4K Video' : 'Slides'} synced & published LIVE to display!`
            : `✅ Synced Canva ${isVideoSync ? '4K Video' : 'Slides'} version ${data.version?.version_label || ''}!`
        });
        if (data.version?.presentation_id) {
          await loadPresentations();
          await loadPresentationDetails(data.version.presentation_id);
          await loadDisplayState();
        }
      }
      await loadCanvaStatus();
    } catch (err) {
      setCanvaFeedback({
        type: 'error',
        message: `❌ Canva sync error: ${err.message}`
      });
    } finally {
      setIsCanvaSyncing(false);
    }
  };

  // Operator Action: Publish Canva Version
  const handlePublishCanvaVersion = async (versionId) => {
    if (!versionId) return;
    setIsProcessing(true);
    try {
      const res = await fetch(apiUrl(`/api/canva/publish/${versionId}`), {
        method: 'POST'
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to publish Canva version');

      setCanvaFeedback({
        type: 'success',
        message: '🚀 Canva version published live to LG 98" Display!'
      });
      await loadCanvaStatus();
      await loadDisplayState();
      await loadPresentations();
    } catch (err) {
      setCanvaFeedback({
        type: 'error',
        message: `Publish error: ${err.message}`
      });
    } finally {
      setIsProcessing(false);
    }
  };

  // Operator Action: Delete Presentation (Purge)
  const handleDeletePresentation = async (id) => {
    if (!window.confirm('Are you sure you want to delete this presentation? This will permanently delete its slides and files from the server.')) {
      return;
    }
    setIsProcessing(true);
    try {
      const res = await fetch(apiUrl(`/api/presentations/${id}`), {
        method: 'DELETE'
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to delete presentation');

      setUploadFeedback({
        type: 'success',
        message: '🗑️ Presentation and media files deleted successfully.'
      });
      await loadPresentations();
      await loadDisplayState();
    } catch (err) {
      setUploadFeedback({
        type: 'error',
        message: `Delete error: ${err.message}`
      });
    } finally {
      setIsProcessing(false);
    }
  };

  // Toggle Auto-Sync
  const handleToggleAutoSync = async (enabled) => {
    try {
      const res = await fetch(apiUrl('/api/canva/auto-sync'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled })
      });
      if (res.ok) {
        await loadCanvaStatus();
      }
    } catch (err) {
      console.error('Failed to toggle auto sync:', err);
    }
  };

  // Change Auto-Sync Interval
  const handleChangeSyncInterval = async (intervalSeconds) => {
    try {
      const res = await fetch(apiUrl('/api/canva/auto-sync'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ interval_seconds: intervalSeconds })
      });
      if (res.ok) {
        await loadCanvaStatus();
      }
    } catch (err) {
      console.error('Failed to update sync interval:', err);
    }
  };

  // Change Canva Export Format (4K Video vs Slides)
  const handleSwitchFormat = async (newFormat) => {
    setCanvaConfigForm((prev) => ({ ...prev, export_format: newFormat }));
    try {
      const res = await fetch(apiUrl('/api/canva/auto-sync'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ export_format: newFormat })
      });
      if (res.ok) {
        await loadCanvaStatus();
      }
    } catch (err) {
      console.error('Failed to update export format:', err);
    }
  };

  // Save Canva Connection Credentials
  const handleSaveCanvaConfig = async () => {
    try {
      const res = await fetch(apiUrl('/api/canva/connect'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(canvaConfigForm)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update Canva connection');
      setShowCanvaConfig(false);
      await loadCanvaStatus();
      setCanvaFeedback({
        type: 'success',
        message: '✅ Canva connection settings saved!'
      });
    } catch (err) {
      alert(`Failed to save Canva config: ${err.message}`);
    }
  };

  // Launch Canva 1-Click OAuth 2.0 PKCE Flow
  const handleStartCanvaOAuth = async () => {
    try {
      setCanvaFeedback({
        type: 'loading',
        message: 'Connecting to Canva OAuth 2.0 authorization server...'
      });
      const isCloud = window.location.hostname.includes('vercel.app');
      const redirectParam = isCloud
        ? encodeURIComponent('https://canvaaa-p0f3.onrender.com/api/canva/callback')
        : '';
      const clientIdParam = canvaConfigForm.client_id
        ? encodeURIComponent(canvaConfigForm.client_id.trim())
        : '';

      const queryParts = [];
      if (redirectParam) queryParts.push(`redirect_uri=${redirectParam}`);
      if (clientIdParam) queryParts.push(`client_id=${clientIdParam}`);

      const endpoint = `/api/canva/auth/start${queryParts.length > 0 ? `?${queryParts.join('&')}` : ''}`;
      const res = await fetch(apiUrl(endpoint));
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to initialize Canva authorization');
      if (data.auth_url) {
        window.location.href = data.auth_url;
      }
    } catch (err) {
      setCanvaFeedback({
        type: 'error',
        message: `Canva OAuth Error: ${err.message}`
      });
    }
  };

  useEffect(() => {
    loadDisplayState();
    loadPresentations();
    loadCanvaStatus();

    // Check if returning from Canva OAuth
    const params = new URLSearchParams(window.location.search);
    if (params.get('canva_connected') === 'true') {
      setCanvaFeedback({
        type: 'success',
        message: '🎉 Canva successfully authorized & connected via official OAuth 2.0!'
      });
      window.history.replaceState({}, document.title, window.location.pathname);
    } else if (params.get('canva_error')) {
      setCanvaFeedback({
        type: 'error',
        message: `Canva Authorization Failed: ${params.get('canva_error')}`
      });
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    // Auto-sync polling every 3 seconds to guarantee operator panel is always live
    const syncInterval = setInterval(() => {
      loadDisplayState();
      loadCanvaStatus();
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
          loadCanvaStatus();
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

      eventSource.addEventListener('CANVA_SYNC_COMPLETED', () => {
        loadCanvaStatus();
        loadPresentations();
        setIsCanvaSyncing(false);
      });

      eventSource.addEventListener('CANVA_AUTO_SYNC_CHANGED', () => {
        loadCanvaStatus();
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

  // Canva Computed Variables
  const latestCanvaVersion = canvaStatus?.latest_version;
  const isLatestVersionCurrentlyActive = Boolean(
    latestCanvaVersion &&
      displayState?.state?.active_presentation_id === latestCanvaVersion.presentation_id
  );
  const canvaDesignTitle =
    canvaStatus?.connection?.design_title || 'Copy of Dashboard Screen 16/9';
  const canvaDesignId = canvaStatus?.connection?.design_id || 'DAHVb9pmJzQ';
  const isCanvaConnected = canvaStatus?.connection?.status === 'connected';

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

      {/* Canva Direct Integration Section */}
      <div className="canva-card">
        <div className="canva-card-header">
          <div className="canva-title-group">
            <div className="canva-pill-badge">
              <Sparkles size={14} />
              <span>CANVA DIRECT CONNECT</span>
            </div>
            <h2 className="canva-heading">Canva Design Synchronization</h2>
            <p className="canva-subheading">
              Official Design Source of Truth • Continuous Cloud & 4K Display Synchronization
            </p>
          </div>
          <div className="canva-header-actions">
            <button
              type="button"
              className="canva-config-trigger"
              onClick={() => setShowCanvaConfig(!showCanvaConfig)}
              title="Configure Canva API Credentials & Design Target"
            >
              <Settings size={15} />
              <span>Canva API Settings</span>
            </button>
          </div>
        </div>

        {/* Canva API Credentials / Target Drawer */}
        {showCanvaConfig && (
          <div className="canva-config-box">
            <div className="canva-config-header">
              <div>
                <strong>Canva Connect API Configuration</strong>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '4px 0 0 0' }}>
                  Manage Canva Developer credentials and cloud connection mode
                </p>
              </div>
              <button
                type="button"
                className="btn-text-close"
                onClick={() => setShowCanvaConfig(false)}
              >
                ✕
              </button>
            </div>
            <div className="canva-config-grid">
              {/* Canva Developer Portal Redirect URL Banner */}
              <div style={{
                gridColumn: '1 / -1',
                background: 'rgba(125, 42, 232, 0.1)',
                border: '1px solid rgba(125, 42, 232, 0.35)',
                borderRadius: '8px',
                padding: '12px 14px',
                marginBottom: '6px'
              }}>
                <div style={{ fontWeight: '600', color: '#c084fc', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px' }}>
                  <Sparkles size={14} />
                  <span>Redirect URL for Canva Developer Portal (Configuration tab):</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <code style={{ background: '#09090b', padding: '6px 10px', borderRadius: '5px', flex: 1, color: '#4ade80', fontSize: '12px', border: '1px solid rgba(255,255,255,0.1)', wordBreak: 'break-all' }}>
                    https://canvaaa-p0f3.onrender.com/api/canva/callback
                  </code>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText('https://canvaaa-p0f3.onrender.com/api/canva/callback');
                      setCanvaFeedback({ type: 'success', message: '📋 Copied Canva Redirect URL to clipboard!' });
                    }}
                    style={{ background: '#7d2ae8', color: '#fff', border: 'none', borderRadius: '5px', padding: '6px 12px', fontSize: '12px', cursor: 'pointer', fontWeight: '700', whiteSpace: 'nowrap' }}
                  >
                    Copy URL
                  </button>
                </div>
              </div>

              <div className="config-field">
                <label>Canva Client ID (from your Canva App)</label>
                <input
                  type="text"
                  value={canvaConfigForm.client_id}
                  onChange={(e) =>
                    setCanvaConfigForm({ ...canvaConfigForm, client_id: e.target.value })
                  }
                  placeholder="e.g. OC-AAdIyAng356N"
                />
              </div>

              <div className="config-field">
                <label>Canva Client Secret (from your Canva App)</label>
                <input
                  type="password"
                  value={canvaConfigForm.client_secret}
                  onChange={(e) =>
                    setCanvaConfigForm({ ...canvaConfigForm, client_secret: e.target.value })
                  }
                  placeholder="Paste Canva Client Secret"
                />
              </div>

              <div className="config-field">
                <label>Canva Design ID</label>
                <input
                  type="text"
                  value={canvaConfigForm.design_id}
                  onChange={(e) =>
                    setCanvaConfigForm({ ...canvaConfigForm, design_id: e.target.value })
                  }
                  placeholder="e.g. DAHVb9pmJzQ"
                />
              </div>
              <div className="config-field">
                <label>Design Title</label>
                <input
                  type="text"
                  value={canvaConfigForm.design_title}
                  onChange={(e) =>
                    setCanvaConfigForm({ ...canvaConfigForm, design_title: e.target.value })
                  }
                  placeholder="e.g. Copy of Dashboard Screen 16/9"
                />
              </div>
              <div className="config-field">
                <label>Export Format</label>
                <select
                  value={canvaConfigForm.export_format || 'mp4'}
                  onChange={(e) =>
                    setCanvaConfigForm({ ...canvaConfigForm, export_format: e.target.value })
                  }
                  style={{
                    background: '#09090b',
                    color: '#fff',
                    border: '1px solid rgba(255,255,255,0.15)',
                    borderRadius: '6px',
                    padding: '8px 12px',
                    fontSize: '13px',
                    width: '100%'
                  }}
                >
                  <option value="mp4">🎬 Native Video (MP4) — High Quality Looping Video</option>
                  <option value="pdf">📄 Slides Presentation (PDF) — Static Slide Carousel</option>
                </select>
              </div>

              <div className="config-field" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginTop: '14px' }}>
                  <input
                    type="checkbox"
                    checked={Boolean(canvaConfigForm.auto_publish !== false)}
                    onChange={(e) =>
                      setCanvaConfigForm({ ...canvaConfigForm, auto_publish: e.target.checked })
                    }
                  />
                  <span style={{ fontSize: '13px', fontWeight: '600', color: '#e4e4e7' }}>
                    Auto-Publish to Display on Sync
                  </span>
                </label>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                  Immediately update 4K displays when Canva video sync completes
                </span>
              </div>

              <div className="config-field" style={{ gridColumn: '1 / -1' }}>
                <label>Canva Bearer Access Token (or "simulation" for sandbox mode)</label>
                <input
                  type="password"
                  value={canvaConfigForm.access_token}
                  onChange={(e) =>
                    setCanvaConfigForm({ ...canvaConfigForm, access_token: e.target.value })
                  }
                  placeholder="Enter Canva OAuth Bearer Token or 'simulation'"
                />
              </div>
            </div>
            <div className="canva-config-footer">
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                Status:{' '}
                <strong style={{ color: isCanvaConnected ? '#4ade80' : '#f87171' }}>
                  {isCanvaConnected ? 'Connected to Canva' : 'Disconnected'}
                </strong>
                {canvaStatus?.connection?.access_token === 'simulation' && (
                  <span> (Sandbox Simulation Active)</span>
                )}
              </span>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn-canva-oauth"
                  onClick={handleStartCanvaOAuth}
                  style={{
                    background: 'linear-gradient(135deg, #7d2ae8 0%, #00c4cc 100%)',
                    color: '#fff',
                    border: 'none',
                    padding: '8px 16px',
                    borderRadius: '6px',
                    fontSize: '13px',
                    fontWeight: '700',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}
                >
                  <Sparkles size={15} />
                  <span>Authorize with Canva (1-Click)</span>
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() =>
                    setCanvaConfigForm({
                      ...canvaConfigForm,
                      access_token: 'simulation'
                    })
                  }
                >
                  Use Sandbox
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={handleSaveCanvaConfig}
                >
                  Save Connection
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Canva Metadata & Status Grid */}
        <div className="canva-telemetry-grid">
          <div className="canva-stat-card">
            <div className="canva-stat-label">CANVA DESIGN</div>
            <div className="canva-stat-val primary-val" title={canvaDesignTitle}>
              {canvaDesignTitle}
            </div>
          </div>

          <div className="canva-stat-card">
            <div className="canva-stat-label">DESIGN ID</div>
            <div className="canva-stat-val mono-val">
              <span>{canvaDesignId}</span>
              <a
                href={`https://www.canva.com/design/${canvaDesignId}/view`}
                target="_blank"
                rel="noreferrer"
                title="Open in Canva (New Tab)"
                className="canva-ext-link"
              >
                <ExternalLink size={13} />
              </a>
            </div>
          </div>

          <div className="canva-stat-card">
            <div className="canva-stat-label">STATUS</div>
            <div className="canva-stat-val">
              <span
                className={`canva-status-pill ${
                  isCanvaConnected ? 'connected' : 'disconnected'
                }`}
              >
                <span className="dot" />
                {isCanvaConnected ? 'Connected' : 'Disconnected'}
              </span>
            </div>
          </div>

          <div className="canva-stat-card">
            <div className="canva-stat-label">LAST CANVA VERSION</div>
            <div className="canva-stat-val mono-val" style={{ fontSize: '13px' }}>
              {latestCanvaVersion?.version_label ||
                (canvaStatus?.connection?.last_canva_updated_at
                  ? `v${canvaStatus.connection.last_canva_updated_at}`
                  : '—')}
            </div>
          </div>

          <div className="canva-stat-card">
            <div className="canva-stat-label">LAST SYNC</div>
            <div className="canva-stat-val" style={{ fontSize: '13px' }}>
              {formatTimestamp(canvaStatus?.connection?.last_synced_at)}
            </div>
          </div>

          <div className="canva-stat-card">
            <div className="canva-stat-label">LAST PUBLISHED</div>
            <div className="canva-stat-val" style={{ fontSize: '13px' }}>
              {isLatestVersionCurrentlyActive ? (
                <span className="live-pill">● Playing Live</span>
              ) : latestCanvaVersion?.published_at ? (
                formatTimestamp(latestCanvaVersion.published_at)
              ) : (
                <span style={{ color: 'var(--text-muted)' }}>Not yet published</span>
              )}
            </div>
          </div>
        </div>

        {/* Remote Unseen Changes Notice */}
        {canvaStatus?.canva_remote?.has_unseen_changes && (
          <div className="canva-alert-badge">
            <Sparkles size={16} />
            <span>
              <strong>New Canva changes detected!</strong> Canva design has been edited since last sync. Press "SYNC FROM CANVA" below to export as MP4 Video & publish live.
            </span>
          </div>
        )}

        {/* Primary Action Row: SYNC, PUBLISH, AUTO-SYNC */}
        <div className="canva-actions-strip">
          <div className="canva-action-buttons">
            {/* Format Mode Selector: 4K Video vs Slides */}
            <div style={{ display: 'inline-flex', alignItems: 'center', background: '#121215', borderRadius: '8px', padding: '3px', border: '1px solid rgba(255,255,255,0.1)' }}>
              <button
                type="button"
                onClick={() => handleSwitchFormat('mp4')}
                style={{
                  background: (canvaStatus?.connection?.export_format || canvaConfigForm.export_format || 'mp4') === 'mp4'
                    ? 'linear-gradient(135deg, #7d2ae8 0%, #00c4cc 100%)'
                    : 'transparent',
                  color: (canvaStatus?.connection?.export_format || canvaConfigForm.export_format || 'mp4') === 'mp4' ? '#fff' : '#a1a1aa',
                  border: 'none',
                  borderRadius: '6px',
                  padding: '7px 12px',
                  fontSize: '12px',
                  fontWeight: '700',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  transition: 'all 0.2s ease'
                }}
                title="Export as native 4K looping video (Default for digital signage)"
              >
                <span>🎬 4K Video</span>
                <span style={{ fontSize: '9px', background: 'rgba(0,0,0,0.3)', padding: '1px 5px', borderRadius: '4px' }}>DEFAULT</span>
              </button>
              <button
                type="button"
                onClick={() => handleSwitchFormat('pdf')}
                style={{
                  background: (canvaStatus?.connection?.export_format || canvaConfigForm.export_format) === 'pdf'
                    ? 'rgba(212, 175, 55, 0.25)'
                    : 'transparent',
                  color: (canvaStatus?.connection?.export_format || canvaConfigForm.export_format) === 'pdf'
                    ? 'var(--accent-gold)'
                    : '#a1a1aa',
                  border: (canvaStatus?.connection?.export_format || canvaConfigForm.export_format) === 'pdf'
                    ? '1px solid var(--accent-gold)'
                    : 'none',
                  borderRadius: '6px',
                  padding: '7px 12px',
                  fontSize: '12px',
                  fontWeight: '700',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  transition: 'all 0.2s ease'
                }}
                title="Export as multi-slide carousel"
              >
                <span>📄 Slides (PDF)</span>
              </button>
            </div>

            <button
              type="button"
              className="btn-canva-action btn-sync"
              onClick={() => handleSyncCanva(false)}
              disabled={isCanvaSyncing}
            >
              <RefreshCw size={17} className={isCanvaSyncing ? 'spin' : ''} />
              <span>{isCanvaSyncing ? 'SYNCING FROM CANVA...' : 'SYNC FROM CANVA'}</span>
            </button>

            <button
              type="button"
              className={`btn-canva-action btn-canva-publish ${
                isLatestVersionCurrentlyActive ? 'is-active' : ''
              }`}
              onClick={() => handlePublishCanvaVersion(latestCanvaVersion?.id)}
              disabled={!latestCanvaVersion || isProcessing}
              title={
                isLatestVersionCurrentlyActive
                  ? 'Currently playing live on LG Display. Click to re-broadcast.'
                  : 'Publish this Canva presentation to LG Display'
              }
            >
              {isLatestVersionCurrentlyActive ? (
                <>
                  <CheckCircle size={17} />
                  <span>LIVE ON DISPLAY (CLICK TO RE-PUBLISH)</span>
                </>
              ) : (
                <>
                  <Play size={17} />
                  <span>PUBLISH TO DISPLAY</span>
                </>
              )}
            </button>
          </div>

          {/* Auto Sync Toggle & Interval */}
          <div className="canva-autosync-group">
            <label className="autosync-switch-label">
              <input
                type="checkbox"
                checked={Boolean(canvaStatus?.connection?.auto_sync_enabled)}
                onChange={(e) => handleToggleAutoSync(e.target.checked)}
              />
              <span className="switch-slider" />
              <span className="switch-text">AUTO SYNC</span>
            </label>

            {canvaStatus?.connection?.auto_sync_enabled && (
              <div className="autosync-interval-pills">
                <span className="interval-label">Interval:</span>
                {[30, 60, 120, 300].map((sec) => (
                  <button
                    key={sec}
                    type="button"
                    className={`interval-pill ${
                      (canvaStatus?.connection?.poll_interval_seconds || 60) === sec
                        ? 'active'
                        : ''
                    }`}
                    onClick={() => handleChangeSyncInterval(sec)}
                  >
                    {sec < 60 ? `${sec}s` : `${sec / 60}m`}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Canva Sync Feedback Banner */}
        {canvaFeedback && (
          <div className={`canva-feedback-banner ${canvaFeedback.type}`}>
            {canvaFeedback.type === 'loading' && <RefreshCw size={16} className="spin" />}
            {canvaFeedback.type === 'success' && <CheckCircle size={16} />}
            {canvaFeedback.type === 'info' && <Sparkles size={16} />}
            {canvaFeedback.type === 'error' && <AlertCircle size={16} />}
            <span>{canvaFeedback.message}</span>
            <button
              type="button"
              className="feedback-dismiss"
              onClick={() => setCanvaFeedback(null)}
            >
              ✕
            </button>
          </div>
        )}

        {/* Synced Canva Versions History Drawer */}
        {canvaVersions && canvaVersions.length > 0 && (
          <div className="canva-versions-box">
            <div
              className="canva-versions-header"
              onClick={() => setShowVersionsDrawer(!showVersionsDrawer)}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Clock size={15} color="var(--accent-gold)" />
                <span style={{ fontWeight: '600', fontSize: '13px' }}>
                  Canva Sync History ({canvaVersions.length} Version{canvaVersions.length === 1 ? '' : 's'})
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  {showVersionsDrawer ? 'Hide' : 'Show History'}
                </span>
                {showVersionsDrawer ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </div>
            </div>

            {showVersionsDrawer && (
              <div className="canva-versions-list">
                {canvaVersions.map((v) => {
                  const isThisActive =
                    v.is_published ||
                    displayState?.state?.presentation_id === v.presentation_id;
                  return (
                    <div key={v.id} className={`canva-version-row ${isThisActive ? 'active-row' : ''}`}>
                      <div className="version-info-left">
                        <span className="version-code">{v.version_label || v.id.slice(0, 8)}</span>
                        <span className="version-meta">
                          {v.export_format === 'MP4'
                            ? `🎬 Native Video • Synced ${formatTimestamp(v.synced_at)}`
                            : `${v.slide_count} Slides • ${v.export_format} • Synced ${formatTimestamp(v.synced_at)}`}
                        </span>
                      </div>
                      <div className="version-info-right">
                        {isThisActive ? (
                          <span className="version-active-tag">● Live on Display</span>
                        ) : (
                          <button
                            type="button"
                            className="btn-version-publish"
                            onClick={() => handlePublishCanvaVersion(v.id)}
                            disabled={isProcessing}
                          >
                            Publish
                          </button>
                        )}
                        {v.presentation_id && (
                          <button
                            type="button"
                            className="btn-version-preview"
                            onClick={() => {
                              loadPresentationDetails(v.presentation_id);
                              scrollToBottom();
                            }}
                            title="Preview this version's slides below"
                          >
                            <Eye size={13} />
                            <span>Preview</span>
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
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
          <div style={{ fontSize: '12px', color: 'var(--accent-gold)', marginTop: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
            <Sparkles size={14} />
            <span>Auto-Purge Active: When you upload something new, older presentations & files are automatically deleted.</span>
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
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <button
                type="button"
                className="btn-delete"
                onClick={() => handleDeletePresentation(selectedPresentation.id)}
                disabled={isProcessing}
                title="Delete this presentation and all its slides from the server"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  background: 'rgba(239, 68, 68, 0.15)',
                  border: '1px solid rgba(239, 68, 68, 0.4)',
                  color: '#f87171',
                  borderRadius: '8px',
                  padding: '9px 14px',
                  fontSize: '13px',
                  fontWeight: '600',
                  cursor: isProcessing ? 'not-allowed' : 'pointer',
                  transition: 'all 0.2s'
                }}
              >
                <Trash2 size={16} />
                <span>DELETE</span>
              </button>
              <button
                className="btn-publish"
                onClick={() => handlePublish(selectedPresentation.id)}
                disabled={isProcessing}
              >
                <Play size={18} />
                <span>PUBLISH TO LG DISPLAY</span>
              </button>
            </div>
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
