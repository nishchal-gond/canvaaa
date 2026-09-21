import path from 'path';
import fs from 'fs';
import { renderPptxToSlides } from '../src/services/pptxRenderer.js';

async function test() {
  const samplePptx = path.resolve('tests/fixtures/test_powerpoint.pptx');
  const outDir = path.resolve('uploads/test_pptx_slides');

  console.log(`Testing PPTX rendering with: ${samplePptx}`);
  if (!fs.existsSync(samplePptx)) {
    console.error(`File not found: ${samplePptx}`);
    process.exit(1);
  }

  const startTime = Date.now();
  const result = await renderPptxToSlides(samplePptx, outDir);
  const elapsed = (Date.now() - startTime) / 1000;

  console.log(`✅ Success! Rendered ${result.page_count} PPTX slides dynamically in ${elapsed}s`);
  console.log('Sample slides:', result.slides);

  const files = fs.readdirSync(outDir);
  console.log(`Verified ${files.length} slide files saved in ${outDir}`);

  // Cleanup
  fs.rmSync(outDir, { recursive: true, force: true });
  console.log('Cleaned up test directory.');
}

test().catch((err) => {
  console.error('❌ PPTX test failed:', err);
  process.exit(1);
});
