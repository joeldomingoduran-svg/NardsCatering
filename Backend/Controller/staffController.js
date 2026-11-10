const pool = require('../Model/db');
const { createAuthToken } = require('../Middleware/authMiddleware');
const { writeAudit } = require('../Model/audit');
const { isRealName } = require('../Model/validators');
const { hashPassword, verifyPassword } = require('../Model/passwordUtils');

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    role: user.role,
    profileImage: user.profileImage || null,
    is_active: Boolean(user.is_active),
    created_at: user.created_at
  };
}

exports.login = async (req, res) => {
  try {
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');
    if (!username || !password) return res.status(400).json({ error: 'Username and password are required.' });

    const [rows] = await pool.query(
      `SELECT u.id, u.name, u.username, u.password, u.role, u.profileImage, u.is_active, u.created_at,
              COALESCE(r.is_active, 1) AS role_active
         FROM StaffUsers u LEFT JOIN role_definitions r ON r.role = u.role
        WHERE u.username = ? LIMIT 1`,
      [username]
    );
    const user = rows[0];
    if (!user || !user.is_active || !Number(user.role_active)) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }
    
    const passwordMatch = await verifyPassword(password, user.password);
    if (!passwordMatch) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }
    
    await pool.query(
      'INSERT INTO LoginHistory (user_id, username, role) VALUES (?, ?, ?)',
      [user.id, user.username, user.role]
    );
    await writeAudit(user, 'Logged in', 'session', user.id, null);

    res.json({ message: 'Login successful.', token: createAuthToken(user), user: publicUser(user) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getOwnProfile = async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, name, username, role, profileImage, is_active, created_at FROM StaffUsers WHERE id = ? AND is_active = 1 LIMIT 1',
      [req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Staff account not found.' });
    res.json({ user: publicUser(rows[0]) });
  } catch (error) {
    res.status(500).json({ error: 'Could not load your profile.' });
  }
};

exports.updateOwnProfile = async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    if (!isRealName(name)) return res.status(400).json({ error: 'Enter your real full name.' });

    const profileImage = req.file ? req.file.url : null;
    await pool.query(
      `UPDATE StaffUsers SET name = ?${profileImage ? ', profileImage = ?' : ''}
       WHERE id = ? AND is_active = 1`,
      profileImage ? [name, profileImage, req.user.id] : [name, req.user.id]
    );

    const [rows] = await pool.query(
      'SELECT id, name, username, role, profileImage, is_active, created_at FROM StaffUsers WHERE id = ? AND is_active = 1',
      [req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Staff account not found.' });
    res.json({ message: 'Profile updated.', user: publicUser(rows[0]) });
  } catch (error) {
    res.status(500).json({ error: 'Could not update your profile.' });
  }
};

exports.changeOwnPassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Current and new password are required.' });
    if (String(newPassword).length < 10) return res.status(400).json({ error: 'Password must be at least 10 characters long and include uppercase, lowercase, numbers, and special characters.' });
    if (!/[A-Z]/.test(newPassword) || !/[a-z]/.test(newPassword) || !/[0-9]/.test(newPassword) || !/[^A-Za-z0-9]/.test(newPassword)) {
      return res.status(400).json({ error: 'Password must include uppercase, lowercase, numbers, and special characters.' });
    }

    const [rows] = await pool.query('SELECT password FROM StaffUsers WHERE id = ? AND is_active = 1', [req.user.id]);
    if (!rows.length) return res.status(404).json({ error: 'Account not found.' });
    
    const passwordMatch = await verifyPassword(currentPassword, rows[0].password);
    if (!passwordMatch) {
      return res.status(400).json({ error: 'Current password is incorrect.' });
    }
    
    const hashedPassword = await hashPassword(newPassword);
    await pool.query('UPDATE StaffUsers SET password = ? WHERE id = ?', [hashedPassword, req.user.id]);
    res.json({ message: 'Password updated.' });
  } catch (error) {
    res.status(500).json({ error: 'Could not update the password.' });
  }
};

