# 📋 Project Development Summary & Chronological Work Log

**Project Name**: Automated Sales Floor Digital Signage System (LPH — Luxury Properties Hub)  
**Target Hardware**: Commercial LG 98" 4K Displays (LG 98TR3DK-BM), Projected Screens, and Multi-Office Signage Monitors.  
**Core Objective**: Replace manual USB thumb-drive updates with automated **Canva cloud synchronization**, instant multi-screen real-time publishing, 100% offline resilience, automated office operating schedules (auto-sleep / auto-wake), and remote fleet controls.

---

## 📅 Detailed Chronological Timeline

### 🗓️ Day 1: Monday, September 21, 2026
**Theme**: Core Signage Engine, Multi-Format Ingestion & Kiosk Architecture

* **17:27 — Signage Ingestion Engine & Data Schema**
  * Built ingestion pipeline supporting multi-format assets:
    * **PDF**: Automated frame extraction into high-resolution 1080p slide images.
    * **PPTX**: Multi-slide conversion and parsing.
    * **MP4 Video**: Native 16:9 looping video playback without transcoding.
  * Designed PostgreSQL database schemas:
    * `presentations`: Metadata, uploaded assets, timestamps.
    * `slides`: Ordering, individual slide image URLs, presentation foreign keys.
    * `display_state`: Singleton state engine tracking current active presentation, rotation interval (seconds), pause status, and media mode.
* **18:08 — Live Cloud Deployment & Edge Proxying**
  * Deployed React frontend to Vercel and connected backend via Cloudflare secure tunnel.
  * Configured dynamic API URL resolution and fallback handlers.
* **18:10 — SPA Routing Engine**
  * Added `vercel.json` SPA catch-all rewrite rules so deep links to `/admin` and `/display` route cleanly without 404s.
* **18:19 — Operator Controls & Live Display Player**
  * Built zero-chrome fullscreen kiosk player (`/display`) with automated slide rotations and real-time status badges.
  * Added speed control slider and manual Play / Pause controls to the Admin Panel (`/admin`).

---

### 🗓️ Day 2: Tuesday, September 22, 2026
**Theme**: 24/7 Cloud Architecture (Render + Neon), 100% Offline Caching & Canva OAuth

* **09:04 – 09:21 — Offline IndexedDB Blob Cache**
  * Implemented client-side IndexedDB caching in `/display`:
    * Pre-caches full slide deck images and videos as binary blobs.
    * Allows commercial screens and projectors to loop presentations 24/7 uninterrupted even during office Wi-Fi outages.
  * Added keyboard shortcuts (`Space` to toggle pause, `F` for fullscreen) and on-screen HUD styling.
* **09:24 – 10:03 — Cloud Migration (Render + Neon PostgreSQL)**
  * Migrated infrastructure from local machines to persistent cloud hosting:
    * **Backend**: Docker container hosted on **Render**.
    * **Database**: Serverless PostgreSQL hosted on **Neon** with automated SSL migrations.
  * Created `Dockerfile`, `render.yaml`, and database startup migrations.
* **10:22 – 10:32 — Official Branding & Headless Office Tools**
  * Integrated official **LPH Luxury Properties Hub** branding across display idle states, admin header, and favicons.
  * Configured headless **LibreOffice** inside the backend Docker container for server-side `.pptx` conversion.
* **10:42 – 10:58 — Video Format Expansion & SSE Streaming Fixes**
  * Added native support for `.mp4`, `.mov`, and `.webm` video files.
  * Disabled proxy response buffering (`X-Accel-Buffering: no`) for clean, low-latency Server-Sent Events (SSE) broadcasts.
* **16:24 – 16:48 — Direct Cloud Interconnect & Permanent Slide Assets**
  * Pointed Vercel frontend directly to the production Render cloud backend.
  * Embedded 25 default high-definition fallback slide assets inside the Docker image to ensure instant display boot even on cold container starts.
* **17:00 – 17:23 — Automatic Disk Storage Self-Purge**
  * Added automated disk cleanup: whenever a new presentation or video is published, older slide files and database records are automatically pruned to prevent disk bloat.
* **18:03 – 18:11 — Canva Connect API OAuth2 Integration**
  * Implemented Canva Connect API OAuth2 with PKCE verification.
  * Added in-UI settings for Custom Client ID, Secret, and 1-click cloud redirect URL copy.

---

### 🗓️ Day 3: Wednesday, September 23, 2026
**Theme**: Ingestion Engine Robustness & Data Tools

* **15:27 — Ingestion Engine Robustness (DataLink / Backend)**
  * Handled string truncation boundaries and row bounds checking for high-volume file readers.
  * Implemented automated job reaping and connection cleanup for background processes.
* **Inspection & Migration Tooling**
  * Verified dataset integrity, schemas, and live database migrations.

---

### 🗓️ Day 4: Thursday, September 24, 2026
**Theme**: Direct Canva 4K MP4 Sync, Office Auto-Sleep Schedule & Remote Fleet Control

* **10:14 – 10:32 — Direct Canva 4K MP4 Export**
  * Extended Canva integration to export master designs as **Horizontal 4K Native MP4 Video** (`horizontal_4k`).
  * Added in-UI selector allowing operators to choose between Multi-Image Slides or Direct 4K MP4 Video.
