import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const RENDER_SCRIPT = path.resolve(__dirname, '../../scripts/render_pptx.py');

/**
 * Executes render_pptx.py to extract all slides from a PPTX file into 1080p images.
 * @param {string} pptxPath - Absolute path to the PPTX file
 * @param {string} outputDir - Directory where slide PNGs will be saved
 * @returns {Promise<{page_count: number, slides: Array<{slide_index: number, filename: string, width: number, height: number}>}>}
 */
export function renderPptxToSlides(pptxPath, outputDir) {
  return new Promise((resolve, reject) => {
    const python = spawn('python', [RENDER_SCRIPT, pptxPath, outputDir]);

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
        return reject(new Error(`PPTX rendering failed with exit code ${code}: ${stderrData || stdoutData}`));
      }

      try {
        const result = JSON.parse(stdoutData.trim());
        if (!result.success) {
          return reject(new Error(result.error || 'Unknown error during PPTX rendering'));
        }
        resolve(result);
      } catch (err) {
        reject(new Error(`Failed to parse PPTX renderer output: ${err.message}. Raw output: ${stdoutData}`));
      }
    });

    python.on('error', (err) => {
      reject(new Error(`Failed to start PPTX renderer process: ${err.message}`));
    });
  });
}