exports.getUsers = async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, name, username, role, profileImage, is_active, created_at FROM StaffUsers ORDER BY role DESC, id ASC'
    );
    res.json(rows.map(publicUser));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.createUser = async (req, res) => {
  try {
    const { name, username, password, role = 'staff' } = req.body;
    if (!name || !username || !password) return res.status(400).json({ error: 'Name, username, and password are required.' });
    const [roleRows] = await pool.query('SELECT role FROM role_definitions WHERE role = ? AND is_active = 1 LIMIT 1', [role]);
    if (!roleRows.length || role === 'admin') return res.status(400).json({ error: 'Choose an active non-administrator role.' });
    if (!isRealName(name)) return res.status(400).json({ error: 'Enter the staff member\'s real full name.' });
    if (String(password).length < 10) return res.status(400).json({ error: 'Password must be at least 10 characters long and include uppercase, lowercase, numbers, and special characters.' });
    if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
      return res.status(400).json({ error: 'Password must include uppercase, lowercase, numbers, and special characters.' });
    }

    const hashedPassword = await hashPassword(password);
    const [result] = await pool.query(
      'INSERT INTO StaffUsers (name, username, password, role, is_active) VALUES (?, ?, ?, ?, 1)',
      [String(name).trim(), String(username).trim(), hashedPassword, role]
    );
    const [rows] = await pool.query(
      'SELECT id, name, username, role, is_active, created_at FROM StaffUsers WHERE id = ?',
      [result.insertId]
    );
    res.status(201).json({ message: 'Account created.', user: publicUser(rows[0]) });
  } catch (error) {
    res.status(error.code === 'ER_DUP_ENTRY' ? 409 : 500).json({
      error: error.code === 'ER_DUP_ENTRY' ? 'That username is already in use.' : error.message
    });
  }
};

exports.updateUser = async (req, res) => {
  try {
    const { name, password, role } = req.body;
    if (!name || String(name).trim().length < 2) return res.status(400).json({ error: 'A valid name is required.' });
    if (!isRealName(name)) return res.status(400).json({ error: 'Enter the staff member\'s real full name.' });
    const values = [String(name).trim()];
    let query = 'UPDATE StaffUsers SET name = ?';
    if (password) {
      if (String(password).length < 10) return res.status(400).json({ error: 'Password must be at least 10 characters long and include uppercase, lowercase, numbers, and special characters.' });
      if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
        return res.status(400).json({ error: 'Password must include uppercase, lowercase, numbers, and special characters.' });
      }
      const hashedPassword = await hashPassword(password);
      query += ', password = ?';
      values.push(hashedPassword);
    }
    if (role) {
      const [roleRows] = await pool.query('SELECT role FROM role_definitions WHERE role = ? AND is_active = 1 LIMIT 1', [role]);
      if (!roleRows.length || role === 'admin') return res.status(400).json({ error: 'Choose an active non-administrator role.' });
      query += ', role = ?';
      values.push(role);
    }
    query += ' WHERE id = ? AND role <> \'admin\'';
    values.push(req.params.id);

    const [result] = await pool.query(query, values);
    if (!result.affectedRows) return res.status(404).json({ error: 'Staff account not found.' });
    res.json({ message: 'Staff account updated.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.setStatus = async (req, res) => {
  try {
    const isActive = req.body.is_active ? 1 : 0;
    const [result] = await pool.query(
      'UPDATE StaffUsers SET is_active = ? WHERE id = ? AND role IN (\'staff\', \'manager\')',
      [isActive, req.params.id]
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'Staff account not found.' });
    res.json({ message: isActive ? 'Staff account activated.' : 'Staff account disabled.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.deleteUser = async (req, res) => {
  try {
    const [result] = await pool.query('DELETE FROM StaffUsers WHERE id = ? AND role IN (\'staff\', \'manager\')', [req.params.id]);
    if (!result.affectedRows) return res.status(404).json({ error: 'Staff account not found.' });
    res.json({ message: 'Staff account deleted.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