* **10:21 — Brand Identity Polish**
  * Replaced logo assets with high-resolution transparent background LPH vectors.
* **10:51 — Asynchronous Non-Blocking Sync with SSE Progress**
  * Turned Canva export and download into an asynchronous background job.
  * Added real-time progress bars in Admin Panel via SSE (`canva_exporting` -> `canva_downloading` -> `canva_ready`).
  * Implemented automatic token refresh when OAuth access tokens expire.
* **12:03 — Office Operating Schedule (Auto-Sleep 7:00 PM – 6:00 AM)**
  * Configured automated operating schedule:
    * **Active Hours**: 6:00 AM – 7:00 PM (Presentations / Videos loop smoothly).
    * **Sleep / Standby**: 7:00 PM – 6:00 AM.
  * **Ambient Standby Screen**: Screen dims to a minimal dark ambient display showing current time, date, and "Office Standby — Displays resume at 6:00 AM".
  * **Slide Position Memory**: Remembers the exact slide where playback stopped and resumes from that same slide the next morning.
  * **Neon Scale-to-Zero Eco Mode**: Reduced client polling frequency during standby so database and serverless compute scale to zero cost overnight.
* **12:43 – 13:02 — Remote Screen Management & Real-Time Sync**
  * Added instant **Manual Sleep / Wake** toggle in Admin Panel to override schedule on demand.
  * Added **Remote Screen Reload Signal** allowing administrators to refresh all connected screens remotely from any phone or laptop.
  * Added a 60-second safety heartbeat poll to ensure screens enter standby even if an SSE network connection drops.
* **13:32 — Cloud Memory & Video Streaming Safeguards**
  * Switched video downloads to direct disk streaming via chunks, eliminating Node.js buffer memory consumption.
  * Capped JSON body size and set Node.js container memory limits (`--max-old-space-size=400`) to prevent Render Out-Of-Memory container restarts.

---

### 🗓️ Day 5: Friday, September 25, 2026
**Theme**: Projected Display Compatibility, Standby Verification & Documentation

* **Display & Projector Compatibility Verification**
  * Verified that browser-based standby behavior functions universally across LG commercial TVs (webOS browser), projectors, smart monitors, and HDMI player boxes.
  * Documented standby visual effects (pure black backdrop with subtle ambient clock to minimize projector lamp wear and prevent LED burn-in).
* **Project Documentation & Work Summary**
  * Compiled comprehensive project log and operational guides for team handover.

---

## 🏗️ System Architecture & Technology Stack

```
                          ┌─────────────────────────────┐
                          │   Canva Design Master       │
                          │   (Connect API OAuth2)      │
                          └──────────────┬──────────────┘
                                         │ 1-Click Sync (4K MP4 / Slides)
                                         ▼
┌──────────────────┐             ┌─────────────────────────────┐
│   Admin Panel    │◄───(SSE)───►│   Render Cloud Backend      │
│  (Vercel React)  │             │   (Node.js / Express / SSL) │
└──────────────────┘             └──────────────┬──────────────┘
                                                │
                                                ▼
┌──────────────────┐             ┌─────────────────────────────┐
│  Display Player  │◄───(SSE)────┤   Neon Serverless Postgres  │
│(LG 98" / Project)│  (Cache)    │   (Scale-to-zero at night)  │
└──────────────────┘             └─────────────────────────────┘
```

| Component | Technology | Purpose |
| :--- | :--- | :--- |
| **Frontend** | React 18, Vite, Tailwind CSS, Lucide | Zero-chrome Kiosk display (`/display`) and Admin dashboard (`/admin`) |
| **Offline Engine** | IndexedDB & Cache API | Local blob storage to keep presentation looping during network interruptions |
| **Backend** | Node.js, Express, Docker | File streaming, Canva API integration, and SSE real-time broadcast engine |
| **Database** | Neon Serverless PostgreSQL | Storage for presentations, slide metadata, and display singleton state |
| **Cloud Hosting** | Render (Backend) + Vercel (Frontend) | 24/7 high-availability cloud infrastructure with automated deployments |
| **Office Automation**| Time-zone aware schedule (UTC+4) | 7:00 PM auto-sleep, 6:00 AM auto-wake with slide position memory |

---

## ⚡ Current System Capabilities Checklist

* [x] **Canva 1-Click Sync**: Direct OAuth2 sync of designs into 4K MP4 or slide decks without exporting/uploading manually.
* [x] **Multi-Screen Instant Update**: Any change published in Admin instantly appears on all connected screens via SSE.
* [x] **Offline Immunity**: If office Wi-Fi drops, cached slides/video continue playing without a blank screen or error popup.
* [x] **Eco / Auto-Sleep Schedule**: Displays automatically dim to ambient clock mode from 7:00 PM to 6:00 AM.
* [x] **Slide Resume**: Displays pick up on the exact slide where they left off the previous evening.
* [x] **Fleet Control**: Remote Sleep/Wake toggle, slide speed adjustment, manual play/pause, and remote browser reload.
* [x] **Auto Storage Purge**: Prevents server disk overflows by cleaning up superseded presentations automatically.
* [x] **Universal Display Support**: Runs on any modern browser: LG webOS commercial screens, projectors, and auxiliary monitors.
