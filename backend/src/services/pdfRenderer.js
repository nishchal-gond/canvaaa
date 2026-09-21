import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const RENDER_SCRIPT = path.resolve(__dirname, '../../scripts/render_pdf.py');

/**
 * Executes render_pdf.py to extract all pages from a PDF file into 1080p slide images.
 * @param {string} pdfPath - Absolute path to the PDF file
 * @param {string} outputDir - Directory where slide PNGs will be saved
 * @returns {Promise<{page_count: number, slides: Array<{slide_index: number, filename: string, width: number, height: number}>}>}
 */
export function renderPdfToSlides(pdfPath, outputDir) {
  return new Promise((resolve, reject) => {
    const python = spawn('python', [RENDER_SCRIPT, pdfPath, outputDir]);

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
        return reject(new Error(`PDF rendering failed with exit code ${code}: ${stderrData || stdoutData}`));
      }

      try {
        const result = JSON.parse(stdoutData.trim());
        if (!result.success) {
          return reject(new Error(result.error || 'Unknown error during PDF rendering'));
        }
        resolve(result);
      } catch (err) {
        reject(new Error(`Failed to parse renderer output: ${err.message}. Raw output: ${stdoutData}`));
      }
    });

    python.on('error', (err) => {
      reject(new Error(`Failed to start python renderer process: ${err.message}`));
    });
  });
}
