import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROBE_SCRIPT = path.resolve(__dirname, '../../scripts/probe_video.py');

/**
 * Probes video using FFprobe and extracts thumbnail using FFmpeg.
 * @param {string} videoPath - Absolute path to video file
 * @param {string} thumbnailPath - Absolute path for output thumbnail image
 * @returns {Promise<{width: number, height: number, duration: number, thumbnail: string}>}
 */
export function processVideo(videoPath, thumbnailPath) {
  return new Promise((resolve, reject) => {
    const python = spawn('python', [PROBE_SCRIPT, videoPath, thumbnailPath]);

    let stdoutData = '';
    let stderrData = '';

    python.stdout.on('data', (chunk) => {
      stdoutData += chunk.toString();
    });

    python.stderr.on('data', (chunk) => {
      stderrData += chunk.toString();
    });

    python.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`Video probe failed with exit code ${code}: ${stderrData || stdoutData}`));
      }

      try {
        const result = JSON.parse(stdoutData.trim());
        if (!result.success) {
          return reject(new Error(result.error || 'Unknown error probing video'));
        }
        resolve(result);
      } catch (err) {
        reject(new Error(`Failed to parse video probe output: ${err.message}. Raw output: ${stdoutData}`));
      }
    });

    python.on('error', (err) => {
      reject(new Error(`Failed to start video probe process: ${err.message}`));
    });
  });
}
