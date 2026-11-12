import pkg from 'pg';
const { Pool } = pkg;
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// Pool connection to Master Database (zydusapp) for Employee & Site lookups
const authPool = new Pool({
  connectionString: process.env.AUTH_DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
});

authPool.on('error', (err) => {
  console.error('[authDb] Unexpected error on idle client', err.message);
});

export default authPool;
