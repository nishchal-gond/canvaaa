# Automated Sales Display System (Phase 1) — Design Specification

## Overview & Background
This specification defines Phase 1 of the Automated Sales Display Management System for an LG 98TR3DK-BM commercial display (Android 13, 16:9, 4K/1080p).

### Non-Negotiable Core Principles:
1. **Canva is the Design Master**: The Canva presentation (`Copy of Dashboard Screen 16/9`, Design ID `DAHVb9pmJzQ`) is the exclusive source of truth for visual layouts, typography, logos, and styling. The application does **not** recreate or approximate the Canva design in React/CSS.
2. **Supported Input Formats**:
   - **PDF**: Dynamically rendered into 1080p slide frames via PyMuPDF.
   - **PPTX**: Dynamically rendered into native 1080p slide frames via server-side PowerPoint COM engine.
   - **MP4**: Direct video asset played natively by the LG web player (looping, responsive 16:9, cached offline). Never converted into slides.
3. **Unified Presentation Model**:
   - The server normalizes PDF and PPTX into the same internal presentation/slides model.
   - The server manages MP4 as a native video presentation asset with duration, resolution, and thumbnail metadata.
4. **Zero Hardcoded Slide Counts**: Slide counts are dynamically determined from the uploaded file.
5. **Security**: No database credentials or secrets in code or git. All passwords reside strictly in `.env`.
6. **Operator Controls (PAUSE / CONTINUE)**: Manual operator controls freeze or resume display playback without disrupting active signage.

---

## Ingestion Architecture

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
│  - PDF Engine: PyMuPDF -> 1080p slide frames                │
│  - PPTX Engine: PowerPoint COM -> 1080p slide frames        │
│  - MP4 Engine: FFprobe metadata + FFmpeg thumbnail          │
│  - PostgreSQL: Common presentation & slide models           │
│  - Server-Sent Events (SSE): Real-time broadcast to display │
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

## Database Schema (`sales_display`)

```sql
CREATE TABLE IF NOT EXISTS presentations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(255) NOT NULL,
    filename VARCHAR(255) NOT NULL,
    original_format VARCHAR(20) NOT NULL, -- 'PDF', 'PPTX', 'MP4'
    media_type VARCHAR(20) DEFAULT 'presentation', -- 'presentation' or 'video'
    page_count INT DEFAULT 0,
    duration NUMERIC(10,2) DEFAULT 0,
    width INT DEFAULT 1920,
    height INT DEFAULT 1080,
    media_url VARCHAR(500),
    thumbnail_url VARCHAR(500),
    is_active BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS slides (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    presentation_id UUID REFERENCES presentations(id) ON DELETE CASCADE,
    slide_index INT NOT NULL,
    image_path VARCHAR(500) NOT NULL,
    width INT DEFAULT 1920,
    height INT DEFAULT 1080,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS display_state (
    id INT PRIMARY KEY DEFAULT 1,
    active_presentation_id UUID REFERENCES presentations(id) ON DELETE SET NULL,
    is_paused BOOLEAN DEFAULT false,
    rotation_interval INT DEFAULT 10,
    last_published_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT single_row_check CHECK (id = 1)
);
```
