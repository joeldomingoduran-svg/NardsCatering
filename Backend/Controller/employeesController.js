const pool = require('../Model/db');
const { isRealName, isValidHumanText } = require('../Model/validators');

function clean(value, max) {
  return String(value || '').trim().slice(0, max);
}

exports.list = async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, name, age, address, job_role, is_active, created_at FROM employees ORDER BY name ASC'
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.create = async (req, res) => {
  try {
    const name = clean(req.body.name, 120);
    const age = Number(req.body.age);
    const address = clean(req.body.address, 255);
    const jobRole = clean(req.body.jobRole, 60);
    if (!isRealName(name)) {
      return res.status(400).json({ error: 'Enter the staff member\'s real full name (first and last name).' });
    }
    if (!Number.isInteger(age) || age < 15 || age > 100) {
      return res.status(400).json({ error: 'Age must be a whole number between 15 and 100.' });
    }
    if (!isValidHumanText(address, 5)) {
      return res.status(400).json({ error: 'Enter a valid complete address (at least 5 characters).' });
    }
    if (!isValidHumanText(jobRole, 2) || /\d/.test(jobRole)) {
      return res.status(400).json({ error: 'Enter a valid job role (letters only, e.g. Cook, Server, Driver).' });
    }
    const [result] = await pool.query(
      'INSERT INTO employees (name, age, address, job_role, is_active) VALUES (?, ?, ?, ?, 1) RETURNING id',
      [name, age, address, jobRole]
    );
    res.status(201).json({ message: 'Employee added.', id: result.insertId });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.update = async (req, res) => {
  try {
    const name = clean(req.body.name, 120);
    const age = Number(req.body.age);
    const address = clean(req.body.address, 255);
    const jobRole = clean(req.body.jobRole, 60);
    if (!isRealName(name)) {
      return res.status(400).json({ error: 'Enter the staff member\'s real full name (first and last name).' });
    }
    if (!Number.isInteger(age) || age < 15 || age > 100) {
      return res.status(400).json({ error: 'Age must be a whole number between 15 and 100.' });
    }
    if (!isValidHumanText(address, 5)) {
      return res.status(400).json({ error: 'Enter a valid complete address (at least 5 characters).' });
    }
    if (!isValidHumanText(jobRole, 2) || /\d/.test(jobRole)) {
      return res.status(400).json({ error: 'Enter a valid job role (letters only, e.g. Cook, Server, Driver).' });
    }
    const [result] = await pool.query(
      'UPDATE employees SET name = ?, age = ?, address = ?, job_role = ?, updated_at = NOW() WHERE id = ?',
      [name, age, address, jobRole, req.params.id]
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'Employee not found.' });
    res.json({ message: 'Employee updated.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.setStatus = async (req, res) => {
  try {
    const [result] = await pool.query('UPDATE employees SET is_active = ? WHERE id = ?', [req.body.is_active ? 1 : 0, req.params.id]);
    if (!result.affectedRows) return res.status(404).json({ error: 'Employee not found.' });
    res.json({ message: req.body.is_active ? 'Employee activated.' : 'Employee deactivated.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getTeam = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT e.id, e.name, e.job_role FROM booking_employee_assignments a
       JOIN employees e ON e.id = a.employee_id
       WHERE a.booking_id = ? AND e.is_active = 1 ORDER BY e.name`,
      [req.params.id]
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.setTeam = async (req, res) => {
  try {
    if (String(req.user?.role || '').toLowerCase() === 'staff') {
      return res.status(403).json({ error: 'Staff accounts have view-only access to assigned bookings.' });
    }
    const ids = Array.isArray(req.body.employeeIds) ? [...new Set(req.body.employeeIds.map(Number).filter(Number.isInteger))] : [];
    await pool.query('DELETE FROM booking_employee_assignments WHERE booking_id = ?', [req.params.id]);
    for (const employeeId of ids) {
      await pool.query(
        'INSERT INTO booking_employee_assignments (booking_id, employee_id) VALUES (?, ?) ON CONFLICT DO NOTHING RETURNING booking_id',
        [req.params.id, employeeId]
      );
    }
    res.json({ message: 'Event team updated.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
