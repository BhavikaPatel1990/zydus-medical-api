import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import apiRouter from './routes/index.js';
import { getApiBasePath } from './config/apiBasePath.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 7018;
const HOST = process.env.HOST || '0.0.0.0';
const API_BASE_PATH = getApiBasePath();
const corsOrigins = (process.env.CORS_ORIGINS || process.env.FRONTEND_URL || '*')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

// Ensure uploads/incidents directory exists
const uploadsDir = path.join(__dirname, '../uploads');
const incidentUploadsDir = path.join(uploadsDir, 'incidents');
if (!fs.existsSync(incidentUploadsDir)) {
  fs.mkdirSync(incidentUploadsDir, { recursive: true });
}

// Middleware
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || corsOrigins.includes('*') || corsOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error(`Origin not allowed by CORS: ${origin}`));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

// Static files and API routes share a configurable public base path.
app.use(`${API_BASE_PATH}/uploads`, express.static(uploadsDir));
app.use(`${API_BASE_PATH}/api/uploads`, express.static(uploadsDir));
app.use('/api/uploads', express.static(uploadsDir));
app.use('/uploads', express.static(uploadsDir));

// Base Route & Context (Reload trigger)
app.use(`${API_BASE_PATH}/api`, apiRouter);
app.use('/api', apiRouter); // Direct access alias

app.get('/', (req, res) => {
  res.send('Zydus Medical & Incident Reporting Microservice API Running');
});

app.listen(PORT, HOST, () => {
  console.log(`==================================================`);
  console.log(` ZYDUS MEDICAL & INCIDENT API RUNNING ON PORT ${PORT}`);
  console.log(` Endpoint: http://localhost:${PORT}${API_BASE_PATH}/api`);
  console.log(` Static Uploads: http://localhost:${PORT}${API_BASE_PATH}/uploads`);
  console.log(`==================================================`);
});
