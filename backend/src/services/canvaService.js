import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { query } from '../config/db.js';
import { renderPdfToSlides } from './pdfRenderer.js';
import { sseBroadcaster } from './sseBroadcaster.js';
import { processVideo } from './videoProcessor.js';
import { purgeOldPresentations } from '../routes/presentations.js';
import { getCurrentDisplayPayload } from '../routes/display.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CANVA_API_BASE = 'https://api.canva.com/rest/v1';
const uploadsBaseDir = path.resolve(__dirname, '../../uploads');
const docsDir = path.join(uploadsBaseDir, 'docs');
const slidesBaseDir = path.join(uploadsBaseDir, 'slides');
const videosDir = path.join(uploadsBaseDir, 'videos');
const thumbsBaseDir = path.join(uploadsBaseDir, 'thumbnails');

[docsDir, slidesBaseDir, videosDir, thumbsBaseDir].forEach((d) => fs.mkdirSync(d, { recursive: true }));

// PKCE memory cache for pending OAuth sessions
const pkceSessions = new Map();

/**
 * Generates Canva OAuth 2.0 PKCE Authorization URL
 */
export async function generateCanvaAuthUrl(redirectUri, customClientId = null) {
  let clientId = customClientId;
  if (!clientId) {
    const credsRes = await query('SELECT client_id FROM canva_connections WHERE id = 1');
    clientId = credsRes.rows[0]?.client_id || process.env.CANVA_CLIENT_ID || 'OC-AAdIyAng356N';
  }
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const state = crypto.randomBytes(16).toString('hex');

  const finalRedirectUri =
    redirectUri ||
    process.env.CANVA_REDIRECT_URI ||
    'http://127.0.0.1:8000/api/canva/callback';

  pkceSessions.set(state, {
    verifier,
    redirectUri: finalRedirectUri,
    clientId,
    createdAt: Date.now()
  });

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: finalRedirectUri,
    scope: 'design:meta:read design:content:read',
    code_challenge: challenge,
    code_challenge_method: 's256',
    state
  });

  return {
    auth_url: `https://www.canva.com/api/oauth/authorize?${params.toString()}`,
    state,
    redirect_uri: finalRedirectUri,
    client_id: clientId
  };
}

/**
 * Exchanges authorization code for Canva Access & Refresh Tokens
 */
export async function exchangeCanvaAuthCode({ code, state, redirectUri }) {
  const session = pkceSessions.get(state);
  const verifier = session?.verifier;

  const credsRes = await query('SELECT client_id, client_secret FROM canva_connections WHERE id = 1');
  const dbRow = credsRes.rows[0];
  const clientId = session?.clientId || dbRow?.client_id || process.env.CANVA_CLIENT_ID || 'OC-AAdIyAng356N';
  const clientSecret = dbRow?.client_secret || process.env.CANVA_CLIENT_SECRET || 'cnvcaHhkYCKMOpnh-fY_WMWvTz6Rcf9vlQWyuWwfTYTECRD84';

  const finalRedirectUri =
    session?.redirectUri ||
    redirectUri ||
    process.env.CANVA_REDIRECT_URI ||
    'http://127.0.0.1:8000/api/canva/callback';

  if (!verifier) {
    throw new Error('OAuth state session expired or invalid. Please try clicking Connect again.');
  }

  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const bodyParams = new URLSearchParams({
    grant_type: 'authorization_code',
    code_verifier: verifier,
    code,
    redirect_uri: finalRedirectUri
  });

  const res = await fetch(`${CANVA_API_BASE}/oauth/token`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: bodyParams.toString()
  });

  if (!res.ok) {
    const errText = await res.text();
    let errJson;
    try { errJson = JSON.parse(errText); } catch {}
    throw new Error(errJson?.message || `Canva token exchange failed (${res.status}): ${errText}`);
  }

  const tokenData = await res.json();
  pkceSessions.delete(state);

  const expiresAt = new Date(Date.now() + (tokenData.expires_in || 14400) * 1000);

  const updated = await updateCanvaConnection({
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token || null,
    token_expires_at: expiresAt,
    status: 'connected'
  });

  sseBroadcaster.broadcast('CANVA_CONNECTION_UPDATED', {
    status: 'connected',
    has_token: true
  });

  return updated;
}

