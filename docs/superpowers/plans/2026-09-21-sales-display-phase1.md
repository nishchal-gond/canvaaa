# Automated Sales Display (Phase 1) Implementation Plan: Multi-Format (PDF, PPTX, MP4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend Phase 1 of the automated sales display system to natively support **PDF**, **PowerPoint (PPTX)**, and **MP4 Video** uploads. PDF and PPTX are normalized into 1080p slide frames for auto-rotation; MP4 is ingested as a native 16:9 looping video asset.

**Architecture:**
- Backend: Express + PostgreSQL (`sales_display`) + Python renderers (PyMuPDF for PDF, PowerPoint COM for PPTX, FFprobe/FFmpeg for MP4).
- Frontend: React + Vite displaying 16:9 slides or native 16:9 looping video in `/display`, and multi-format preview/publishing in `/admin`.

**Tech Stack:** Node.js, Express, PostgreSQL 18, Python 3.12 (PyMuPDF, pywin32), FFmpeg/FFprobe, React + Vite.

**Spec:** `docs/superpowers/specs/2026-09-21-sales-display-phase1-design.md`

## Global Constraints
- CANVA IS DESIGN MASTER: Never recreate Canva designs in React.
- PPTX RENDERING: Rendered server-side to 1080p slide frames via native PowerPoint COM automation.
- MP4 PLAYBACK: Played natively as HTML5 video with looping in the 16:9 stage. Never converted to static slides.
- SECURITY: No database passwords in git or code. Only local `.env`.
- DYNAMIC DETECTION: Auto-detect file format, slide count, and video duration dynamically.

---

### Task 1: Database Migration for Multi-Format Support
- [ ] Step 1: Update `backend/src/db/migrate.js` to add `original_format`, `media_type`, `media_url`, `duration`, `width`, `height`, `thumbnail_url` columns to `presentations` and `slides`.
- [ ] Step 2: Run migration and verify PostgreSQL columns.

### Task 2: PPTX Slide Rendering Service
- [ ] Step 1: Implement `backend/scripts/render_pptx.py` using PowerPoint COM automation to extract 1080p slide PNGs and count slides dynamically.
- [ ] Step 2: Implement `backend/src/services/pptxRenderer.js` in Node.
- [ ] Step 3: Run standalone PPTX test with `backend/tests/fixtures/test_powerpoint.pptx`.

### Task 3: MP4 Video Processing Service
- [ ] Step 1: Implement `backend/scripts/probe_video.py` using `ffprobe` to detect resolution/duration and `ffmpeg` to generate a 1080p thumbnail frame.
- [ ] Step 2: Implement `backend/src/services/videoProcessor.js` in Node.
- [ ] Step 3: Run standalone MP4 test with `backend/tests/fixtures/test_video.mp4`.

### Task 4: Unified Ingestion API & Display Endpoints
- [ ] Step 1: Update Multer in `backend/src/routes/presentations.js` to accept `.pdf`, `.pptx`, `.mp4`.
- [ ] Step 2: Auto-detect file type and dispatch to appropriate processor (PDF -> PyMuPDF, PPTX -> PPT COM, MP4 -> FFprobe).
- [ ] Step 3: Return normalized presentation model with `original_format`, `media_type`, `slide_count`, `duration`, etc.
- [ ] Step 4: Update `/api/display/current` and SSE payloads to deliver `media_type` and video properties to `/display`.

### Task 5: LG Display Player Video & Slide Support (`/display`)
- [ ] Step 1: Update `DisplayPlayer.jsx` to check `media_type === 'video'`.
- [ ] Step 2: Render responsive 16:9 looping `<video>` element when active presentation is MP4.
- [ ] Step 3: Bind PAUSE / CONTINUE to pause and resume video playback.
- [ ] Step 4: Update status badge: "LIVE DISPLAY • VIDEO LOOP • LG 98\"".
- [ ] Step 5: Update Service Worker to cache MP4 videos for offline playback.

### Task 6: Admin Control Panel Multi-Format UI (`/admin`)
- [ ] Step 1: Update upload card to "Upload Presentation or Video (PDF, PPTX, MP4)".
- [ ] Step 2: Show detected format card: Format, Slides / Duration, Status.
- [ ] Step 3: Add inline video preview for MP4 uploads.
- [ ] Step 4: Add slide thumbnail grid preview for PDF/PPTX uploads.
- [ ] Step 5: Verify PUBLISH, PAUSE, CONTINUE controls work for all formats.

### Task 7: Comprehensive Multi-Format Test Suite & Local Verification
- [ ] Step 1: Run automated test suite verifying PDF, PPTX, and MP4 uploads, dynamic counts, rendering, and publishing.
- [ ] Step 2: Test in browser via browser subagent to observe video playback and slide rotation.
