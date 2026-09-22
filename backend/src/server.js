import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import presentationsRouter from './routes/presentations.js';
import displayRouter from './routes/display.js';
import { pool } from './config/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const app = express();
const PORT = process.env.PORT || 8000;

// Enable CORS for frontend
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static uploaded slides and assets
const uploadsDir = path.resolve(__dirname, '../uploads');
app.use('/uploads', express.static(uploadsDir));

// API Routes
app.use('/api/presentations', presentationsRouter);
app.use('/api/display', displayRouter);

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
      presentations: '/api/presentations'
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

const server = app.listen(PORT, async () => {
  console.log(`====================================================`);
  console.log(`  Sales Display Backend Server Running`);
  console.log(`  Port: http://localhost:${PORT}`);
  console.log(`  Display API: http://localhost:${PORT}/api/display/current`);
  console.log(`  SSE Stream:  http://localhost:${PORT}/api/display/stream`);
  console.log(`====================================================`);

  try {
    await runMigrations();
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
