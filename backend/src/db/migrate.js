import { pool, query } from '../config/db.js';

export async function runMigrations() {
  console.log('Running database migrations for sales_display multi-format support...');

  const schema = `
    CREATE EXTENSION IF NOT EXISTS "pgcrypto";

    CREATE TABLE IF NOT EXISTS presentations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      title VARCHAR(255) NOT NULL,
      filename VARCHAR(255) NOT NULL,
      page_count INT NOT NULL DEFAULT 0,
      is_active BOOLEAN DEFAULT false,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    -- Add multi-format columns if they don't already exist
    ALTER TABLE presentations ADD COLUMN IF NOT EXISTS original_format VARCHAR(20) DEFAULT 'PDF';
    ALTER TABLE presentations ADD COLUMN IF NOT EXISTS media_type VARCHAR(20) DEFAULT 'presentation';
    ALTER TABLE presentations ADD COLUMN IF NOT EXISTS duration NUMERIC(10,2) DEFAULT 0;
    ALTER TABLE presentations ADD COLUMN IF NOT EXISTS width INT DEFAULT 1920;
    ALTER TABLE presentations ADD COLUMN IF NOT EXISTS height INT DEFAULT 1080;
    ALTER TABLE presentations ADD COLUMN IF NOT EXISTS media_url VARCHAR(500);
    ALTER TABLE presentations ADD COLUMN IF NOT EXISTS thumbnail_url VARCHAR(500);

    CREATE TABLE IF NOT EXISTS slides (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      presentation_id UUID REFERENCES presentations(id) ON DELETE CASCADE,
      slide_index INT NOT NULL,
      image_path VARCHAR(500) NOT NULL,
      width INT DEFAULT 1920,
      height INT DEFAULT 1080,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    ALTER TABLE slides ADD COLUMN IF NOT EXISTS width INT DEFAULT 1920;
    ALTER TABLE slides ADD COLUMN IF NOT EXISTS height INT DEFAULT 1080;

    CREATE TABLE IF NOT EXISTS display_state (
      id INT PRIMARY KEY DEFAULT 1,
      active_presentation_id UUID REFERENCES presentations(id) ON DELETE SET NULL,
      is_paused BOOLEAN DEFAULT false,
      rotation_interval INT DEFAULT 10,
      last_published_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      CONSTRAINT single_row_check CHECK (id = 1)
    );

    -- Ensure single display_state row exists
    INSERT INTO display_state (id, is_paused, rotation_interval, updated_at)
    VALUES (1, false, 10, NOW())
    ON CONFLICT (id) DO NOTHING;

    -- Operating schedule & slide navigation columns for power/memory optimization
    ALTER TABLE display_state ADD COLUMN IF NOT EXISTS schedule_enabled BOOLEAN DEFAULT true;
    ALTER TABLE display_state ADD COLUMN IF NOT EXISTS schedule_start_time VARCHAR(10) DEFAULT '06:00';
    ALTER TABLE display_state ADD COLUMN IF NOT EXISTS schedule_end_time VARCHAR(10) DEFAULT '19:00';
    ALTER TABLE display_state ADD COLUMN IF NOT EXISTS last_slide_index INT DEFAULT 0;
    ALTER TABLE display_state ADD COLUMN IF NOT EXISTS is_scheduled_sleep BOOLEAN DEFAULT false;

    -- Phase 2A: Canva Direct Sync Tables
    CREATE TABLE IF NOT EXISTS canva_connections (
      id INT PRIMARY KEY DEFAULT 1,
      design_id VARCHAR(100) NOT NULL DEFAULT 'DAHVb9pmJzQ',
      design_title VARCHAR(255) DEFAULT 'Copy of Dashboard Screen 16/9',
      access_token TEXT,
      refresh_token TEXT,
      token_expires_at TIMESTAMP WITH TIME ZONE,
      auto_sync_enabled BOOLEAN DEFAULT false,
      poll_interval_seconds INT DEFAULT 60,
      last_canva_updated_at BIGINT DEFAULT 0,
      last_synced_at TIMESTAMP WITH TIME ZONE,
      last_published_at TIMESTAMP WITH TIME ZONE,
      status VARCHAR(50) DEFAULT 'disconnected',
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      CONSTRAINT single_canva_connection_check CHECK (id = 1)
    );

    INSERT INTO canva_connections (id, design_id, design_title, status, updated_at)
    VALUES (1, 'DAHVb9pmJzQ', 'Copy of Dashboard Screen 16/9', 'disconnected', NOW())
    ON CONFLICT (id) DO NOTHING;

    -- Phase 2B: Canva Video & Auto-Publish columns
    ALTER TABLE canva_connections ADD COLUMN IF NOT EXISTS export_format VARCHAR(20) DEFAULT 'mp4';
    ALTER TABLE canva_connections ADD COLUMN IF NOT EXISTS auto_publish BOOLEAN DEFAULT true;

    CREATE TABLE IF NOT EXISTS canva_versions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      design_id VARCHAR(100) NOT NULL,
      canva_updated_at BIGINT NOT NULL,
      version_label VARCHAR(100),
      export_format VARCHAR(20) DEFAULT 'PDF',
      presentation_id UUID REFERENCES presentations(id) ON DELETE CASCADE,
      slide_count INT DEFAULT 0,
      file_path VARCHAR(500),
      status VARCHAR(50) DEFAULT 'pending',
      is_published BOOLEAN DEFAULT false,
      synced_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      published_at TIMESTAMP WITH TIME ZONE,
      CONSTRAINT unique_canva_design_version UNIQUE (design_id, canva_updated_at)
    );
  `;

  try {
    await query(schema);
    console.log('✅ Multi-format migrations completed successfully.');
  } catch (err) {
    console.error('❌ Migration failed:', err);
    throw err;
  }
}

if (process.argv[1]?.endsWith('migrate.js')) {
  runMigrations()
    .then(() => pool.end())
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
