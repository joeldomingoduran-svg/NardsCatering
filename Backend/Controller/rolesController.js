const pool = require('../Model/db');
const { PERMISSIONS, SYSTEM_ROLES, EDITABLE_ROLES, permissionsFor, clearCache, loadMatrix, seedRole } = require('../Model/permissions');
const { notify } = require('../Model/notifications');

exports.myPermissions = async (req, res) => {
  try {
    res.json({ role: req.user.role, permissions: await permissionsFor(req.user.role) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getMatrix = async (req, res) => {
  try {
    const matrix = await loadMatrix();
    const [definitions] = await pool.query(
      `SELECT r.role, r.display_name, r.description, r.is_active, r.is_system,
              COUNT(u.id)::integer AS user_count
         FROM role_definitions r LEFT JOIN StaffUsers u ON u.role = r.role
        GROUP BY r.role, r.display_name, r.description, r.is_active, r.is_system
        ORDER BY r.is_system DESC, r.display_name ASC`
    );
    const roles = {};
    definitions.forEach((role) => { roles[role.role] = [...(matrix[role.role] || [])]; });
    res.json({ permissions: PERMISSIONS, editableRoles: definitions.filter((r) => !Number(r.is_system)).map((r) => r.role), roles, definitions });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.updateRole = async (req, res) => {
  try {
    const role = req.params.role;
    if (SYSTEM_ROLES.includes(role) && role === 'admin') return res.status(400).json({ error: 'The administrator role is protected.' });
    const [definitions] = await pool.query('SELECT role, is_system FROM role_definitions WHERE role = ? LIMIT 1', [role]);
    if (!definitions.length) return res.status(404).json({ error: 'Role not found.' });
    const granted = Array.isArray(req.body.permissions) ? req.body.permissions : null;
    if (!granted) return res.status(400).json({ error: 'permissions must be a list.' });
    const valid = new Set(PERMISSIONS.map((p) => p.key));
    // Only admins may hold the administration permissions that manage access itself.
    const locked = new Set(['roles.manage', 'users.manage', 'dropdowns.manage']);
    for (const p of PERMISSIONS) {
      const allowed = granted.includes(p.key) && valid.has(p.key) && !locked.has(p.key) ? 1 : 0;
      await pool.query(
        'INSERT INTO role_permissions (role, permission, allowed) VALUES (?, ?, ?) ON CONFLICT (role, permission) DO UPDATE SET allowed = EXCLUDED.allowed RETURNING role',
        [role, p.key, allowed]
      );
    }
    clearCache();
    await notify('roles', 'Permissions updated', `Permissions for the ${role} role were changed by ${req.user.username}.`, ['admin']);
    res.json({ message: 'Permissions saved.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

function roleKey(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 20);
}

exports.createRole = async (req, res) => {
  try {
    const role = roleKey(req.body.role || req.body.displayName);
    const displayName = String(req.body.displayName || '').trim().replace(/\s+/g, ' ');
    const description = String(req.body.description || '').trim().slice(0, 255);
    if (!role || !displayName) return res.status(400).json({ error: 'Role name is required.' });
    if (SYSTEM_ROLES.includes(role)) return res.status(409).json({ error: 'That system role already exists.' });
    const granted = Array.isArray(req.body.permissions) ? req.body.permissions : [];
    const valid = new Set(PERMISSIONS.map((p) => p.key));
    const locked = new Set(['roles.manage', 'users.manage', 'dropdowns.manage']);
    const permissions = granted.filter((p) => valid.has(p) && !locked.has(p));
    await pool.query(
      'INSERT INTO role_definitions (role, display_name, description, is_active, is_system) VALUES (?, ?, ?, 1, 0) RETURNING role',
      [role, displayName, description || null]
    );
    await seedRole(role, permissions);
    clearCache();
    await notify('roles', 'Role created', `The ${displayName} role was created by ${req.user.username}.`, ['admin']);
    res.status(201).json({ message: 'Role created.', role });
  } catch (error) {
    if (error.code === '23505' || /duplicate|unique/i.test(error.message)) return res.status(409).json({ error: 'A role with that name already exists.' });
    res.status(500).json({ error: error.message });
  }
};

exports.editRole = async (req, res) => {
  try {
    const role = req.params.role;
    const [rows] = await pool.query('SELECT role, is_system FROM role_definitions WHERE role = ? LIMIT 1', [role]);
    if (!rows.length) return res.status(404).json({ error: 'Role not found.' });
    if (Number(rows[0].is_system)) return res.status(400).json({ error: 'System roles cannot be renamed.' });
    const displayName = String(req.body.displayName || '').trim().replace(/\s+/g, ' ');
    const description = String(req.body.description || '').trim().slice(0, 255);
    if (!displayName) return res.status(400).json({ error: 'Role name is required.' });
    await pool.query('UPDATE role_definitions SET display_name = ?, description = ?, updated_at = NOW() WHERE role = ?', [displayName, description || null, role]);
    clearCache();
    res.json({ message: 'Role updated.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.setStatus = async (req, res) => {
  try {
    const role = req.params.role;
    const [rows] = await pool.query('SELECT role, is_system FROM role_definitions WHERE role = ? LIMIT 1', [role]);
    if (!rows.length) return res.status(404).json({ error: 'Role not found.' });
    if (Number(rows[0].is_system)) return res.status(400).json({ error: 'System roles cannot be deactivated.' });
    const active = req.body.is_active ? 1 : 0;
    await pool.query('UPDATE role_definitions SET is_active = ?, updated_at = NOW() WHERE role = ?', [active, role]);
    clearCache();
    await notify('roles', active ? 'Role activated' : 'Role deactivated', `The ${role} role was ${active ? 'activated' : 'deactivated'} by ${req.user.username}.`, ['admin']);
    res.json({ message: active ? 'Role activated.' : 'Role deactivated.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
