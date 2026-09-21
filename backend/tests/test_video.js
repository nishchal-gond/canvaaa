import path from 'path';
import fs from 'fs';
import { processVideo } from '../src/services/videoProcessor.js';

async function test() {
  const sampleVideo = path.resolve('tests/fixtures/test_video.mp4');
  const thumbPath = path.resolve('uploads/test_video_thumb/poster.jpg');

  console.log(`Testing Video processing with: ${sampleVideo}`);
  if (!fs.existsSync(sampleVideo)) {
    console.error(`File not found: ${sampleVideo}`);
    process.exit(1);
  }

  const startTime = Date.now();
  const result = await processVideo(sampleVideo, thumbPath);
  const elapsed = (Date.now() - startTime) / 1000;

  console.log(`✅ Success! Probed video in ${elapsed}s:`, result);

  if (fs.existsSync(thumbPath)) {
    console.log(`Verified thumbnail generated at ${thumbPath}`);
  } else {
    throw new Error('Thumbnail not found!');
  }

  // Cleanup
  fs.rmSync(path.dirname(thumbPath), { recursive: true, force: true });
  console.log('Cleaned up test directory.');
}

test().catch((err) => {
  console.error('❌ Video test failed:', err);
  process.exit(1);
});
