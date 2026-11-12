import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Dedicated folder for incident report image and PDF attachments
export const INCIDENT_UPLOADS_DIR = path.resolve(__dirname, '../../uploads/incidents');

// Ensure upload directory exists
if (!fs.existsSync(INCIDENT_UPLOADS_DIR)) {
  fs.mkdirSync(INCIDENT_UPLOADS_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (!fs.existsSync(INCIDENT_UPLOADS_DIR)) {
      fs.mkdirSync(INCIDENT_UPLOADS_DIR, { recursive: true });
    }
    cb(null, INCIDENT_UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.png';
    const timestamp = Date.now();
    const random = Math.round(Math.random() * 1e9);
    cb(null, `incident_${timestamp}_${random}${ext}`);
  },
});

const fileFilter = (req, file, cb) => {
  const allowedMime = [
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/bmp',
    'image/heic',
    'image/heif',
    'application/pdf',
  ];
  const allowedExts = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.heic', '.heif', '.pdf'];
  const ext = path.extname(file.originalname).toLowerCase();

  if (allowedMime.includes(file.mimetype) || allowedExts.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('Only supported image files or PDF documents are allowed.'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 25 * 1024 * 1024, // 25 MB max per file
  },
});

// Middleware supporting multiple evidence attachments under the 'images' form field
export const uploadIncidentImages = (req, res, next) => {
  const multiUpload = upload.array('images', 10);
  multiUpload(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      return res.status(400).json({
        status: false,
        message: `Upload error: ${err.message}`,
      });
    } else if (err) {
      return res.status(400).json({
        status: false,
        message: err.message || 'Error uploading file',
      });
    }
    next();
  });
};

export default upload;
