import pkg from 'pg';
const { Pool } = pkg;
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from root directory and backend directory
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config();

// Live Neon cloud database connection string fallback
const NEON_DEFAULT = "postgresql://neondb_owner:npg_AWdFmxjEG6M5@ep-withered-boat-b5scwpu9-pooler.c-7.us-east-2.aws.neon.tech/neondb?sslmode=require";

const connectionString = process.env.DATABASE_URL || NEON_DEFAULT;

export const pool = new Pool({
  connectionString,
  ssl: connectionString && !connectionString.includes('localhost') ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30000,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle PostgreSQL client', err);
});

export const query = (text, params) => pool.query(text, params);
