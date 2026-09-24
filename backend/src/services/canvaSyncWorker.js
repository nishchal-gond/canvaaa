import { query } from '../config/db.js';
import {
  getCanvaConnection,
  getCanvaDesignMetadata,
  syncCanvaDesign,
  getActiveSyncState
} from './canvaService.js';
import { sseBroadcaster } from './sseBroadcaster.js';

let workerInterval = null;
let isSyncing = false;

/**
 * Executes a single check cycle for the Canva Auto-Sync background worker
 */
async function checkCanvaForUpdates() {
  if (isSyncing || getActiveSyncState().is_running) return;

  // Night Power-Saving & Scale-to-Zero: Skip background polling outside office hours (19:00 - 06:00)
  // This allows Neon Postgres to sleep (scale to zero) overnight with zero compute charges!
  const currentHour = new Date().getHours();
  if (currentHour >= 19 || currentHour < 6) {
    return;
  }

  try {
    const conn = await getCanvaConnection();
    if (!conn.auto_sync_enabled || !conn.has_token) {
      return;
    }

    const designId = conn.design_id || 'DAHVb9pmJzQ';
    const lastUpdatedAt = conn.last_canva_updated_at || 0;

    // 1. Lightweight metadata check (1 API call)
    const metaRes = await getCanvaDesignMetadata(designId);
    if (!metaRes.success || !metaRes.design) {
      return;
    }

    const currentUpdatedAt = parseInt(metaRes.design.updated_at, 10);
    const lastUpdatedNum = parseInt(lastUpdatedAt, 10) || 0;

    // 2. If Canva design has changed since last sync
    if (currentUpdatedAt > lastUpdatedNum) {
      console.log(`[AutoSync] New Canva version detected! Current: ${currentUpdatedAt}, Last: ${lastUpdatedNum}. Syncing...`);
      isSyncing = true;

      try {
        const syncResult = await syncCanvaDesign({
          designId,
          format: conn.export_format || 'mp4',
          autoPublish: conn.auto_publish !== false
        });
        console.log(`[AutoSync] ✅ Automated sync successful: ${syncResult.message}`);

        sseBroadcaster.broadcast('CANVA_AUTO_SYNCED', {
          design_id: designId,
          version: syncResult.version,
          presentation_id: syncResult.presentation_id,
          is_published: syncResult.is_published
        });
      } finally {
        isSyncing = false;
      }
    }
  } catch (err) {
    isSyncing = false;
    console.warn('[AutoSync] Background check warning:', err.message);
  }
}

/**
 * Starts the Canva background synchronization polling worker
 */
export function startCanvaSyncWorker(defaultIntervalSec = 30) {
  if (workerInterval) {
    clearInterval(workerInterval);
  }

  console.log(`[AutoSync] Starting Canva background sync worker (polling every ${defaultIntervalSec}s)...`);

  // Initial check shortly after startup
  setTimeout(checkCanvaForUpdates, 5000);

  workerInterval = setInterval(checkCanvaForUpdates, defaultIntervalSec * 1000);
}

/**
 * Stops the background worker
 */
export function stopCanvaSyncWorker() {
  if (workerInterval) {
    clearInterval(workerInterval);
    workerInterval = null;
    console.log('[AutoSync] Canva background sync worker stopped.');
  }
}
