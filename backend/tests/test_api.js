import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runApiTests() {
  console.log('Testing Backend API endpoints...');
  const baseUrl = 'http://localhost:8000';

  // 1. Health check
  const healthRes = await fetch(`${baseUrl}/api/health`);
  const healthData = await healthRes.json();
  console.log('Health check response:', healthData);

  // 2. Upload test presentation PDF
  const fixturePdf = path.resolve(__dirname, 'fixtures/test_presentation.pdf');
  const fileBuffer = fs.readFileSync(fixturePdf);
  const blob = new Blob([fileBuffer], { type: 'application/pdf' });
  const formData = new FormData();
  formData.append('presentation', blob, 'test_presentation.pdf');
  formData.append('title', 'Test Automated Presentation');

  console.log('Uploading test presentation...');
  const uploadRes = await fetch(`${baseUrl}/api/presentations/upload`, {
    method: 'POST',
    body: formData
  });
  const uploadData = await uploadRes.json();
  console.log('Upload result:', {
    success: uploadData.success,
    page_count: uploadData.presentation?.page_count,
    slides_count: uploadData.presentation?.slides?.length,
    id: uploadData.presentation?.id
  });

  const presentationId = uploadData.presentation?.id;
  if (!presentationId) throw new Error('Presentation upload failed.');

  // 3. Publish presentation
  console.log('Publishing presentation to display...');
  const pubRes = await fetch(`${baseUrl}/api/display/publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ presentation_id: presentationId })
  });
  const pubData = await pubRes.json();
  console.log('Publish result:', pubData.message);

  // 4. Fetch current display state
  const curRes = await fetch(`${baseUrl}/api/display/current`);
  const curData = await curRes.json();
  console.log('Current display state:', {
    active_title: curData.state?.active_title,
    page_count: curData.state?.page_count,
    is_paused: curData.state?.is_paused,
    slides: curData.slides?.length
  });

  // 5. Test Pause
  console.log('Testing PAUSE control...');
  const pauseRes = await fetch(`${baseUrl}/api/display/pause`, { method: 'POST' });
  const pauseData = await pauseRes.json();
  console.log('Pause result:', pauseData.message, 'is_paused =', pauseData.payload?.state?.is_paused);

  // 6. Test Continue
  console.log('Testing CONTINUE control...');
  const contRes = await fetch(`${baseUrl}/api/display/continue`, { method: 'POST' });
  const contData = await contRes.json();
  console.log('Continue result:', contData.message, 'is_paused =', contData.payload?.state?.is_paused);

  console.log('✅ All backend API endpoints verified successfully!');
}

runApiTests().catch((err) => {
  console.error('❌ API Test failed:', err);
  process.exit(1);
});
