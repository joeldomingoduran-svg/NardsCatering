const pool = require('../Model/db');

exports.getAuditLog = async (req, res) => {
  try {
    const { from, to, user, action } = req.query;
    const where = [];
    const params = [];
    if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) { where.push('createdAt >= ?'); params.push(`${from} 00:00:00`); }
    if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) { where.push('createdAt <= ?'); params.push(`${to} 23:59:59`); }
    if (user) { where.push('username LIKE ?'); params.push(`%${String(user).slice(0, 50)}%`); }
    if (action) { where.push('action LIKE ?'); params.push(`%${String(action).slice(0, 50)}%`); }

    const [rows] = await pool.query(
      `SELECT id, username, role, action, entity, entityId, details, createdAt
       FROM AuditLog ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY id DESC LIMIT 300`,
      params
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Could not load the audit trail.' });
  }
};

exports.getLoginActivity = async (req, res) => {
  try {
    const { from, to, user, role } = req.query;
    const where = [];
    const params = [];
    if (['admin', 'manager', 'staff', 'customer'].includes(role)) { where.push('role = ?'); params.push(role); }
    if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) { where.push('createdAt >= ?'); params.push(`${from} 00:00:00`); }
    if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) { where.push('createdAt <= ?'); params.push(`${to} 23:59:59`); }
    if (user) { where.push('username LIKE ?'); params.push(`%${String(user).slice(0, 50)}%`); }

    // Staff and admin logins come from LoginHistory (includes older ones); customers from the audit log.
    const [rows] = await pool.query(
      `SELECT username, role, createdAt FROM (
         SELECT username, role, logged_in_at AS createdAt FROM LoginHistory
         UNION ALL
         SELECT username, role, createdAt FROM AuditLog WHERE action = 'Logged in' AND role = 'customer'
       ) logins
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY createdAt DESC LIMIT 300`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error('Login activity failed:', err.message);
    res.status(500).json({ error: 'Could not load login activity.' });
  }
};
