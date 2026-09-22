import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { query } from '../config/db.js';
import { renderPdfToSlides } from '../services/pdfRenderer.js';
import { renderPptxToSlides } from '../services/pptxRenderer.js';
import { processVideo } from '../services/videoProcessor.js';
import { sseBroadcaster } from '../services/sseBroadcaster.js';
import { getCurrentDisplayPayload } from './display.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

const uploadsBaseDir = path.resolve(__dirname, '../../uploads');
const docsDir = path.join(uploadsBaseDir, 'docs');
const videosDir = path.join(uploadsBaseDir, 'videos');
const slidesBaseDir = path.join(uploadsBaseDir, 'slides');
const thumbsBaseDir = path.join(uploadsBaseDir, 'thumbnails');

[docsDir, videosDir, slidesBaseDir, thumbsBaseDir].forEach((dir) => {
  fs.mkdirSync(dir, { recursive: true });
});

const SUPPORTED_DOC_EXTS = ['.pdf', '.pptx'];
const SUPPORTED_VIDEO_EXTS = ['.mp4', '.mov', '.webm', '.m4v', '.mkv'];

// Configure multer storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (SUPPORTED_VIDEO_EXTS.includes(ext)) {
      cb(null, videosDir);
    } else {
      cb(null, docsDir);
    }
  },
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const sanitized = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${timestamp}_${sanitized}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 250 * 1024 * 1024 }, // 250MB limit
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if ([...SUPPORTED_DOC_EXTS, ...SUPPORTED_VIDEO_EXTS].includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported format (${ext}). Supported formats are PDF, PPTX, MP4, MOV, and WebM.`));
    }
  }
});

/**
 * Purges all older presentations, slide folders, thumbnails, and media files.
 * Keeps only the specified presentationId (or cleans all if null).
 */
export async function purgeOldPresentations(keepPresentationId = null) {
  try {
    let sql = 'SELECT id, filename, media_type FROM presentations';
    const params = [];
    if (keepPresentationId) {
      sql += ' WHERE id != $1';
      params.push(keepPresentationId);
    }
    const res = await query(sql, params);

    for (const row of res.rows) {
      // 1. Remove slide image directory
      const slideDir = path.join(slidesBaseDir, row.id);
      if (fs.existsSync(slideDir)) {
        try { fs.rmSync(slideDir, { recursive: true, force: true }); } catch {}
      }

      // 2. Remove thumbnail directory
      const thumbDir = path.join(thumbsBaseDir, row.id);
      if (fs.existsSync(thumbDir)) {
        try { fs.rmSync(thumbDir, { recursive: true, force: true }); } catch {}
      }

      // 3. Remove source document or video file
      if (row.filename) {
        const docPath = path.join(docsDir, row.filename);
        if (fs.existsSync(docPath)) try { fs.unlinkSync(docPath); } catch {}
        const videoPath = path.join(videosDir, row.filename);
        if (fs.existsSync(videoPath)) try { fs.unlinkSync(videoPath); } catch {}
      }

      // 4. Remove database records
      try { await query('DELETE FROM canva_versions WHERE presentation_id = $1', [row.id]); } catch {}
      await query('DELETE FROM slides WHERE presentation_id = $1', [row.id]);
      await query('DELETE FROM presentations WHERE id = $1', [row.id]);
    }

    // 5. Sweep disk for any orphan slide and thumbnail directories
    if (fs.existsSync(slidesBaseDir)) {
      try {
        const slideFolders = fs.readdirSync(slidesBaseDir);
        for (const folder of slideFolders) {
          if (keepPresentationId && folder === keepPresentationId) continue;
          const target = path.join(slidesBaseDir, folder);
          try { fs.rmSync(target, { recursive: true, force: true }); } catch {}
        }
      } catch {}
    }

    if (fs.existsSync(thumbsBaseDir)) {
      try {
        const thumbFolders = fs.readdirSync(thumbsBaseDir);
        for (const folder of thumbFolders) {
          if (keepPresentationId && folder === keepPresentationId) continue;
          const target = path.join(thumbsBaseDir, folder);
          try { fs.rmSync(target, { recursive: true, force: true }); } catch {}
        }
      } catch {}
    }

    // 6. Sweep disk for any orphan docs or video files not belonging to the kept presentation
    let keepFilename = null;
    if (keepPresentationId) {
      const keepRes = await query('SELECT filename FROM presentations WHERE id = $1', [keepPresentationId]);
      keepFilename = keepRes.rows[0]?.filename || null;
    }

    if (fs.existsSync(docsDir)) {
      try {
        const docFiles = fs.readdirSync(docsDir);
        for (const file of docFiles) {
          if (keepFilename && file === keepFilename) continue;
          try { fs.unlinkSync(path.join(docsDir, file)); } catch {}
        }
      } catch {}
    }

    if (fs.existsSync(videosDir)) {
      try {
        const videoFiles = fs.readdirSync(videosDir);
        for (const file of videoFiles) {
          if (keepFilename && file === keepFilename) continue;
          try { fs.unlinkSync(path.join(videosDir, file)); } catch {}
        }
      } catch {}
    }

    if (res.rows.length > 0) {
      console.log(`🧹 Auto-purged ${res.rows.length} old presentation(s) and their disk files.`);
    }
  } catch (err) {
    console.error('Error during old presentations cleanup:', err);
  }
}

/**
 * POST /api/presentations/upload
 * Unified multi-format ingestion endpoint for PDF, PPTX, and MP4/MOV/WebM
 */
router.post('/upload', upload.single('presentation'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No presentation or video file uploaded.' });
  }

  const filePath = req.file.path;
  const originalName = req.file.originalname;
  const ext = path.extname(originalName).toLowerCase();
  const title = req.body.title || originalName.replace(/\.[^/.]+$/, '');

  let originalFormat = 'PDF';
  let mediaType = 'presentation';

  if (ext === '.pptx') {
    originalFormat = 'PPTX';
    mediaType = 'presentation';
  } else if (SUPPORTED_VIDEO_EXTS.includes(ext)) {
    originalFormat = ext.replace('.', '').toUpperCase();
    mediaType = 'video';
  }

  let presentationId = null;

  try {
    // 1. Create initial presentation record
    const presResult = await query(
      `INSERT INTO presentations
       (title, filename, original_format, media_type, page_count, is_active)
       VALUES ($1, $2, $3, $4, 0, false)
       RETURNING id, title, filename, original_format, media_type, created_at`,
      [title, req.file.filename, originalFormat, mediaType]
    );

    const presentation = presResult.rows[0];
    presentationId = presentation.id;

    let slideRows = [];
    let pageCount = 0;
    let videoDuration = 0;
    let videoWidth = 1920;
    let videoHeight = 1080;
    let mediaUrl = null;
    let thumbnailUrl = null;

    if (mediaType === 'presentation') {
      // Presentation handling (PDF or PPTX) -> Normalize into 1080p slide frames
      const presentationSlidesDir = path.join(slidesBaseDir, presentationId);

      let renderResult;
      if (originalFormat === 'PDF') {
        renderResult = await renderPdfToSlides(filePath, presentationSlidesDir);
      } else {
        renderResult = await renderPptxToSlides(filePath, presentationSlidesDir);
      }

      pageCount = renderResult.page_count;

      // Update presentation page_count
      await query(
        `UPDATE presentations SET page_count = $1 WHERE id = $2`,
        [pageCount, presentationId]
      );

      // Insert slide records
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
        thumbnailUrl = slideRows[0].image_path;
        await query(`UPDATE presentations SET thumbnail_url = $1 WHERE id = $2`, [thumbnailUrl, presentationId]);
      }

    } else if (mediaType === 'video') {
      // Video handling (MP4 / MOV / WebM)
      const thumbDir = path.join(thumbsBaseDir, presentationId);
      const thumbFileName = 'poster.jpg';
      const thumbPath = path.join(thumbDir, thumbFileName);

      const probeResult = await processVideo(filePath, thumbPath);
      videoDuration = probeResult.duration || 10;
      videoWidth = probeResult.width || 1920;
      videoHeight = probeResult.height || 1080;
      pageCount = 1;
      mediaUrl = `/uploads/videos/${req.file.filename}`;
      thumbnailUrl = probeResult.thumbnail ? `/uploads/thumbnails/${presentationId}/${thumbFileName}` : null;

      await query(
        `UPDATE presentations
         SET duration = $1, width = $2, height = $3, media_url = $4, thumbnail_url = $5, page_count = 1
         WHERE id = $6`,
        [videoDuration, videoWidth, videoHeight, mediaUrl, thumbnailUrl, presentationId]
      );
    }

    // 1. Automatically purge all older presentations, slide folders, and media files
    await purgeOldPresentations(presentationId);

    // 2. Automatically activate and publish the new presentation to the live display
    await query(`UPDATE presentations SET is_active = true WHERE id = $1`, [presentationId]);
    await query(
      `UPDATE display_state
       SET active_presentation_id = $1,
           last_published_at = NOW(),
           updated_at = NOW()
       WHERE id = 1`,
      [presentationId]
    );

    // 3. Broadcast real-time event to all connected screens
    try {
      const payload = await getCurrentDisplayPayload();
      sseBroadcaster.broadcast('PRESENTATION_PUBLISHED', payload);
    } catch (sseErr) {
      console.warn('SSE broadcast error:', sseErr.message);
    }

    res.status(201).json({
      success: true,
      message: `Successfully processed & published ${originalFormat}! Previous presentations removed.`,
      presentation: {
        id: presentationId,
        title,
        filename: req.file.filename,
        original_format: originalFormat,
        media_type: mediaType,
        page_count: pageCount,
        duration: videoDuration,
        width: videoWidth,
        height: videoHeight,
        media_url: mediaUrl,
        thumbnail_url: thumbnailUrl,
        slides: slideRows
      }
    });
  } catch (err) {
    console.error('Error processing presentation upload:', err);

    // Clean up partial DB records on error
    if (presentationId) {
      try {
        await query(`DELETE FROM slides WHERE presentation_id = $1`, [presentationId]);
        await query(`DELETE FROM presentations WHERE id = $1`, [presentationId]);
      } catch (cleanErr) {
        console.error('Failed to cleanup aborted presentation:', cleanErr);
      }
    }

    // Clean up failed file
    if (filePath && fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch {}
    }

    res.status(500).json({ error: `Failed to process upload: ${err.message}` });
  }
});

/**
 * GET /api/presentations
 * Lists all presentations
 */
router.get('/', async (req, res) => {
  try {
    const result = await query(
      `SELECT p.id, p.title, p.filename, p.original_format, p.media_type,
              p.page_count, p.duration, p.width, p.height, p.media_url,
              p.thumbnail_url, p.is_active, p.created_at,
              COUNT(s.id) AS total_slides_recorded
       FROM presentations p
       LEFT JOIN slides s ON p.id = s.presentation_id
       GROUP BY p.id
       ORDER BY p.created_at DESC`
    );
    res.json({ presentations: result.rows });
  } catch (err) {
    console.error('Error fetching presentations:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/presentations/:id
 * Fetches specific presentation with all slides
 */
router.get('/:id', async (req, res) => {
  try {
    const presResult = await query(
      `SELECT * FROM presentations WHERE id = $1`,
      [req.params.id]
    );

    if (presResult.rows.length === 0) {
      return res.status(404).json({ error: 'Presentation not found.' });
    }

    const slidesResult = await query(
      `SELECT id, slide_index, image_path, width, height FROM slides
       WHERE presentation_id = $1
       ORDER BY slide_index ASC`,
      [req.params.id]
    );

    res.json({
      presentation: presResult.rows[0],
      slides: slidesResult.rows
    });
  } catch (err) {
    console.error('Error fetching presentation details:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/presentations/:id
 * Explicitly delete a presentation and all associated slide/video files
 */
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const check = await query('SELECT * FROM presentations WHERE id = $1', [id]);
    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'Presentation not found.' });
    }
    const row = check.rows[0];

    // 1. Remove slide folder
    const slideDir = path.join(slidesBaseDir, row.id);
    if (fs.existsSync(slideDir)) {
      try { fs.rmSync(slideDir, { recursive: true, force: true }); } catch {}
    }

    // 2. Remove thumbnail folder
    const thumbDir = path.join(thumbsBaseDir, row.id);
    if (fs.existsSync(thumbDir)) {
      try { fs.rmSync(thumbDir, { recursive: true, force: true }); } catch {}
    }

    // 3. Remove source document or video
    if (row.filename) {
      const docPath = path.join(docsDir, row.filename);
      if (fs.existsSync(docPath)) try { fs.unlinkSync(docPath); } catch {}
      const videoPath = path.join(videosDir, row.filename);
      if (fs.existsSync(videoPath)) try { fs.unlinkSync(videoPath); } catch {}
    }

    // 4. Remove database records
    await query('DELETE FROM slides WHERE presentation_id = $1', [id]);
    await query('DELETE FROM presentations WHERE id = $1', [id]);

    // If active, clear display_state
    await query(
      `UPDATE display_state
       SET active_presentation_id = NULL,
           last_published_at = NOW(),
           updated_at = NOW()
       WHERE active_presentation_id = $1`,
      [id]
    );

    try {
      const payload = await getCurrentDisplayPayload();
      sseBroadcaster.broadcast('PRESENTATION_PUBLISHED', payload);
    } catch {}

    res.json({ success: true, message: 'Presentation deleted successfully.' });
  } catch (err) {
    console.error('Error deleting presentation:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