/**
 * Refreshes an expired Canva access token
 */
export async function refreshCanvaToken(refreshToken) {
  const clientId = process.env.CANVA_CLIENT_ID || 'OC-AAdIyAng356N';
  const clientSecret =
    process.env.CANVA_CLIENT_SECRET ||
    'cnvcaHhkYCKMOpnh-fY_WMWvTz6Rcf9vlQWyuWwfTYTECRD84';
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const res = await fetch(`${CANVA_API_BASE}/oauth/token`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken
    }).toString()
  });

  if (!res.ok) {
    throw new Error(`Token refresh failed (${res.status})`);
  }

  const tokenData = await res.json();
  const expiresAt = new Date(Date.now() + (tokenData.expires_in || 14400) * 1000);
  await updateCanvaConnection({
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token || refreshToken,
    token_expires_at: expiresAt
  });
  return tokenData;
}

/**
 * Retrieves the stored Canva connection settings from Neon PostgreSQL
 */
export async function getCanvaConnection() {
  const res = await query('SELECT * FROM canva_connections WHERE id = 1');
  const conn = res.rows[0] || {
    id: 1,
    design_id: 'DAHVb9pmJzQ',
    design_title: 'Copy of Dashboard Screen 16/9',
    status: 'disconnected',
    auto_sync_enabled: false,
    poll_interval_seconds: 60
  };

  // Mask access token and secret for safety
  const clientId = conn.client_id || process.env.CANVA_CLIENT_ID || 'OC-AAdIyAng356N';
  const hasSecret = Boolean(conn.client_secret || process.env.CANVA_CLIENT_SECRET);
  const hasToken = Boolean(conn.access_token || process.env.CANVA_ACCESS_TOKEN || process.env.CANVA_API_KEY);
  return {
    ...conn,
    client_id: clientId,
    has_client_secret: hasSecret,
    client_secret_masked: hasSecret ? '••••••••••••••••' : null,
    has_token: hasToken,
    access_token_masked: hasToken ? '••••••••••••••••' : null,
    export_format: conn.export_format || 'mp4',
    auto_publish: conn.auto_publish !== false
  };
}

/**
 * Updates Canva connection configuration
 */
export async function updateCanvaConnection(fields) {
  const allowed = [
    'client_id',
    'client_secret',
    'design_id',
    'design_title',
    'access_token',
    'refresh_token',
    'token_expires_at',
    'auto_sync_enabled',
    'poll_interval_seconds',
    'last_canva_updated_at',
    'last_synced_at',
    'last_published_at',
    'status',
    'export_format',
    'auto_publish'
  ];

  const updates = [];
  const values = [];
  let idx = 1;

  for (const [key, val] of Object.entries(fields)) {
    if (allowed.includes(key)) {
      updates.push(`${key} = $${idx++}`);
      values.push(val);
    }
  }

  if (updates.length === 0) return getCanvaConnection();

  updates.push(`updated_at = NOW()`);
  const sql = `UPDATE canva_connections SET ${updates.join(', ')} WHERE id = 1 RETURNING *`;
  const res = await query(sql, values);
  return res.rows[0];
}

/**
 * Returns raw active access token from DB or environment
 */
async function getEffectiveToken() {
  const res = await query('SELECT access_token, status FROM canva_connections WHERE id = 1');
  const row = res.rows[0];
  const dbToken = row?.access_token;
  if (row?.status === 'simulated' || dbToken === 'simulation') return 'simulation';
  return dbToken || process.env.CANVA_ACCESS_TOKEN || process.env.CANVA_API_KEY || null;
}

/**
 * 1. Access Programmatically & Detect Changes
 * Calls Canva Connect API: GET /v1/designs/{designId}
 */
