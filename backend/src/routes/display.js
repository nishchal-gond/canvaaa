import express from 'express';
import { query } from '../config/db.js';
import { sseBroadcaster } from '../services/sseBroadcaster.js';
import { purgeOldPresentations } from './presentations.js';

const router = express.Router();

// High-efficiency in-memory cache to save Neon queries and prevent 24/7 database wakeups
let cachedDisplayPayload = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 15000; // 15-second cache TTL for read operations

export function invalidateDisplayCache() {
  cachedDisplayPayload = null;
  cacheTimestamp = 0;
}

/**
 * Helper to fetch full current display payload (with in-memory cache to optimize Neon & Render usage)
 */
export async function getCurrentDisplayPayload(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && cachedDisplayPayload && (now - cacheTimestamp < CACHE_TTL_MS)) {
    return {
      ...cachedDisplayPayload,
      connected_displays: sseBroadcaster.getClientCount()
    };
  }

  const stateResult = await query(
    `SELECT d.id, d.is_paused, d.rotation_interval, d.active_presentation_id, d.last_published_at,
            COALESCE(d.schedule_enabled, true) AS schedule_enabled,
            COALESCE(d.schedule_start_time, '06:00') AS schedule_start_time,
            COALESCE(d.schedule_end_time, '19:00') AS schedule_end_time,
            COALESCE(d.last_slide_index, 0) AS last_slide_index,
            COALESCE(d.is_scheduled_sleep, false) AS is_scheduled_sleep,
            p.title AS active_title, p.original_format, p.media_type, p.page_count,
            p.duration, p.width, p.height, p.media_url, p.thumbnail_url
     FROM display_state d
     LEFT JOIN presentations p ON d.active_presentation_id = p.id
     WHERE d.id = 1`
  );

  const state = stateResult.rows[0] || {
    is_paused: false,
    rotation_interval: 10,
    active_presentation_id: null,
    schedule_enabled: true,
    schedule_start_time: '06:00',
    schedule_end_time: '19:00',
    last_slide_index: 0,
    is_scheduled_sleep: false
  };

  let slides = [];
  if (state.active_presentation_id && state.media_type !== 'video') {
    const slidesResult = await query(
      `SELECT id, slide_index, image_path, width, height
       FROM slides
       WHERE presentation_id = $1
       ORDER BY slide_index ASC`,
      [state.active_presentation_id]
    );
    slides = slidesResult.rows;
  }

  cachedDisplayPayload = {
    state: {
      is_paused: state.is_paused,
      rotation_interval: state.rotation_interval,
      active_presentation_id: state.active_presentation_id,
      active_title: state.active_title,
      original_format: state.original_format,
      media_type: state.media_type || 'presentation',
      page_count: state.page_count,
      duration: state.duration,
      width: state.width,
      height: state.height,
      media_url: state.media_url,
      thumbnail_url: state.thumbnail_url,
      last_published_at: state.last_published_at,
      schedule_enabled: Boolean(state.schedule_enabled),
      schedule_start_time: state.schedule_start_time || '06:00',
      schedule_end_time: state.schedule_end_time || '19:00',
      last_slide_index: parseInt(state.last_slide_index, 10) || 0,
      is_scheduled_sleep: Boolean(state.is_scheduled_sleep)
    },
    slides
  };
  cacheTimestamp = Date.now();

  return {
    ...cachedDisplayPayload,
    connected_displays: sseBroadcaster.getClientCount()
  };
}

/**
 * GET /api/display/current
 * Returns current display presentation and pause status
 */
