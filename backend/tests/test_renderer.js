import path from 'path';
import fs from 'fs';
import { renderPdfToSlides } from '../src/services/pdfRenderer.js';

async function test() {
  const samplePdf = path.resolve('tests/fixtures/test_presentation.pdf');
  const outDir = path.resolve('uploads/test_slides');

  console.log(`Testing PDF rendering with: ${samplePdf}`);
  if (!fs.existsSync(samplePdf)) {
    console.error(`File not found: ${samplePdf}`);
    process.exit(1);
  }

  const startTime = Date.now();
  const result = await renderPdfToSlides(samplePdf, outDir);
  const elapsed = (Date.now() - startTime) / 1000;

  console.log(`✅ Success! Rendered ${result.page_count} pages dynamically in ${elapsed}s`);
  console.log('Sample slides rendered:', result.slides.slice(0, 3));

  // Verify files actually exist on disk
  const files = fs.readdirSync(outDir);
  console.log(`Verified ${files.length} slide files saved in ${outDir}`);

  // Cleanup test files
  fs.rmSync(outDir, { recursive: true, force: true });
  console.log('Cleaned up test directory.');
}

test().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
