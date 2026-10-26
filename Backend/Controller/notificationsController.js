const pool = require('../Model/db');

// Returns the newest notifications for the caller's role and how many are unread.
exports.list = async (req, res) => {
  try {
    const role = req.user.role;
    const [rows] = await pool.query(
      `SELECT id, type, title, message, link_view, created_at FROM notifications
       WHERE (',' || target_roles || ',') LIKE ? ORDER BY id DESC LIMIT 30`,
      [`%,${role},%`]
    );
    const [state] = await pool.query('SELECT last_read_id FROM notification_state WHERE user_id = ?', [req.user.id]);
    const lastRead = state.length ? Number(state[0].last_read_id) : 0;
    res.json({
      lastRead,
      unread: rows.filter((n) => Number(n.id) > lastRead).length,
      notifications: rows
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.markRead = async (req, res) => {
  try {
    const [max] = await pool.query('SELECT COALESCE(MAX(id), 0) AS m FROM notifications');
    await pool.query(
      'INSERT INTO notification_state (user_id, last_read_id) VALUES (?, ?) ON CONFLICT (user_id) DO UPDATE SET last_read_id = EXCLUDED.last_read_id RETURNING user_id',
      [req.user.id, Number(max[0].m)]
    );
    res.json({ message: 'Notifications marked as read.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