router.get('/current', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  try {
    const payload = await getCurrentDisplayPayload();
    res.json(payload);
  } catch (err) {
    console.error('Error fetching current display state:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/display/publish
 * Sets active presentation and broadcasts update to all connected /display players
 */
router.post('/publish', async (req, res) => {
  const { presentation_id } = req.body;
  if (!presentation_id) {
    return res.status(400).json({ error: 'presentation_id is required' });
  }

  try {
    // 1. Verify presentation exists
    const presResult = await query(`SELECT * FROM presentations WHERE id = $1`, [presentation_id]);
    if (presResult.rows.length === 0) {
      return res.status(404).json({ error: 'Presentation not found.' });
    }

    // 2. Automatically purge all older presentations and disk files
    await purgeOldPresentations(presentation_id);

    // 3. Mark this presentation active
    await query(`UPDATE presentations SET is_active = true WHERE id = $1`, [presentation_id]);

    // 4. Update display_state
    await query(
      `UPDATE display_state
       SET active_presentation_id = $1,
           last_published_at = NOW(),
           updated_at = NOW()
       WHERE id = 1`,
      [presentation_id]
    );

    const payload = await getCurrentDisplayPayload(true);

    // 4. Broadcast to connected displays
    sseBroadcaster.broadcast('PRESENTATION_PUBLISHED', payload);

    res.json({
      success: true,
      message: 'Presentation successfully published to display system.',
      payload
    });
  } catch (err) {
    console.error('Error publishing presentation:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/display/pause
 * Manual operator pause: freezes LG display on current view / video, prevents updates
 */
router.post('/pause', async (req, res) => {
  try {
    await query(
      `UPDATE display_state
       SET is_paused = true,
           updated_at = NOW()
       WHERE id = 1`
    );

    const payload = await getCurrentDisplayPayload(true);
    sseBroadcaster.broadcast('DISPLAY_STATE_CHANGED', payload);

    res.json({
      success: true,
      message: 'Display rotation and auto-updates PAUSED.',
      payload
    });
  } catch (err) {
    console.error('Error pausing display:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/display/continue
 * Manual operator continue: resumes automated display rotation / video playback
 */
router.post('/continue', async (req, res) => {
  try {
    await query(
      `UPDATE display_state
       SET is_paused = false,
           is_scheduled_sleep = false,
           updated_at = NOW()
       WHERE id = 1`
    );

    const payload = await getCurrentDisplayPayload(true);
    sseBroadcaster.broadcast('DISPLAY_STATE_CHANGED', payload);

    res.json({
      success: true,
      message: 'Display rotation RESUMED with latest published content.',
      payload
    });
  } catch (err) {
    console.error('Error resuming display:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/display/interval
 * Sets slide rotation interval (in seconds)
 */
router.post('/interval', async (req, res) => {
  const { rotation_interval } = req.body;
  const interval = parseInt(rotation_interval, 10);
  if (isNaN(interval) || interval < 1 || interval > 300) {
    return res.status(400).json({ error: 'rotation_interval must be between 1 and 300 seconds.' });
  }

  try {
    await query(
      `UPDATE display_state
       SET rotation_interval = $1,
           updated_at = NOW()
       WHERE id = 1`,
      [interval]
    );

    const payload = await getCurrentDisplayPayload(true);
    sseBroadcaster.broadcast('DISPLAY_STATE_CHANGED', payload);

    res.json({
      success: true,
      message: `Rotation interval updated to ${interval} seconds.`,
      rotation_interval: interval,
      payload
    });
  } catch (err) {
    console.error('Error setting rotation interval:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/display/navigate
 * Manual skip / slide navigation on the fly (next, prev, or specific slide index)
 */
router.post('/navigate', async (req, res) => {
  const { action, slide_index } = req.body;
  const targetIndex = typeof slide_index === 'number' ? slide_index : parseInt(slide_index, 10);

  try {
    if (!isNaN(targetIndex) && targetIndex >= 0) {
      await query(
        `UPDATE display_state
         SET last_slide_index = $1,
             updated_at = NOW()
         WHERE id = 1`,
        [targetIndex]
      );
    }

    const payload = await getCurrentDisplayPayload(true);

    // Broadcast immediate on-the-fly navigation event to all connected displays
    sseBroadcaster.broadcast('SLIDE_NAVIGATE', {
      action: action || 'goto',
      slide_index: targetIndex,
      source: 'operator'
    });

    res.json({
      success: true,
      message: `Navigated to slide ${targetIndex} on the fly.`,
      action,
      slide_index: targetIndex,
      payload
    });
  } catch (err) {
    console.error('Error navigating slide:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/display/schedule
 * Configures office operating hours & night power-saving sleep schedule
 */
router.post('/schedule', async (req, res) => {
  const {
    schedule_enabled,
    schedule_start_time,
    schedule_end_time,
    is_scheduled_sleep
  } = req.body;

  try {
    const curr = await query(
      'SELECT schedule_enabled, schedule_start_time, schedule_end_time, is_scheduled_sleep FROM display_state WHERE id = 1'
    );
    const existing = curr.rows[0] || {};

    const isEnabled = typeof schedule_enabled === 'boolean' ? schedule_enabled : (existing.schedule_enabled !== false);
    const startTime = schedule_start_time || existing.schedule_start_time || '06:00';
    const endTime = schedule_end_time || existing.schedule_end_time || '19:00';
    const isSleep = typeof is_scheduled_sleep === 'boolean' ? is_scheduled_sleep : Boolean(existing.is_scheduled_sleep);

    await query(
      `UPDATE display_state
       SET schedule_enabled = $1,
           schedule_start_time = $2,
           schedule_end_time = $3,
           is_scheduled_sleep = $4,
           updated_at = NOW()
       WHERE id = 1`,
      [isEnabled, startTime, endTime, isSleep]
    );

    const payload = await getCurrentDisplayPayload(true);
    sseBroadcaster.broadcast('SCHEDULE_CHANGED', payload);

    res.json({
      success: true,
      message: 'Display schedule configuration updated successfully.',
      schedule: {
        schedule_enabled: isEnabled,
        schedule_start_time: startTime,
        schedule_end_time: endTime,
        is_scheduled_sleep: isSleep
      },
      payload
    });
  } catch (err) {
    console.error('Error updating display schedule:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/display/save-slide
 * Records current slide index (e.g. before night sleep or on slide transition)
 */
router.post('/save-slide', async (req, res) => {
  const { slide_index } = req.body;
  const idx = parseInt(slide_index, 10);
  if (isNaN(idx) || idx < 0) {
    return res.status(400).json({ error: 'Valid slide_index is required' });
  }

  try {
    await query(
      `UPDATE display_state
       SET last_slide_index = $1,
           updated_at = NOW()
       WHERE id = 1`,
      [idx]
    );

    if (cachedDisplayPayload?.state) {
      cachedDisplayPayload.state.last_slide_index = idx;
    }

    res.json({ success: true, saved_slide_index: idx });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/display/stream
 * Server-Sent Events (SSE) stream for real-time live display synchronization
 */
router.get('/stream', async (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
    'Access-Control-Allow-Origin': '*'
  });
  if (res.flushHeaders) res.flushHeaders();

  // Register client
  sseBroadcaster.addClient(res);

  // Send initial state immediately
  try {
    const initialPayload = await getCurrentDisplayPayload();
    res.write(`event: INIT_STATE\ndata: ${JSON.stringify(initialPayload)}\n\n`);
    if (res.flush) res.flush();
  } catch (err) {
    console.error('Error sending initial SSE payload:', err);
  }

  // Periodic heartbeat every 15s
  const heartbeatTimer = setInterval(() => {
    try {
      res.write(': heartbeat\n\n');
    } catch {
      clearInterval(heartbeatTimer);
    }
  }, 15000);

  req.on('close', () => {
    clearInterval(heartbeatTimer);
  });
});

export default router;
