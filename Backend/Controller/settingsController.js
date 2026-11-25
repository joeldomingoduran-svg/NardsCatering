const pool = require('../Model/db');

const DEFAULT_ADVISORY = {
  active: true,
  title: 'Online Reservation Notice — Temporarily Unavailable',
  message: 'Dear Valued Guests,\n\nPlease be advised that online booking submissions are temporarily unavailable at this time as our culinary and operations teams conduct scheduled inventory replenishment and service capacity calibration to maintain our quality standards.\n\nWe sincerely appreciate your patience and understanding. For urgent event inquiries, advance consultations, or schedule checks, please contact our coordination desk directly via phone (+63 9477604320) or email (nardscatering@gmail.com).\n\nThank you for your continued trust in Nard’s Catering & Setup.'
};

exports.DEFAULT_ADVISORY = DEFAULT_ADVISORY;

exports.readBookingAdvisory = async () => {
  try {
    const [rows] = await pool.query("SELECT settingValue FROM Settings WHERE settingKey = 'bookingAdvisory' LIMIT 1");
    if (!rows.length || !rows[0].settingValue) return { ...DEFAULT_ADVISORY };
    const parsed = JSON.parse(rows[0].settingValue);
    return {
      active: Boolean(parsed.active),
      title: String(parsed.title || DEFAULT_ADVISORY.title).trim(),
      message: String(parsed.message || DEFAULT_ADVISORY.message).trim(),
      updatedAt: parsed.updatedAt || null
    };
  } catch (err) {
    return { ...DEFAULT_ADVISORY };
  }
};

exports.getGcashQr = async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT settingValue FROM Settings WHERE settingKey = 'gcashQr'");
    res.json({ url: rows[0]?.settingValue || null });
  } catch (err) {
    res.status(500).json({ error: 'Could not load GCash QR.' });
  }
};

exports.setGcashQr = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Please choose an image.' });
    const url = req.file.url;
    await pool.query(
      "INSERT INTO Settings (settingKey, settingValue) VALUES ('gcashQr', ?) ON DUPLICATE KEY UPDATE settingValue = VALUES(settingValue)",
      [url]
    );
    res.json({ message: 'GCash QR updated.', url });
  } catch (err) {
    res.status(500).json({ error: 'Could not save GCash QR.' });
  }
};

exports.getBookingAdvisory = async (req, res) => {
  const advisory = await exports.readBookingAdvisory();
  res.json(advisory);
};

exports.setBookingAdvisory = async (req, res) => {
  try {
    const active = Boolean(req.body?.active);
    const title = String(req.body?.title || DEFAULT_ADVISORY.title).trim().slice(0, 140) || DEFAULT_ADVISORY.title;
    const message = String(req.body?.message || DEFAULT_ADVISORY.message).trim().slice(0, 1500) || DEFAULT_ADVISORY.message;
    const value = JSON.stringify({ active, title, message, updatedAt: new Date().toISOString() });
    await pool.query(
      "INSERT INTO Settings (settingKey, settingValue) VALUES ('bookingAdvisory', ?) ON DUPLICATE KEY UPDATE settingValue = VALUES(settingValue)",
      [value]
    );
    res.json({ message: 'Booking availability advisory updated.', active, title, advisoryMessage: message });
  } catch (err) {
    res.status(500).json({ error: 'Could not save booking advisory.' });
  }
};
