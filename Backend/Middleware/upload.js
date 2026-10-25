const multer = require('multer');
const crypto = require('crypto');

const BUCKET = 'uploads';
const EXT_BY_MIME = { 'image/jpeg': '.jpg', 'image/png': '.png' };

// Vercel's filesystem is read-only, so images are kept in memory and stored in Supabase Storage.
let bucketReady;
function storageConfig() {
  const base = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!base || !key) throw new Error('SUPABASE_URL and SUPABASE_SECRET_KEY are required for image uploads.');
  return { base, headers: { apikey: key, Authorization: `Bearer ${key}` } };
}

async function ensureBucket() {
  if (!bucketReady) {
    bucketReady = (async () => {
      const { base, headers } = storageConfig();
      const res = await fetch(`${base}/storage/v1/bucket`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: BUCKET, name: BUCKET, public: true })
      });
      if (!res.ok && res.status !== 409 && !/already exists/i.test(await res.text())) {
        throw new Error('Could not prepare the image storage bucket.');
      }
    })().catch((error) => { bucketReady = null; throw error; });
  }
  return bucketReady;
}

async function saveToStorage(file) {
  await ensureBucket();
  const { base, headers } = storageConfig();
  const name = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${EXT_BY_MIME[file.mimetype]}`;
  const res = await fetch(`${base}/storage/v1/object/${BUCKET}/${name}`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': file.mimetype },
    body: file.buffer
  });
  if (!res.ok) throw new Error('Could not save the uploaded image.');
  file.url = `${base}/storage/v1/object/public/${BUCKET}/${name}`;
}

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (EXT_BY_MIME[file.mimetype]) return cb(null, true);
    cb(new Error('Only JPG or PNG receipt photos are allowed.'));
  }
});

const MIN_RECEIPT_BYTES = 15 * 1024;

function detectImageType(file) {
  const head = file.buffer.subarray(0, 8);
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg';
  if (head.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  return null;
}

// Receipts must be a genuine JPG/PNG photo or screenshot (content checked, not just the extension).
// Automatically proving that the image is a real payment receipt needs OCR, so staff still review it.
exports.receipt = (field) => (req, res, next) => {
  imageUpload.single(field)(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return next();
    const reject = (message) => res.status(400).json({ error: message });
    const type = detectImageType(req.file);
    if (!type || type !== req.file.mimetype) return reject('The file is not a valid JPG or PNG image. Please upload a photo or screenshot of your payment receipt.');
    if (req.file.size < MIN_RECEIPT_BYTES) return reject('This image is too small to be a payment receipt. Please upload a clear photo or screenshot of your receipt.');
    try {
      await saveToStorage(req.file);
      next();
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
};

// Wraps multer so upload errors return JSON 400 instead of a stack trace.
exports.single = (field) => (req, res, next) => {
  imageUpload.single(field)(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return next();
    try {
      await saveToStorage(req.file);
      next();
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
};
