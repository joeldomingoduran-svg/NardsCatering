const pool = require('./db');

// Audit logging must never break the request it describes.
async function writeAudit(actor, action, entity, entityId, details) {
  try {
    await pool.query(
      'INSERT INTO AuditLog (userId, username, role, action, entity, entityId, details) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [
        actor?.id ?? null,
        String(actor?.username || actor?.name || 'system').slice(0, 100),
        String(actor?.role || 'system').slice(0, 20),
        String(action).slice(0, 80),
        entity ? String(entity).slice(0, 40) : null,
        entityId != null ? String(entityId).slice(0, 40) : null,
        details ? String(details).slice(0, 500) : null
      ]
    );
  } catch (err) {
    console.warn('Audit log write failed:', err.message);
  }
}

module.exports = { writeAudit };
