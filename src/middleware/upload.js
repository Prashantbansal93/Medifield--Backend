const path = require('path');
const fs = require('fs');
const multer = require('multer');
const crypto = require('crypto');

const UPLOAD_ROOT = path.join(__dirname, '../../uploads');
const DOC_DIR = path.join(UPLOAD_ROOT, 'documents');
const CHALLAN_DIR = path.join(UPLOAD_ROOT, 'challans');

for (const dir of [UPLOAD_ROOT, DOC_DIR, CHALLAN_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

const IMAGE_MIME = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);

function makeStorage(subdir) {
  return multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, subdir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase() || '.jpg';
      const safeExt = ['.jpg', '.jpeg', '.png', '.webp'].includes(ext) ? ext : '.jpg';
      cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${safeExt}`);
    },
  });
}

function imageFilter(_req, file, cb) {
  if (!IMAGE_MIME.has(file.mimetype)) {
    return cb(new Error('Only JPEG, PNG, or WebP images are allowed'));
  }
  return cb(null, true);
}

const documentUpload = multer({
  storage: makeStorage(DOC_DIR),
  fileFilter: imageFilter,
  limits: { fileSize: 5 * 1024 * 1024 },
});

const challanUpload = multer({
  storage: makeStorage(CHALLAN_DIR),
  fileFilter: imageFilter,
  limits: { fileSize: 5 * 1024 * 1024 },
});

function publicUploadPath(absolutePath) {
  const rel = path.relative(UPLOAD_ROOT, absolutePath).replace(/\\/g, '/');
  return `/uploads/${rel}`;
}

module.exports = {
  UPLOAD_ROOT,
  documentUpload,
  challanUpload,
  publicUploadPath,
};
