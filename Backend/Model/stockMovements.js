const pool = require('./db');

async function recordMovement(connOrPool, entry) {
  try {
    const db = connOrPool || pool;
    const changeQty = Math.trunc(Number(entry.changeQty) || 0);
    if (!changeQty && !entry.force) return;
    await db.query(
      `INSERT INTO inventory_movements
        (item_type, item_id, item_name, change_qty, previous_qty, new_qty, reason, reference_booking_id, actor)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        String(entry.itemType || 'ingredient').slice(0, 20),
        Number(entry.itemId) || 0,
        String(entry.itemName || '').slice(0, 120),
        changeQty,
        Math.trunc(Number(entry.previousQty) || 0),
        Math.trunc(Number(entry.newQty) || 0),
        String(entry.reason || 'Stock update').slice(0, 200),
        entry.referenceBookingId ? Number(entry.referenceBookingId) : null,
        entry.actor ? String(entry.actor).slice(0, 80) : null
      ]
    );
  } catch (err) {
    // Movement logging should never block primary operations or stripped unit tests.
  }
}

async function listMovements(itemType = '', limit = 150) {
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 150, 1), 300);
  if (itemType && ['ingredient', 'asset'].includes(itemType)) {
    const [rows] = await pool.query(
      'SELECT * FROM inventory_movements WHERE item_type = ? ORDER BY id DESC LIMIT ?',
      [itemType, safeLimit]
    );
    return rows;
  }
  const [rows] = await pool.query(
    'SELECT * FROM inventory_movements ORDER BY id DESC LIMIT ?',
    [safeLimit]
  );
  return rows;
}

async function getUpcomingReadiness(days = 14) {
  const horizon = Math.min(Math.max(parseInt(days, 10) || 14, 1), 60);
  const todayDate = new Date();
  const endDate = new Date(todayDate.getFullYear(), todayDate.getMonth(), todayDate.getDate() + horizon);
  const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const fromStr = fmt(todayDate);
  const toStr = fmt(endDate);

  const [bookings] = await pool.query(
    `SELECT id, clientName, eventType, package, eventDate
     FROM Bookings
     WHERE status = 'confirmed' AND COALESCE(is_archived, 0) = 0
       AND DATE(eventDate) >= ? AND DATE(eventDate) <= ?
     ORDER BY eventDate ASC`,
    [fromStr, toStr]
  );
  if (!bookings.length) {
    return { upcomingEvents: 0, shortages: [], items: [], windowDays: horizon };
  }

  const pkgCounts = new Map();
  bookings.forEach((b) => {
    const key = String(b.package || '').trim();
    if (key) pkgCounts.set(key, (pkgCounts.get(key) || 0) + 1);
  });
  const pkgNames = Array.from(pkgCounts.keys());
  if (!pkgNames.length) {
    return { upcomingEvents: bookings.length, shortages: [], items: [], windowDays: horizon };
  }

  const placeholders = pkgNames.map(() => '?').join(',');
  const [pkgs] = await pool.query(
    `SELECT id, name FROM Packages WHERE name IN (${placeholders})`,
    pkgNames
  );
  const idByName = new Map();
  pkgs.forEach((p) => idByName.set(p.name, p.id));

  const pkgIds = Array.from(new Set(pkgs.map((p) => p.id)));
  if (!pkgIds.length) {
    return { upcomingEvents: bookings.length, shortages: [], items: [], windowDays: horizon };
  }

  const idPlaceholders = pkgIds.map(() => '?').join(',');
  const [invNeeds] = await pool.query(
    `SELECT pd.package_id, di.inventory_id, i.name, i.unit, i.quantity AS current_stock,
            CAST(SUM(di.qty_required) AS SIGNED) AS qty_per_event
     FROM (SELECT DISTINCT package_id, dish_id FROM PackageDishes WHERE package_id IN (${idPlaceholders})) pd
     JOIN DishIngredients di ON di.dish_id = pd.dish_id
     JOIN Inventory i ON i.id = di.inventory_id
     GROUP BY pd.package_id, di.inventory_id, i.name, i.unit, i.quantity`,
    pkgIds
  );
  const [assetNeeds] = await pool.query(
    `SELECT pa.package_id, pa.asset_id, a.name, a.unit, a.quantity AS current_stock,
            CAST(SUM(pa.qty_required) AS SIGNED) AS qty_per_event
     FROM PackageAssets pa
     JOIN CateringAssets a ON a.id = pa.asset_id
     WHERE pa.package_id IN (${idPlaceholders})
     GROUP BY pa.package_id, pa.asset_id, a.name, a.unit, a.quantity`,
    pkgIds
  );

  const countByPkgId = new Map();
  pkgCounts.forEach((count, name) => {
    const id = idByName.get(name);
    if (id) countByPkgId.set(id, (countByPkgId.get(id) || 0) + count);
  });

  const merged = new Map();
  const addNeed = (type, id, name, unit, stock, perEvent, pkgId) => {
    const eventsUsing = countByPkgId.get(pkgId) || 0;
    if (!eventsUsing) return;
    const key = `${type}:${id}`;
    const existing = merged.get(key) || {
      item_type: type,
      item_id: id,
      name,
      unit: unit || '',
      current_stock: Math.trunc(Number(stock) || 0),
      required_qty: 0
    };
    existing.required_qty += Math.trunc(Number(perEvent) || 0) * eventsUsing;
    merged.set(key, existing);
  };

  invNeeds.forEach((r) => addNeed('ingredient', r.inventory_id, r.name, r.unit, r.current_stock, r.qty_per_event, r.package_id));
  assetNeeds.forEach((r) => addNeed('asset', r.asset_id, r.name, r.unit, r.current_stock, r.qty_per_event, r.package_id));

  const items = Array.from(merged.values()).map((it) => ({
    ...it,
    deficit: Math.max(0, it.required_qty - it.current_stock),
    sufficient: it.current_stock >= it.required_qty
  })).sort((a, b) => b.deficit - a.deficit || a.name.localeCompare(b.name));

  return {
    upcomingEvents: bookings.length,
    windowDays: horizon,
    shortages: items.filter((i) => !i.sufficient),
    items
  };
}

async function createApprovalRequest({ actionType, targetType, targetId, itemName, payload, summary, user }) {
  const [result] = await pool.query(
    `INSERT INTO inventory_approval_requests
      (action_type, target_type, target_id, item_name, payload, summary, requested_by, requested_role)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      String(actionType).slice(0, 40),
      String(targetType).slice(0, 20),
      targetId ? Number(targetId) : null,
      String(itemName || '').slice(0, 120),
      JSON.stringify(payload || {}),
      String(summary || '').slice(0, 300),
      String(user?.username || 'manager').slice(0, 80),
      String(user?.role || 'manager').slice(0, 30)
    ]
  );
  return result.insertId;
}

async function listApprovalRequests(statusFilter = '') {
  if (statusFilter && ['pending', 'approved', 'rejected'].includes(statusFilter)) {
    const [rows] = await pool.query(
      'SELECT * FROM inventory_approval_requests WHERE status = ? ORDER BY id DESC LIMIT 150',
      [statusFilter]
    );
    return rows;
  }
  const [rows] = await pool.query('SELECT * FROM inventory_approval_requests ORDER BY CASE WHEN status = \'pending\' THEN 0 ELSE 1 END, id DESC LIMIT 150');
  return rows;
}

module.exports = {
  recordMovement,
  listMovements,
  getUpcomingReadiness,
  createApprovalRequest,
  listApprovalRequests
};