export async function getCanvaDesignMetadata(designId) {
  const token = await getEffectiveToken();

  if (!token) {
    return {
      success: false,
      requires_auth: true,
      error: 'Canva API Access Token is not configured. Please connect your Canva integration in the Admin panel.'
    };
  }

  // Simulation / Developer Sandbox Mode
  if (token === 'simulation' || process.env.CANVA_SIMULATION === 'true') {
    const connRes = await query('SELECT last_canva_updated_at FROM canva_connections WHERE id = 1');
    const lastTime = parseInt(connRes.rows[0]?.last_canva_updated_at || 0, 10);
    // Simulate periodic new revision if needed or return current timestamp
    const nowSec = Math.floor(Date.now() / 1000);
    const updatedSec = lastTime === 0 ? nowSec : lastTime;

    return {
      success: true,
      is_simulated: true,
      design: {
        id: designId,
        title: 'Copy of Dashboard Screen 16/9',
        updated_at: updatedSec,
        created_at: 1726000000,
        page_count: 5,
        thumbnail: {
          url: '/lph-logo.png'
        }
      }
    };
  }

  try {
    const res = await fetch(`${CANVA_API_BASE}/designs/${designId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    if (!res.ok) {
      const errText = await res.text();
      let errJson;
      try { errJson = JSON.parse(errText); } catch {}
      return {
        success: false,
        status: res.status,
        error: errJson?.message || `Canva API error (${res.status}): ${errText}`
      };
    }

    const data = await res.json();
    return {
      success: true,
      design: data.design
    };
  } catch (err) {
    return {
      success: false,
      error: `Network error connecting to Canva API: ${err.message}`
    };
  }
}

/**
 * 2. Create Design Export Job
 * Calls Canva Connect API: POST /v1/exports
 */
export async function createCanvaExportJob(designId, format = 'pdf') {
  const token = await getEffectiveToken();
  if (!token) throw new Error('Missing Canva API Access Token');

  const res = await fetch(`${CANVA_API_BASE}/exports`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      design_id: designId,
      format: {
        type: format
      }
    })
  });

  if (!res.ok) {
    const errText = await res.text();
    let errJson;
    try { errJson = JSON.parse(errText); } catch {}
    throw new Error(errJson?.message || `Failed to create export job (${res.status}): ${errText}`);
  }

  const data = await res.json();
  return data.job; // { id, status }
}

/**
 * 3. Poll for Export Completion
 * Calls Canva Connect API: GET /v1/exports/{exportId}
 */
export async function waitForCanvaExportJob(exportId, maxWaitSec = 90) {
  const token = await getEffectiveToken();
  if (!token) throw new Error('Missing Canva API Access Token');

  const startTime = Date.now();
  const pollIntervalMs = 2000;

  while ((Date.now() - startTime) < (maxWaitSec * 1000)) {
    const res = await fetch(`${CANVA_API_BASE}/exports/${exportId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    if (!res.ok) {
      throw new Error(`Failed to check export job status (${res.status})`);
    }

    const data = await res.json();
    const job = data.job;

    if (job.status === 'success') {
      if (!job.urls || job.urls.length === 0) {
        throw new Error('Export succeeded but Canva returned no download URLs.');
      }
      return job.urls[0]; // Primary download URL
    }

    if (job.status === 'failed') {
      throw new Error(job.error?.message || 'Canva export job failed.');
    }

    // Wait 2 seconds before next poll
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }

  throw new Error(`Canva export job timed out after ${maxWaitSec} seconds.`);
}

/**
 * 4. Download Export File to Backend Disk
 */
export async function downloadCanvaFile(downloadUrl, targetPath) {
  const res = await fetch(downloadUrl);
  if (!res.ok) {
    throw new Error(`Failed to download exported file from Canva (${res.status})`);
  }

  const arrayBuffer = await res.arrayBuffer();
  fs.writeFileSync(targetPath, Buffer.from(arrayBuffer));
  return targetPath;
}

/**
 * Publishes a specific synced Canva version to the Display
 */
export async function publishCanvaVersion(versionId) {
  const versionRes = await query(
    `SELECT v.*, p.title, p.page_count, p.original_format, p.media_type, p.media_url
     FROM canva_versions v
     JOIN presentations p ON v.presentation_id = p.id
     WHERE v.id = $1`,
    [versionId]
  );

  if (versionRes.rows.length === 0) {
    throw new Error('Canva version not found.');
  }

  const version = versionRes.rows[0];
  const presentationId = version.presentation_id;

  // 1. Purge all older presentations and disk files so only this published presentation remains
  await purgeOldPresentations(presentationId);

  // 2. Mark this presentation active
  await query(`UPDATE presentations SET is_active = true WHERE id = $1`, [presentationId]);

  // 3. Mark this version as published, others false
  await query(`UPDATE canva_versions SET is_published = false WHERE design_id = $1`, [version.design_id]);
  await query(`UPDATE canva_versions SET is_published = true, published_at = NOW() WHERE id = $1`, [versionId]);

  // 4. Update display_state
  await query(
    `UPDATE display_state
     SET active_presentation_id = $1,
         last_published_at = NOW(),
         updated_at = NOW()
     WHERE id = 1`,
    [presentationId]
  );

  // 5. Update canva_connections last_published_at
  await updateCanvaConnection({ last_published_at: new Date().toISOString() });

  // 6. Broadcast to connected LG displays via SSE
  const payload = await getCurrentDisplayPayload();
  sseBroadcaster.broadcast('PRESENTATION_PUBLISHED', payload);

  const isVideo = version.export_format === 'MP4' || version.media_type === 'video';
  return {
    success: true,
    version,
    payload,
    message: isVideo
      ? `Published Canva Native Video "${version.version_label}" live to 4K Display!`
      : `Published Canva version "${version.version_label}" (${version.slide_count} slides) to LG display!`
  };
}

/**
 * 5. Full Orchestrated Canva Sync Pipeline
 * Canva API ➔ Export (MP4 Video or PDF) ➔ Download ➔ Probe / PyMuPDF ➔ Auto-Publish ➔ Neon Postgres
 */
export async function syncCanvaDesign({ designId = 'DAHVb9pmJzQ', force = false, format = null, autoPublish = null } = {}) {
  const conn = await getCanvaConnection();
  const targetDesignId = designId || conn.design_id || 'DAHVb9pmJzQ';
  const token = await getEffectiveToken();

  if (!token) {
    throw new Error('Cannot sync: Canva API Access Token is not configured. Please paste your token in Canva Connection settings.');
  }

  // Format defaults to 'mp4' for dynamic video signage
  const requestedFormat = (format || conn.export_format || 'mp4').toLowerCase();
  const shouldAutoPublish = typeof autoPublish === 'boolean' ? autoPublish : (conn.auto_publish !== false);

  // Step 1: Query current Canva design metadata
  const metaRes = await getCanvaDesignMetadata(targetDesignId);
  if (!metaRes.success) {
    throw new Error(metaRes.error);
  }

  const design = metaRes.design;
  const canvaUpdatedAt = design.updated_at; // Unix timestamp in seconds
  const designTitle = design.title || 'Copy of Dashboard Screen 16/9';

  // Step 2: Version deduplication check
  const existingVersionRes = await query(
    `SELECT v.*, p.title, p.page_count, p.media_type, p.is_active
     FROM canva_versions v
     LEFT JOIN presentations p ON v.presentation_id = p.id
     WHERE v.design_id = $1 AND v.canva_updated_at = $2 AND UPPER(v.export_format) = $3`,
    [targetDesignId, canvaUpdatedAt, requestedFormat.toUpperCase()]
  );

  if (existingVersionRes.rows.length > 0 && !force) {
    const existing = existingVersionRes.rows[0];
    return {
      success: true,
      already_up_to_date: true,
      message: `Canva design is already up to date (Version from ${new Date(canvaUpdatedAt * 1000).toLocaleString()}).`,
      version: existing,
      presentation_id: existing.presentation_id
    };
  }

  const timestamp = Date.now();
  let presentationId = null;
  let pageCount = 1;
  let finalFormat = requestedFormat.toUpperCase();
  let finalFilePath = null;
  let slideRows = [];

  if (requestedFormat === 'mp4') {
    // -------------------------------------------------------------
    // VIDEO WORKFLOW (MP4 Export & Display Native Video)
    // -------------------------------------------------------------
    const filename = `${timestamp}_Canva_${targetDesignId}.mp4`;
    const videoPath = path.join(videosDir, filename);
    finalFilePath = videoPath;

    if (token === 'simulation') {
      console.log(`[Canva Sync (Sandbox)] Generating MP4 version ${canvaUpdatedAt} for design ${targetDesignId}...`);
      const candidateVideos = fs.readdirSync(videosDir).filter((f) => f.endsWith('.mp4'));
      if (candidateVideos.length > 0) {
        fs.copyFileSync(path.join(videosDir, candidateVideos[0]), videoPath);
      } else {
        throw new Error('Simulation sandbox requires at least one MP4 in uploads/videos/ to replicate Canva export.');
      }
    } else {
      console.log(`[Canva Sync] Creating MP4 video export job for design ${targetDesignId}...`);
      const exportJob = await createCanvaExportJob(targetDesignId, 'mp4');

      console.log(`[Canva Sync] Waiting for Canva MP4 render job ${exportJob.id}...`);
      const downloadUrl = await waitForCanvaExportJob(exportJob.id, 180);

      console.log(`[Canva Sync] Downloading rendered MP4 video from Canva CDN...`);
      await downloadCanvaFile(downloadUrl, videoPath);
    }

    // Insert Initial Presentation record
    const mediaUrl = `/uploads/videos/${filename}`;
    const presResult = await query(
      `INSERT INTO presentations
       (title, filename, original_format, media_type, page_count, duration, width, height, media_url, thumbnail_url, is_active)
       VALUES ($1, $2, 'MP4', 'video', 1, 10, 1920, 1080, $3, null, false)
       RETURNING id, title, filename, original_format, media_type, created_at`,
      [`Canva: ${designTitle}`, filename, mediaUrl]
    );

    presentationId = presResult.rows[0].id;

    // Probe video duration, width, height & extract thumbnail poster
    const thumbDir = path.join(thumbsBaseDir, presentationId);
    fs.mkdirSync(thumbDir, { recursive: true });
    const thumbFileName = 'poster.jpg';
    const thumbPath = path.join(thumbDir, thumbFileName);
    let videoDuration = 10;
    let videoWidth = 1920;
    let videoHeight = 1080;
    let thumbUrl = null;

    try {
      const probeResult = await processVideo(videoPath, thumbPath);
      videoDuration = probeResult.duration || 10;
      videoWidth = probeResult.width || 1920;
      videoHeight = probeResult.height || 1080;
      if (probeResult.thumbnail) {
        thumbUrl = `/uploads/thumbnails/${presentationId}/${thumbFileName}`;
      }
    } catch (probeErr) {
      console.warn('[Canva Sync] Video probe non-fatal note:', probeErr.message);
    }

    await query(
      `UPDATE presentations
       SET duration = $1, width = $2, height = $3, thumbnail_url = $4
       WHERE id = $5`,
      [videoDuration, videoWidth, videoHeight, thumbUrl, presentationId]
    );

  } else {
    // -------------------------------------------------------------
    // SLIDES WORKFLOW (PDF Export & PyMuPDF 4K Rasterization)
    // -------------------------------------------------------------
    const filename = `${timestamp}_Canva_${targetDesignId}.pdf`;
    const pdfPath = path.join(docsDir, filename);
    finalFilePath = pdfPath;

    if (token === 'simulation') {
      console.log(`[Canva Sync (Sandbox)] Generating PDF version ${canvaUpdatedAt} for design ${targetDesignId}...`);
      const candidatePdfs = fs.readdirSync(docsDir).filter((f) => f.endsWith('.pdf') && !f.includes('test_powerpoint'));
      if (candidatePdfs.length > 0) {
        fs.copyFileSync(path.join(docsDir, candidatePdfs[0]), pdfPath);
      } else {
        throw new Error('Simulation sandbox requires at least one PDF in uploads/docs/ to replicate Canva export.');
      }
    } else {
      console.log(`[Canva Sync] Creating PDF export job for design ${targetDesignId}...`);
      const exportJob = await createCanvaExportJob(targetDesignId, 'pdf');

      console.log(`[Canva Sync] Waiting for export job ${exportJob.id}...`);
      const downloadUrl = await waitForCanvaExportJob(exportJob.id, 120);

      console.log(`[Canva Sync] Downloading exported PDF from Canva CDN...`);
      await downloadCanvaFile(downloadUrl, pdfPath);
    }

    const presResult = await query(
      `INSERT INTO presentations
       (title, filename, original_format, media_type, page_count, is_active)
       VALUES ($1, $2, 'PDF', 'presentation', 0, false)
       RETURNING id, title, filename, original_format, media_type, created_at`,
      [`Canva: ${designTitle}`, filename]
    );

    presentationId = presResult.rows[0].id;
    const presentationSlidesDir = path.join(slidesBaseDir, presentationId);

    console.log(`[Canva Sync] Rendering slides via PyMuPDF...`);
    const renderResult = await renderPdfToSlides(pdfPath, presentationSlidesDir);
    pageCount = renderResult.page_count;

    await query('UPDATE presentations SET page_count = $1 WHERE id = $2', [pageCount, presentationId]);

    for (const slide of renderResult.slides) {
      const relativeImagePath = `/uploads/slides/${presentationId}/${slide.filename}`;
      const sRes = await query(
        `INSERT INTO slides (presentation_id, slide_index, image_path, width, height)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, slide_index, image_path, width, height, created_at`,
        [presentationId, slide.slide_index, relativeImagePath, slide.width, slide.height]
      );
      slideRows.push(sRes.rows[0]);
    }

    if (slideRows.length > 0) {
      const thumbnailUrl = slideRows[0].image_path;
      await query('UPDATE presentations SET thumbnail_url = $1 WHERE id = $2', [thumbnailUrl, presentationId]);
    }
  }

  // Step 7: Record Version in canva_versions
  const versionLabel = `v${new Date(canvaUpdatedAt * 1000).toISOString().replace(/[:.]/g, '-').slice(0, 19)}`;
  const versionRes = await query(
    `INSERT INTO canva_versions
     (design_id, canva_updated_at, version_label, export_format, presentation_id, slide_count, file_path, status, is_published, synced_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'processed', false, NOW())
     ON CONFLICT (design_id, canva_updated_at)
     DO UPDATE SET presentation_id = EXCLUDED.presentation_id, export_format = EXCLUDED.export_format, slide_count = EXCLUDED.slide_count, file_path = EXCLUDED.file_path, status = 'processed', synced_at = NOW()
     RETURNING *`,
    [targetDesignId, canvaUpdatedAt, versionLabel, finalFormat, presentationId, pageCount, finalFilePath]
  );

  const versionRecord = versionRes.rows[0];

  // Step 8: Update canva_connections tracking
  await updateCanvaConnection({
    design_title: designTitle,
    last_canva_updated_at: canvaUpdatedAt,
    last_synced_at: new Date().toISOString(),
    status: 'connected'
  });

  // Step 9: Automatically Publish to Live Display if enabled
  let publishedPayload = null;
  if (shouldAutoPublish) {
    try {
      const pubRes = await publishCanvaVersion(versionRecord.id);
      publishedPayload = pubRes.payload;
      console.log(`[Canva Sync] ✅ Automatically published new Canva version ${versionLabel} (${finalFormat}) to live display!`);
    } catch (pubErr) {
      console.warn(`[Canva Sync] Auto-publish notice: ${pubErr.message}`);
    }
  }

  // Broadcast sync event to Admin Panel
  sseBroadcaster.broadcast('CANVA_SYNC_COMPLETED', {
    version: versionRecord,
    presentation_id: presentationId,
    slide_count: pageCount,
    export_format: finalFormat,
    media_type: finalFormat === 'MP4' ? 'video' : 'presentation',
    is_published: Boolean(publishedPayload),
    title: designTitle
  });

  return {
    success: true,
    already_up_to_date: false,
    message: publishedPayload
      ? `Successfully synchronized & published Canva ${finalFormat} version ${versionLabel} live to Display!`
      : `Successfully synchronized Canva ${finalFormat} version: "${designTitle}"`,
    version: versionRecord,
    presentation_id: presentationId,
    is_published: Boolean(publishedPayload),
    slides: slideRows
  };
}

/**
 * Returns all synced Canva versions
 */
export async function getCanvaVersions(designId = 'DAHVb9pmJzQ') {
  const res = await query(
    `SELECT v.*, p.title AS presentation_title, p.thumbnail_url, p.is_active, p.media_type, p.media_url, p.duration, p.width, p.height
     FROM canva_versions v
     LEFT JOIN presentations p ON v.presentation_id = p.id
     WHERE v.design_id = $1
     ORDER BY v.canva_updated_at DESC`,
    [designId]
  );
  return res.rows;
}
