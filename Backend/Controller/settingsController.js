const pool = require('../Model/db');

const DEFAULT_ADVISORY = {
  active: false,
  title: 'Online Reservation Notice — Temporarily Unavailable Due to Inventory Replenishment',
  message: 'Dear Valued Guests,\n\nPlease be advised that online booking submissions are temporarily unavailable at this time as our culinary and operations teams replenish essential inventory stocks to guarantee the quality and completeness of every event.\n\nFor urgent event inquiries, advance consultations, or schedule checks, please contact our coordination desk directly via phone (+63 9477604320) or email (nardscatering@gmail.com).\n\nThank you for your continued understanding and trust in Nard’s Catering & Setup.'
};

exports.DEFAULT_ADVISORY = DEFAULT_ADVISORY;

exports.evaluateInventoryAvailability = async () => {
  try {
    const [invRows] = await pool.query(
      'SELECT id, name, quantity, threshold FROM Inventory WHERE COALESCE(is_archived, 0) = 0'
    );
    if (!Array.isArray(invRows) || invRows.length === 0) {
      return { insufficient: true, reason: 'empty', shortages: ['No available items in inventory'] };
    }
    if (invRows.every((r) => Number(r.quantity) <= 0)) {
      return { insufficient: true, reason: 'empty', shortages: ['All inventory stocks are currently depleted'] };
    }

    const lowOrZero = invRows
      .filter((r) => Number(r.quantity) <= 0 || Number(r.quantity) < Number(r.threshold || 0))
      .map((r) => `${r.name} (available: ${r.quantity}, min: ${r.threshold || 0})`);

    let pkgShort = [];
    try {
      const [reqRows] = await pool.query(
        `SELECT i.name, i.quantity AS current_stock, SUM(di.qty_required) AS required_qty
         FROM Packages p
         JOIN PackageDishes pd ON pd.package_id = p.id
         JOIN DishIngredients di ON di.dish_id = pd.dish_id
         JOIN Inventory i ON i.id = di.inventory_id
         WHERE COALESCE(p.is_archived, 0) = 0 AND COALESCE(i.is_archived, 0) = 0
         GROUP BY i.id, i.name, i.quantity`
      );
      pkgShort = (reqRows || [])
        .filter((r) => Number(r.current_stock) < Number(r.required_qty))
        .map((r) => `${r.name} (available: ${r.current_stock}, required: ${r.required_qty})`);
    } catch (e) {
      // Package links may not be configured yet.
    }

    const shortages = [...new Set([...lowOrZero, ...pkgShort])];
    if (shortages.length > 0) {
      return { insufficient: true, reason: 'insufficient', shortages };
    }
    return { insufficient: false, reason: 'ok', shortages: [] };
  } catch (err) {
    return { insufficient: false, reason: 'unknown', shortages: [] };
  }
};

exports.readBookingAdvisory = async () => {
  const availability = await exports.evaluateInventoryAvailability();
  let custom = {};
  try {
    const [rows] = await pool.query("SELECT settingValue FROM Settings WHERE settingKey = 'bookingAdvisory' LIMIT 1");
    if (rows.length && rows[0].settingValue) custom = JSON.parse(rows[0].settingValue);
  } catch (err) {
    custom = {};
  }
  return {
    active: Boolean(availability.insufficient),
    autoInventoryTriggered: true,
    reason: availability.reason,
    shortages: availability.shortages,
    title: String(custom.title || DEFAULT_ADVISORY.title).trim(),
    message: String(custom.message || DEFAULT_ADVISORY.message).trim(),
    updatedAt: custom.updatedAt || new Date().toISOString()
  };
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
