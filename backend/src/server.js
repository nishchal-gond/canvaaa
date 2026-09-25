import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import fs from 'fs';
import presentationsRouter from './routes/presentations.js';
import displayRouter from './routes/display.js';
import canvaRouter from './routes/canva.js';
import { startCanvaSyncWorker } from './services/canvaSyncWorker.js';
import { pool } from './config/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const app = express();
const PORT = process.env.PORT || 8000;

// Restore permanent bundled slide assets if container restarted on Render
const permSlidesDir = path.resolve(__dirname, '../permanent_slides');
const targetSlidesDir = path.resolve(__dirname, '../uploads/slides');
if (fs.existsSync(permSlidesDir)) {
  try {
    fs.mkdirSync(targetSlidesDir, { recursive: true });
    fs.cpSync(permSlidesDir, targetSlidesDir, { recursive: true, force: true });
    console.log('✅ Permanent cloud presentation slides restored to /uploads/slides');
  } catch (err) {
    console.warn('Permanent slides copy warning:', err.message);
  }
}

// Trust reverse proxy (Render / Cloudflare) for HTTPS protocol detection
app.set('trust proxy', 1);

// Enable CORS for frontend
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve static uploaded slides and assets
const uploadsDir = path.resolve(__dirname, '../uploads');
app.use('/uploads', express.static(uploadsDir));

// API Routes
app.use('/api/presentations', presentationsRouter);
app.use('/api/display', displayRouter);
app.use('/api/canva', canvaRouter);

import { runMigrations } from './db/migrate.js';

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    service: 'LPH Sales Display Commercial Backend',
    status: 'online',
    version: '1.0.0',
    endpoints: {
      health: '/api/health',
      display: '/api/display/current',
      stream: '/api/display/stream',
      presentations: '/api/presentations',
      canva: '/api/canva/status'
    }
  });
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'sales-display-backend'
  });
});

// Admin Password Verification
app.post('/api/admin/verify', (req, res) => {
  const { password } = req.body || {};
  const masterPassword = (process.env.ADMIN_PASSWORD || 'lph2026').trim();
  if (password && String(password).trim() === masterPassword) {
    return res.json({ success: true, token: 'lph_admin_authenticated' });
  }
  return res.status(401).json({ success: false, error: 'Incorrect password' });
});

const server = app.listen(PORT, async () => {
  console.log(`====================================================`);
  console.log(`  Sales Display Backend Server Running`);
  console.log(`  Port: http://localhost:${PORT}`);
  console.log(`  Display API: http://localhost:${PORT}/api/display/current`);
  console.log(`  SSE Stream:  http://localhost:${PORT}/api/display/stream`);
  console.log(`====================================================`);

  try {
    await runMigrations();
    startCanvaSyncWorker(30);
  } catch (err) {
    console.warn('Startup migration check warning:', err.message);
  }
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\nShutting down server...');
  server.close(async () => {
    await pool.end();
    console.log('Database pool closed. Exiting process.');
    process.exit(0);
  });
});

export default app;
