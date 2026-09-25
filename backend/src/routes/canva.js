import express from 'express';
import { query } from '../config/db.js';
import { sseBroadcaster } from '../services/sseBroadcaster.js';
import { getCurrentDisplayPayload } from './display.js';
import { purgeOldPresentations } from './presentations.js';
import {
  getCanvaConnection,
  updateCanvaConnection,
  getCanvaDesignMetadata,
  syncCanvaDesign,
  getCanvaVersions,
  generateCanvaAuthUrl,
  exchangeCanvaAuthCode,
  publishCanvaVersion,
  getActiveSyncState
} from '../services/canvaService.js';

const router = express.Router();

/**
 * GET /api/canva/auth/start
 * Initiates Canva OAuth 2.0 PKCE Authorization
 */
router.get('/auth/start', async (req, res) => {
  try {
    const { redirect_uri, client_id } = req.query;
    const host = req.get('x-forwarded-host') || req.get('host') || 'canvaaa-9gc6.onrender.com';
    const proto = req.get('x-forwarded-proto') || (req.secure ? 'https' : req.protocol) || 'https';
    const defaultRedirect = `${proto}://${host}/api/canva/callback`;

    let targetRedirect = redirect_uri || process.env.CANVA_REDIRECT_URI || defaultRedirect;
    const { auth_url, state, redirect_uri: finalUri } = await generateCanvaAuthUrl(targetRedirect, client_id);
    res.json({
      success: true,
      auth_url,
      state,
      redirect_uri: finalUri
    });
  } catch (err) {
    console.error('Error starting Canva auth:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/canva/callback
 * Handles Canva OAuth callback with authorization code
 */
router.get('/callback', async (req, res) => {
  const { code, state, error, error_description } = req.query;
  const isLive = req.get('host')?.includes('onrender.com') || process.env.NODE_ENV === 'production';
  const frontendOrigin = process.env.FRONTEND_URL || (isLive ? 'https://canvaaa-one.vercel.app' : 'http://localhost:5173');

  if (error) {
    console.error('[Canva OAuth Error]:', error, error_description);
    return res.redirect(`${frontendOrigin}/admin?canva_error=${encodeURIComponent(error_description || error)}`);
  }

  if (!code || !state) {
    return res.status(400).send('Missing code or state in OAuth callback');
  }

  try {
    const host = req.get('x-forwarded-host') || req.get('host') || 'canvaaa-9gc6.onrender.com';
    const proto = req.get('x-forwarded-proto') || (req.secure ? 'https' : req.protocol) || 'https';
    const defaultRedirect = `${proto}://${host}/api/canva/callback`;

    const updated = await exchangeCanvaAuthCode({
      code,
      state,
      redirectUri: defaultRedirect
    });

    console.log('[Canva OAuth] Successfully authorized and saved tokens for Canva!');
    res.redirect(`${frontendOrigin}/admin?canva_connected=true`);
  } catch (err) {
    console.error('[Canva OAuth Token Exchange Failed]:', err);
    res.redirect(`${frontendOrigin}/admin?canva_error=${encodeURIComponent(err.message)}`);
  }
});

/**
 * GET /api/canva/status
 * Returns current connection status, design info, and latest version
 */
router.get('/status', async (req, res) => {
  try {
    const connection = await getCanvaConnection();
    const versions = await getCanvaVersions(connection.design_id);
    const latestVersion = versions.length > 0 ? versions[0] : null;

    let canvaRemote = null;
    if (connection.has_token) {
      try {
        const meta = await getCanvaDesignMetadata(connection.design_id);
        if (meta.success) {
          const isNewer = meta.design.updated_at > (connection.last_canva_updated_at || 0);
          canvaRemote = {
            title: meta.design.title,
            updated_at: meta.design.updated_at,
            page_count: meta.design.page_count,
            thumbnail_url: meta.design.thumbnail?.url,
            has_unseen_changes: isNewer
          };
        }
      } catch (err) {
        console.warn('Canva metadata check failed:', err.message);
      }
    }

    res.json({
      connection,
      latest_version: latestVersion,
      canva_remote: canvaRemote,
      sync_state: getActiveSyncState()
    });
  } catch (err) {
    console.error('Error fetching Canva status:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/canva/connect
 * Saves credentials/token and tests connectivity
 */
router.post('/connect', async (req, res) => {
  const { design_id, access_token, design_title, client_id, client_secret } = req.body;

  try {
    const fieldsToUpdate = {};
    if (client_id !== undefined) fieldsToUpdate.client_id = client_id.trim();
    if (client_secret !== undefined && client_secret !== '••••••••••••••••') fieldsToUpdate.client_secret = client_secret.trim();
    if (design_id) fieldsToUpdate.design_id = design_id.trim();
    if (design_title) fieldsToUpdate.design_title = design_title.trim();
    if (access_token !== undefined && access_token !== '••••••••••••••••') fieldsToUpdate.access_token = access_token.trim();

    await updateCanvaConnection(fieldsToUpdate);

    // Test token if provided
    let testSuccess = false;
    let message = 'Connection settings saved.';

    const targetDesignId = design_id || 'DAHVb9pmJzQ';
    if (access_token) {
      const meta = await getCanvaDesignMetadata(targetDesignId);
      if (meta.success) {
        testSuccess = true;
        await updateCanvaConnection({
          status: 'connected',
          design_title: meta.design.title || fieldsToUpdate.design_title || 'Copy of Dashboard Screen 16/9'
        });
        message = `Successfully connected to Canva design: "${meta.design.title}"`;
      } else {
        await updateCanvaConnection({ status: 'error' });
        return res.status(400).json({
          success: false,
          error: `Could not verify Canva token: ${meta.error}`
        });
      }
    }

    const updatedConn = await getCanvaConnection();
    res.json({
      success: true,
      message,
      connection: updatedConn
    });
  } catch (err) {
    console.error('Error connecting Canva:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/canva/sync
 * Manually triggers sync from Canva (exports MP4 Video or PDF slides and updates display)
 * Non-blocking by default (returns HTTP 202) to prevent cloud reverse proxy timeouts
 */
router.post('/sync', async (req, res) => {
  const { design_id, force, format, auto_publish, async: isAsync = true } = req.body;

  try {
    const currentSync = getActiveSyncState();
    if (currentSync.is_running) {
      return res.status(200).json({
        success: true,
        already_running: true,
        in_progress: true,
        message: currentSync.message || 'Canva sync is already running in background.',
        sync_state: currentSync
      });
    }

    if (isAsync !== false) {
      // Execute asynchronously in background to prevent HTTP reverse proxy timeouts
      syncCanvaDesign({
        designId: design_id,
        force: Boolean(force),
        format: format || undefined,
        autoPublish: typeof auto_publish === 'boolean' ? auto_publish : undefined
      }).catch((bgErr) => {
        console.error('[Async Canva Sync Background Error]:', bgErr);
      });

      return res.status(202).json({
        success: true,
        in_progress: true,
        message: 'Canva synchronization started in background.',
        sync_state: getActiveSyncState()
      });
    }

    // Synchronous execution fallback if explicitly requested with { async: false }
    const result = await syncCanvaDesign({
      designId: design_id,
      force: Boolean(force),
      format: format || undefined,
      autoPublish: typeof auto_publish === 'boolean' ? auto_publish : undefined
    });

    res.json(result);
  } catch (err) {
    console.error('Canva sync failed:', err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

/**
 * POST /api/canva/auto-sync
 * Enables or disables automated background sync polling and auto-publish
 */
router.post('/auto-sync', async (req, res) => {
  const { enabled, interval_seconds, auto_publish, export_format } = req.body;

  try {
    const fields = {};
    if (typeof enabled === 'boolean') fields.auto_sync_enabled = enabled;
    if (typeof auto_publish === 'boolean') fields.auto_publish = auto_publish;
    if (export_format) fields.export_format = export_format;
    if (interval_seconds && !isNaN(interval_seconds)) {
      fields.poll_interval_seconds = Math.max(15, parseInt(interval_seconds, 10));
    }

    const updated = await updateCanvaConnection(fields);

    sseBroadcaster.broadcast('CANVA_AUTO_SYNC_CHANGED', {
      auto_sync_enabled: updated.auto_sync_enabled,
      poll_interval_seconds: updated.poll_interval_seconds,
      auto_publish: updated.auto_publish,
      export_format: updated.export_format
    });

    res.json({
      success: true,
      message: `Auto Sync ${updated.auto_sync_enabled ? 'enabled' : 'disabled'} (polling every ${updated.poll_interval_seconds}s, format: ${updated.export_format})`,
      connection: updated
    });
  } catch (err) {
    console.error('Error updating auto-sync settings:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/canva/versions
 * Returns all synced Canva version records
 */
router.get('/versions', async (req, res) => {
  try {
    const conn = await getCanvaConnection();
    const versions = await getCanvaVersions(conn.design_id);
    res.json({ versions });
  } catch (err) {
    console.error('Error loading Canva versions:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/canva/publish/:versionId
 * Publishes a specific synced Canva version to the Display
 */
router.post('/publish/:versionId', async (req, res) => {
  const { versionId } = req.params;

  try {
    const result = await publishCanvaVersion(versionId);
    res.json(result);
  } catch (err) {
    console.error('Error publishing Canva version:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
