# LPH Sales Display System (Phase 1)

Automated commercial digital signage management system for an **LG 98TR3DK-BM** 98" display (Android 13 / Chrome). Replaces the manual USB thumb-drive transfer workflow with an automated, server-driven display pipeline while keeping **Canva as the strict visual design master**.

---

## Key Features

- **Multi-Format Ingestion**: First-class support for **PDF**, PowerPoint (**PPTX**), and native **MP4 Video** uploads.
- **Canva Preservation**: Renders PDF and PPTX directly into native 1080p frames using server-side PyMuPDF and PowerPoint COM engines. Never recreates or approximates Canva designs in CSS.
- **Native Video Loop**: Ingests MP4 video assets without conversion into slides, playing them natively in a seamless 16:9 loop on the LG screen.
- **Zero Hardcoded Slide Counts**: Slide and page counts are dynamically detected per uploaded presentation.
- **Real-Time Push Updates**: When an asset is published in the Admin Panel, connected displays update immediately via Server-Sent Events (SSE) without manual page reloads.
- **Manual Operator Controls**: Prominent **PAUSE** (freezes display on current view) and **CONTINUE** (resumes rotation with latest content) controls.
- **Offline Resilience**: Service Worker caches all presentation frames and videos locally on the display device so playback never goes blank if Wi-Fi disconnects.
- **Kiosk Mode Optimized**: Fixed 16:9 aspect-ratio letterboxing, hidden cursor, auto-reconnect with exponential backoff, and fullscreen toggle.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    CANVA (Design Master)                    │
│             Export as PDF, PPTX, or MP4 Video               │
└──────────────────────────────┬──────────────────────────────┘
                               │ Upload via /admin
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                   BACKEND DISPLAY SERVER                    │
│  - Multi-format Ingestion: Auto-detects PDF / PPTX / MP4    │
│  - PDF Pipeline: PyMuPDF -> 1080p slide frames              │
│  - PPTX Pipeline: PowerPoint COM -> 1080p slide frames      │
│  - MP4 Pipeline: FFprobe metadata + FFmpeg poster thumbnail │
│  - PostgreSQL: Normalized presentation and slide records    │
│  - SSE Stream: Instant real-time update broadcast           │
└──────────────────────────────┬──────────────────────────────┘
                               │ HTTP / SSE
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                 LG 98" COMMERCIAL DISPLAY                   │
│   - Presentation Mode (PDF/PPTX): 10s auto-rotating slides  │
│   - Video Mode (MP4): Native 16:9 looping HTML5 video       │
│   - Offline Service Worker caching for slides & video       │
└─────────────────────────────────────────────────────────────┘
```

---

## Getting Started

### Prerequisites
- **Node.js**: v18+ (tested on Node v24)
- **Python**: 3.10+ with `pymupdf` and `pywin32`
- **PostgreSQL**: v14+ (tested on v18)
- **FFmpeg & FFprobe**: (for MP4 processing)
- **Microsoft PowerPoint**: (for server-side PPTX rendering)

### 1. Environment Setup
Copy `.env.example` to `.env` and fill in your local PostgreSQL connection:
```bash
cp .env.example .env
```
Configure your database URL in `.env`:
```env
DATABASE_URL=postgresql://postgres:<PASSWORD>@localhost:5432/sales_display
PORT=8000
FRONTEND_URL=http://localhost:5173
```

### 2. Install Dependencies
```bash
# In backend
cd backend
npm install

# In frontend
cd ../frontend
npm install
```

### 3. Run Migrations
```bash
cd backend
node src/db/migrate.js
```

### 4. Start Development Servers
In separate terminals:
```bash
# Terminal 1: Backend Server (Port 8000)
cd backend
npm run dev

# Terminal 2: Frontend Application (Port 5173)
cd frontend
npm run dev
```

---

## Application Routes

- **Admin Control Panel**: `http://localhost:5173/admin`
  - Upload presentations (PDF, PPTX) or looping videos (MP4)
  - Preview slides and video streams
  - One-click **PUBLISH TO LG DISPLAY**
  - Manual **PAUSE** and **CONTINUE** controls
  - Real-time connected screen telemetry
- **LG Display Player**: `http://localhost:5173/display`
  - Kiosk player designed for fullscreen playback on the LG 98TR3DK-BM commercial display
  - Double-click or press `F` to toggle fullscreen
  - Offline-capable playback via Service Worker

---

## Testing

Run the automated integration test suite:
```bash
cd backend
node tests/test_multiformat.js
```
