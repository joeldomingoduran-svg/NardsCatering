const pool = require('../Model/db');

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
