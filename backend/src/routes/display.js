import express from 'express';
import { query } from '../config/db.js';
import { sseBroadcaster } from '../services/sseBroadcaster.js';

const router = express.Router();

/**
 * Helper to fetch full current display payload
 */
export async function getCurrentDisplayPayload() {
  const stateResult = await query(
    `SELECT d.id, d.is_paused, d.rotation_interval, d.active_presentation_id, d.last_published_at,
            p.title AS active_title, p.original_format, p.media_type, p.page_count,
            p.duration, p.width, p.height, p.media_url, p.thumbnail_url
     FROM display_state d
     LEFT JOIN presentations p ON d.active_presentation_id = p.id
     WHERE d.id = 1`
  );

  const state = stateResult.rows[0] || {
    is_paused: false,
    rotation_interval: 10,
    active_presentation_id: null
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

  return {
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
      last_published_at: state.last_published_at
    },
    slides,
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

    // 2. Mark this presentation active and all others inactive
    await query(`UPDATE presentations SET is_active = false WHERE id != $1`, [presentation_id]);
    await query(`UPDATE presentations SET is_active = true WHERE id = $1`, [presentation_id]);

    // 3. Update display_state
    await query(
      `UPDATE display_state
       SET active_presentation_id = $1,
           last_published_at = NOW(),
           updated_at = NOW()
       WHERE id = 1`,
      [presentation_id]
    );

    const payload = await getCurrentDisplayPayload();

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

    const payload = await getCurrentDisplayPayload();
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
           updated_at = NOW()
       WHERE id = 1`
    );

    const payload = await getCurrentDisplayPayload();
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

    const payload = await getCurrentDisplayPayload();
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
 * GET /api/display/stream
 * Server-Sent Events (SSE) stream for real-time live display synchronization
 */
router.get('/stream', async (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });

  // Register client
  sseBroadcaster.addClient(res);

  // Send initial state immediately
  try {
    const initialPayload = await getCurrentDisplayPayload();
    res.write(`event: INIT_STATE\ndata: ${JSON.stringify(initialPayload)}\n\n`);
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
