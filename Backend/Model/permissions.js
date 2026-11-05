const pool = require('./db');

const PERMISSIONS = [
  { key: 'bookings.view', label: 'View bookings', group: 'Bookings' },
  { key: 'bookings.manage', label: 'Create, edit, confirm, cancel and archive bookings', group: 'Bookings' },
  { key: 'calendar.view', label: 'View booking calendar', group: 'Bookings' },
  { key: 'clients.view', label: 'View client records', group: 'Clients' },
  { key: 'inventory.manage', label: 'Manage inventory', group: 'Operations' },
  { key: 'packages.manage', label: 'Manage packages', group: 'Operations' },
  { key: 'assets.manage', label: 'Manage catering assets', group: 'Operations' },
  { key: 'dishes.manage', label: 'Manage dishes', group: 'Operations' },
  { key: 'reports.view', label: 'View and export reports', group: 'Analytics' },
  { key: 'sales.view', label: 'View sales analytics', group: 'Analytics' },
  { key: 'audit.view', label: 'View audit trail and login activity', group: 'Administration' },
  { key: 'users.manage', label: 'Manage staff and manager accounts, GCash QR', group: 'Administration' },
  { key: 'dropdowns.manage', label: 'Manage dropdown library', group: 'Administration' },
  { key: 'roles.manage', label: 'Manage roles and permissions', group: 'Administration' }
];

const ALL = PERMISSIONS.map((p) => p.key);
const DEFAULTS = {
  admin: ALL,
  manager: ['bookings.view', 'bookings.manage', 'calendar.view', 'clients.view', 'inventory.manage', 'packages.manage', 'assets.manage', 'dishes.manage', 'reports.view', 'sales.view', 'audit.view'],
  staff: ['bookings.view', 'bookings.manage', 'calendar.view']
};
const SYSTEM_ROLES = ['admin', 'manager', 'staff'];
const EDITABLE_ROLES = ['manager', 'staff'];

let cache = null;
let cacheAt = 0;

async function loadMatrix() {
  if (cache && Date.now() - cacheAt < 15000) return cache;
  const [rows] = await pool.query('SELECT role, permission, allowed FROM role_permissions');
  const matrix = { admin: new Set(ALL) };
  rows.forEach((r) => {
    if (!matrix[r.role]) matrix[r.role] = new Set();
    if (Number(r.allowed)) matrix[r.role].add(r.permission);
  });
  cache = matrix;
  cacheAt = Date.now();
  return matrix;
}

function clearCache() { cache = null; }

async function permissionsFor(role) {
  if (role === 'admin') return ALL.slice();
  const matrix = await loadMatrix();
  return [...(matrix[role] || [])];
}

function requirePermission(permission) {
  return async (req, res, next) => {
    try {
      if (req.user?.role === 'admin') return next();
      const matrix = await loadMatrix();
      if (matrix[req.user?.role]?.has(permission)) return next();
      res.status(403).json({ error: 'Your role does not have permission to do this.' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  };
}

async function seedPermissions() {
  for (const role of EDITABLE_ROLES) {
    for (const key of ALL) {
      await pool.query(
        'INSERT INTO role_permissions (role, permission, allowed) VALUES (?, ?, ?) ON CONFLICT (role, permission) DO NOTHING RETURNING role',
        [role, key, DEFAULTS[role].includes(key) ? 1 : 0]
      );
    }
  }
}

async function seedRole(role, permissions = []) {
  for (const key of ALL) {
    await pool.query(
      'INSERT INTO role_permissions (role, permission, allowed) VALUES (?, ?, ?) ON CONFLICT (role, permission) DO NOTHING RETURNING role',
      [role, key, permissions.includes(key) ? 1 : 0]
    );
  }
}

module.exports = {
  PERMISSIONS,
  SYSTEM_ROLES,
  EDITABLE_ROLES,
  permissionsFor,
  requirePermission,
  clearCache,
  seedPermissions,
  seedRole,
  loadMatrix
};
