const pool = require('./db');

// Notifications must never break the request that triggers them.
async function notify(type, title, message, roles = ['admin', 'manager', 'staff'], link = null) {
  try {
    await pool.query(
      'INSERT INTO notifications (type, title, message, target_roles, link_view) VALUES (?, ?, ?, ?, ?)',
      [String(type).slice(0, 30), String(title).slice(0, 120), String(message || '').slice(0, 400), roles.join(','), link]
    );
  } catch (err) {
    console.warn('Notification write failed:', err.message);
  }
}

module.exports = { notify };
