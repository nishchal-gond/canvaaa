import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const baseUrl = 'http://localhost:8000';

async function testUpload(filePath, expectedFormat, expectedType) {
  const originalName = path.basename(filePath);
  const fileBuffer = fs.readFileSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const mimeType = ext === '.pdf' ? 'application/pdf' : ext === '.pptx' ? 'application/vnd.openxmlformats-officedocument.presentationml.presentation' : 'video/mp4';

  const blob = new Blob([fileBuffer], { type: mimeType });
  const formData = new FormData();
  formData.append('presentation', blob, originalName);
  formData.append('title', `Test ${expectedFormat} Asset`);

  console.log(`\nUploading ${expectedFormat}: ${originalName}...`);
  const res = await fetch(`${baseUrl}/api/presentations/upload`, {
    method: 'POST',
    body: formData
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Upload failed for ${expectedFormat}`);

  console.log(`✅ ${expectedFormat} Upload Result:`, {
    id: data.presentation.id,
    original_format: data.presentation.original_format,
    media_type: data.presentation.media_type,
    page_count: data.presentation.page_count,
    duration: data.presentation.duration,
    slides: data.presentation.slides?.length
  });

  if (data.presentation.original_format !== expectedFormat) {
    throw new Error(`Format mismatch: expected ${expectedFormat}, got ${data.presentation.original_format}`);
  }
  if (data.presentation.media_type !== expectedType) {
    throw new Error(`Type mismatch: expected ${expectedType}, got ${data.presentation.media_type}`);
  }

  return data.presentation;
}

async function run() {
  console.log('=== MULTI-FORMAT TEST SUITE (PDF, PPTX, MP4) ===');

  // 1. PDF Test
  const pdfFixture = path.resolve(__dirname, 'fixtures/test_presentation.pdf');
  const pdfPres = await testUpload(pdfFixture, 'PDF', 'presentation');

  // 2. PPTX Test
  const pptxFixture = path.resolve(__dirname, 'fixtures/test_powerpoint.pptx');
  const pptxPres = await testUpload(pptxFixture, 'PPTX', 'presentation');

  // 3. MP4 Test
  const mp4Fixture = path.resolve(__dirname, 'fixtures/test_video.mp4');
  const mp4Pres = await testUpload(mp4Fixture, 'MP4', 'video');

  // 4. Test Publishing PPTX
  console.log('\nTesting Publishing PPTX presentation...');
  let pubRes = await fetch(`${baseUrl}/api/display/publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ presentation_id: pptxPres.id })
  });
  let pubData = await pubRes.json();
  console.log('Published PPTX:', pubData.payload?.state?.active_title, 'format:', pubData.payload?.state?.original_format);

  // 5. Test Publishing MP4 Video
  console.log('\nTesting Publishing MP4 Video...');
  pubRes = await fetch(`${baseUrl}/api/display/publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ presentation_id: mp4Pres.id })
  });
  pubData = await pubRes.json();
  console.log('Published MP4 Video:', pubData.payload?.state?.active_title, 'media_type:', pubData.payload?.state?.media_type, 'media_url:', pubData.payload?.state?.media_url);

  console.log('\n🎉 ALL MULTI-FORMAT BACKEND TESTS PASSED!');
}

run().catch((err) => {
  console.error('❌ Multi-format test failed:', err);
  process.exit(1);
});
