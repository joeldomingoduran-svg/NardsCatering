const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const EXT_BY_MIME = { 'image/jpeg': '.jpg', 'image/png': '.png' };

const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${EXT_BY_MIME[file.mimetype]}`)
});

const imageUpload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (EXT_BY_MIME[file.mimetype]) return cb(null, true);
    cb(new Error('Only JPG or PNG receipt photos are allowed.'));
  }
});

const MIN_RECEIPT_BYTES = 15 * 1024;

function detectImageType(file) {
  const head = Buffer.alloc(8);
  const fd = fs.openSync(file, 'r');
  try { fs.readSync(fd, head, 0, 8, 0); } finally { fs.closeSync(fd); }
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg';
  if (head.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  return null;
}

// Receipts must be a genuine JPG/PNG photo or screenshot (content checked, not just the extension).
// Automatically proving that the image is a real payment receipt needs OCR, so staff still review it.
exports.receipt = (field) => (req, res, next) => {
  imageUpload.single(field)(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return next();
    const reject = (message) => {
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({ error: message });
    };
    const type = detectImageType(req.file.path);
    if (!type || type !== req.file.mimetype) return reject('The file is not a valid JPG or PNG image. Please upload a photo or screenshot of your payment receipt.');
    if (req.file.size < MIN_RECEIPT_BYTES) return reject('This image is too small to be a payment receipt. Please upload a clear photo or screenshot of your receipt.');
    next();
  });
};

// Wraps multer so upload errors return JSON 400 instead of a stack trace.
exports.single = (field) => (req, res, next) => {
  imageUpload.single(field)(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    next();
  });
};
