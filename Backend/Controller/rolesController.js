const pool = require('../Model/db');
const { PERMISSIONS, EDITABLE_ROLES, permissionsFor, clearCache, loadMatrix } = require('../Model/permissions');
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
    const roles = {};
    for (const role of ['admin', ...EDITABLE_ROLES]) roles[role] = [...matrix[role]];
    res.json({ permissions: PERMISSIONS, editableRoles: EDITABLE_ROLES, roles });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.updateRole = async (req, res) => {
  try {
    const role = req.params.role;
    if (!EDITABLE_ROLES.includes(role)) return res.status(400).json({ error: 'This role cannot be edited.' });
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
