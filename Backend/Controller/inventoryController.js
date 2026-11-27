const pool = require('../Model/db');
const { writeAudit } = require('../Model/audit');
const { notify } = require('../Model/notifications');
const {
  recordMovement,
  listMovements,
  getUpcomingReadiness,
  createApprovalRequest,
  listApprovalRequests
} = require('../Model/stockMovements');

function parseIngredientInput(body = {}) {
  const name = String(body.name || '').trim().slice(0, 120);
  const category = String(body.category || 'Other').trim().slice(0, 80) || 'Other';
  const unit = String(body.unit || 'pcs').trim().slice(0, 40) || 'pcs';
  const quantity = Number(body.quantity ?? 0);
  const threshold = Number(body.threshold ?? 0);
  const goodLevelRaw = body.good_level ?? body.goodLevel;
  const good_level = goodLevelRaw != null && goodLevelRaw !== ''
    ? Math.max(0, Math.trunc(Number(goodLevelRaw) || 0))
    : Math.max(threshold * 3, 1);
  const is_perishable = body.is_perishable ? 1 : 0;
  const rawExp = String(body.expiry_date ?? body.expiryDate ?? '').trim();
  const expiry_date = /^\d{4}-\d{2}-\d{2}$/.test(rawExp) ? rawExp : null;
  const cost_per_unit = Math.max(0, Math.round((Number(body.cost_per_unit ?? body.costPerUnit ?? 0) || 0) * 100) / 100);
  const supplier = String(body.supplier || '').trim().slice(0, 120) || null;
  return { name, category, unit, quantity, threshold, good_level, is_perishable, expiry_date, cost_per_unit, supplier };
}

exports.getAllInventory = async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM Inventory ORDER BY id DESC');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.createInventory = async (req, res) => {
  try {
    const parsed = parseIngredientInput(req.body);
    if (!parsed.name) return res.status(400).json({ error: 'Name is required' });
    const [existing] = await pool.query(
      'SELECT id FROM Inventory WHERE LOWER(TRIM(name))=LOWER(TRIM(?)) LIMIT 1',
      [parsed.name]
    );
    if (existing.length) return res.status(409).json({ error: 'An ingredient with this name already exists' });
    if (!Number.isInteger(parsed.quantity) || parsed.quantity < 0 || !Number.isInteger(parsed.threshold) || parsed.threshold < 0) {
      return res.status(400).json({ error: 'Quantity and threshold must be whole numbers (0 or greater)' });
    }
    if (parsed.is_perishable && !parsed.expiry_date) {
      return res.status(400).json({ error: 'Expiration date is required for perishable items.' });
    }

    if (req.user?.role === 'manager') {
      const requestId = await createApprovalRequest({
        actionType: 'create',
        targetType: 'ingredient',
        itemName: parsed.name,
        payload: parsed,
        summary: `Add ingredient "${parsed.name}" (${parsed.quantity} ${parsed.unit}${parsed.is_perishable ? ', perishable, exp ' + parsed.expiry_date : ''})`,
        user: req.user
      });
      await notify('approval', 'Inventory Approval Required', `${req.user.username} requested to add "${parsed.name}" (${parsed.quantity} ${parsed.unit}).`, ['admin'], 'inventory');
      return res.status(202).json({ pendingApproval: true, requestId, message: 'Submitted for Administrator approval.' });
    }

    const [result] = await pool.query(
      `INSERT INTO Inventory (name, category, quantity, unit, threshold, good_level, is_perishable, expiry_date, cost_per_unit, supplier, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [parsed.name, parsed.category, parsed.quantity, parsed.unit, parsed.threshold, parsed.good_level, parsed.is_perishable, parsed.expiry_date, parsed.cost_per_unit, parsed.supplier]
    );
    await recordMovement(pool, {
      itemType: 'ingredient',
      itemId: result.insertId,
      itemName: parsed.name,
      changeQty: parsed.quantity,
      previousQty: 0,
      newQty: parsed.quantity,
      reason: 'Initial stock added',
      actor: req.user?.username || 'system'
    });
    res.status(201).json({ message: 'Inventory item created', inventoryId: result.insertId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getInventoryById = async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM Inventory WHERE id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Inventory item not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.updateInventory = async (req, res) => {
  try {
    const [prevRows] = await pool.query('SELECT * FROM Inventory WHERE id=? LIMIT 1', [req.params.id]);
    if (!prevRows.length) return res.status(404).json({ error: 'Inventory item not found' });
    const prev = prevRows[0];

    const mergedBody = {
      ...prev,
      ...req.body,
      category: req.body.category ?? prev.category,
      unit: req.body.unit ?? prev.unit,
      good_level: req.body.good_level ?? req.body.goodLevel ?? prev.good_level,
      is_perishable: req.body.is_perishable !== undefined ? req.body.is_perishable : prev.is_perishable,
      expiry_date: req.body.expiry_date !== undefined ? req.body.expiry_date : (req.body.expiryDate !== undefined ? req.body.expiryDate : prev.expiry_date),
      cost_per_unit: req.body.cost_per_unit ?? req.body.costPerUnit ?? prev.cost_per_unit,
      supplier: req.body.supplier !== undefined ? req.body.supplier : prev.supplier
    };
    const parsed = parseIngredientInput(mergedBody);
    if (!parsed.name) return res.status(400).json({ error: 'Name is required' });

    const [existing] = await pool.query(
      'SELECT id FROM Inventory WHERE LOWER(TRIM(name))=LOWER(TRIM(?)) AND id<>? LIMIT 1',
      [parsed.name, req.params.id]
    );
    if (existing.length) return res.status(409).json({ error: 'An ingredient with this name already exists' });
    if (!Number.isInteger(parsed.quantity) || parsed.quantity < 0 || !Number.isInteger(parsed.threshold) || parsed.threshold < 0) {
      return res.status(400).json({ error: 'Quantity and threshold must be whole numbers (0 or greater)' });
    }
    if (parsed.is_perishable && !parsed.expiry_date) {
      return res.status(400).json({ error: 'Expiration date is required for perishable items.' });
    }

    const prevQty = Math.trunc(Number(prev.quantity) || 0);
    if (req.user?.role === 'manager') {
      const diff = parsed.quantity - prevQty;
      const isRestock = diff > 0 && req.body.reason && String(req.body.reason).toLowerCase().includes('restock');
      const requestId = await createApprovalRequest({
        actionType: isRestock ? 'restock' : 'update',
        targetType: 'ingredient',
        targetId: prev.id,
        itemName: parsed.name,
        payload: { ...parsed, reason: req.body.reason || '' },
        summary: diff !== 0
          ? `${isRestock ? 'Restock' : 'Update'} "${parsed.name}": stock ${prevQty} -> ${parsed.quantity} ${parsed.unit}`
          : `Update details for "${parsed.name}"`,
        user: req.user
      });
      await notify('approval', 'Inventory Approval Required', `${req.user.username} requested to update "${parsed.name}".`, ['admin'], 'inventory');
      return res.status(202).json({ pendingApproval: true, requestId, message: 'Submitted for Administrator approval.' });
    }

    await pool.query(
      `UPDATE Inventory
       SET name=?, category=?, quantity=?, unit=?, threshold=?, good_level=?, is_perishable=?, expiry_date=?, cost_per_unit=?, supplier=?, updated_at=NOW()
       WHERE id=?`,
      [parsed.name, parsed.category, parsed.quantity, parsed.unit, parsed.threshold, parsed.good_level, parsed.is_perishable, parsed.expiry_date, parsed.cost_per_unit, parsed.supplier, req.params.id]
    );
    if (parsed.quantity !== prevQty) {
      const diff = parsed.quantity - prevQty;
      await recordMovement(pool, {
        itemType: 'ingredient',
        itemId: req.params.id,
        itemName: parsed.name,
        changeQty: diff,
        previousQty: prevQty,
        newQty: parsed.quantity,
        reason: req.body.reason || (diff > 0 ? `Restocked (+${diff})` : `Manual adjustment (${diff})`),
        actor: req.user?.username || 'system'
      });
    }
    res.json({ message: 'Inventory updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.disposeInventory = async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM Inventory WHERE id = ? LIMIT 1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Inventory item not found' });
    const item = rows[0];
    const currentQty = Math.trunc(Number(item.quantity) || 0);
    const disposeQty = Math.trunc(Number(req.body?.quantity ?? currentQty));
    if (!Number.isInteger(disposeQty) || disposeQty < 1 || disposeQty > currentQty) {
      return res.status(400).json({ error: `Enter a disposal quantity between 1 and ${currentQty}.` });
    }
    const reason = String(req.body?.reason || 'Expired / Spoiled stock disposed').trim().slice(0, 180);

    if (req.user?.role === 'manager') {
      const requestId = await createApprovalRequest({
        actionType: 'dispose',
        targetType: 'ingredient',
        targetId: item.id,
        itemName: item.name,
        payload: { quantity: disposeQty, reason },
        summary: `Dispose ${disposeQty} ${item.unit || 'pcs'} of "${item.name}" (${reason})`,
        user: req.user
      });
      await notify('approval', 'Inventory Disposal Approval Required', `${req.user.username} requested disposal of ${disposeQty} "${item.name}".`, ['admin'], 'inventory');
      return res.status(202).json({ pendingApproval: true, requestId, message: 'Disposal request submitted for Administrator approval.' });
    }

    const newQty = Math.max(0, currentQty - disposeQty);
    await pool.query('UPDATE Inventory SET quantity = ?, updated_at = NOW() WHERE id = ?', [newQty, item.id]);
    await recordMovement(pool, {
      itemType: 'ingredient',
      itemId: item.id,
      itemName: item.name,
      changeQty: -disposeQty,
      previousQty: currentQty,
      newQty,
      reason,
      actor: req.user?.username || 'system'
    });
    res.json({ message: `Disposed ${disposeQty} ${item.unit || ''} of ${item.name}.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.deleteInventory = async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, name FROM Inventory WHERE id=? AND is_archived=0 LIMIT 1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Inventory item not found' });
    if (req.user?.role === 'manager') {
      const requestId = await createApprovalRequest({
        actionType: 'archive',
        targetType: 'ingredient',
        targetId: rows[0].id,
        itemName: rows[0].name,
        payload: { archived: true },
        summary: `Archive ingredient "${rows[0].name}"`,
        user: req.user
      });
      await notify('approval', 'Inventory Approval Required', `${req.user.username} requested to archive "${rows[0].name}".`, ['admin'], 'inventory');
      return res.status(202).json({ pendingApproval: true, requestId, message: 'Archive request submitted for Administrator approval.' });
    }
    const [result] = await pool.query('UPDATE Inventory SET is_archived=1 WHERE id=? AND is_archived=0', [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Inventory item not found' });
    res.json({ message: 'Inventory archived' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.archiveInventory = async (req, res) => {
  try {
    const archived = req.body.archived === true;
    const [current] = await pool.query('SELECT id, name FROM Inventory WHERE id=?', [req.params.id]);
    if (!current.length) return res.status(404).json({ error: 'Inventory item not found' });
    if (!archived) {
      const [existing] = await pool.query(
        'SELECT id FROM Inventory WHERE LOWER(TRIM(name))=LOWER(TRIM(?)) AND id<>? LIMIT 1',
        [current[0].name, req.params.id]
      );
      if (existing.length) return res.status(409).json({ error: 'Another ingredient with this name already exists' });
    }
    if (req.user?.role === 'manager') {
      const requestId = await createApprovalRequest({
        actionType: archived ? 'archive' : 'restore',
        targetType: 'ingredient',
        targetId: current[0].id,
        itemName: current[0].name,
        payload: { archived },
        summary: `${archived ? 'Archive' : 'Restore'} ingredient "${current[0].name}"`,
        user: req.user
      });
      await notify('approval', 'Inventory Approval Required', `${req.user.username} requested to ${archived ? 'archive' : 'restore'} "${current[0].name}".`, ['admin'], 'inventory');
      return res.status(202).json({ pendingApproval: true, requestId, message: 'Submitted for Administrator approval.' });
    }
    const [result] = await pool.query(
      'UPDATE Inventory SET is_archived=? WHERE id=?',
      [archived ? 1 : 0, req.params.id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Inventory item not found' });
    res.json({ message: archived ? 'Inventory archived' : 'Inventory restored' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getMovements = async (req, res) => {
  try {
    const rows = await listMovements(String(req.query.item_type || ''), req.query.limit);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getReadiness = async (req, res) => {
  try {
    const summary = await getUpcomingReadiness(req.query.days);
    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getApprovals = async (req, res) => {
  try {
    const rows = await listApprovalRequests(String(req.query.status || ''));
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.reviewApproval = async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const decision = String(req.body?.decision || '').toLowerCase();
    if (!['approved', 'rejected'].includes(decision)) {
      return res.status(400).json({ error: 'Choose approved or rejected.' });
    }
    const reviewNotes = String(req.body?.reviewNotes || '').trim().slice(0, 300);

    await conn.beginTransaction();
    const [rows] = await conn.query('SELECT * FROM inventory_approval_requests WHERE id = ? FOR UPDATE', [req.params.id]);
    const reqRow = rows[0];
    if (!reqRow) {
      await conn.rollback();
      return res.status(404).json({ error: 'Approval request not found.' });
    }
    if (reqRow.status !== 'pending') {
      await conn.rollback();
      return res.status(400).json({ error: `This request was already ${reqRow.status}.` });
    }

    if (decision === 'approved') {
      const payload = JSON.parse(reqRow.payload || '{}');
      const actorLabel = `${reqRow.requested_by} (approved by ${req.user.username})`;
      if (reqRow.target_type === 'ingredient') {
        if (reqRow.action_type === 'create') {
          const [dupe] = await conn.query('SELECT id FROM Inventory WHERE LOWER(TRIM(name))=LOWER(TRIM(?)) LIMIT 1', [payload.name]);
          if (dupe.length) {
            await conn.rollback();
            return res.status(409).json({ error: 'An ingredient with this name already exists.' });
          }
          const [ins] = await conn.query(
            `INSERT INTO Inventory (name, category, quantity, unit, threshold, good_level, is_perishable, expiry_date, cost_per_unit, supplier, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
            [payload.name, payload.category || 'Other', payload.quantity || 0, payload.unit || 'pcs', payload.threshold || 0, payload.good_level || 0, payload.is_perishable ? 1 : 0, payload.expiry_date || null, payload.cost_per_unit || 0, payload.supplier || null]
          );
          await recordMovement(conn, {
            itemType: 'ingredient', itemId: ins.insertId, itemName: payload.name,
            changeQty: Number(payload.quantity) || 0, previousQty: 0, newQty: Number(payload.quantity) || 0,
            reason: 'Initial stock added (Admin approved)', actor: actorLabel
          });
        } else if (reqRow.action_type === 'update' || reqRow.action_type === 'restock') {
          const [cur] = await conn.query('SELECT quantity FROM Inventory WHERE id=? LIMIT 1', [reqRow.target_id]);
          if (!cur.length) { await conn.rollback(); return res.status(404).json({ error: 'Target ingredient no longer exists.' }); }
          const prevQty = Math.trunc(Number(cur[0].quantity) || 0);
          const newQty = Math.trunc(Number(payload.quantity) || 0);
          await conn.query(
            `UPDATE Inventory SET name=?, category=?, quantity=?, unit=?, threshold=?, good_level=?, is_perishable=?, expiry_date=?, cost_per_unit=?, supplier=?, updated_at=NOW() WHERE id=?`,
            [payload.name, payload.category || 'Other', newQty, payload.unit || 'pcs', payload.threshold || 0, payload.good_level || 0, payload.is_perishable ? 1 : 0, payload.expiry_date || null, payload.cost_per_unit || 0, payload.supplier || null, reqRow.target_id]
          );
          if (newQty !== prevQty) {
            const diff = newQty - prevQty;
            await recordMovement(conn, {
              itemType: 'ingredient', itemId: reqRow.target_id, itemName: payload.name,
              changeQty: diff, previousQty: prevQty, newQty,
              reason: (payload.reason || (diff > 0 ? `Restocked (+${diff})` : `Adjustment (${diff})`)) + ' (Admin approved)',
              actor: actorLabel
            });
          }
        } else if (reqRow.action_type === 'dispose') {
          const [cur] = await conn.query('SELECT quantity, name FROM Inventory WHERE id=? LIMIT 1', [reqRow.target_id]);
          if (!cur.length) { await conn.rollback(); return res.status(404).json({ error: 'Target ingredient no longer exists.' }); }
          const prevQty = Math.trunc(Number(cur[0].quantity) || 0);
          const disp = Math.min(prevQty, Math.trunc(Number(payload.quantity) || 0));
          const newQty = Math.max(0, prevQty - disp);
          await conn.query('UPDATE Inventory SET quantity=?, updated_at=NOW() WHERE id=?', [newQty, reqRow.target_id]);
          await recordMovement(conn, {
            itemType: 'ingredient', itemId: reqRow.target_id, itemName: cur[0].name,
            changeQty: -disp, previousQty: prevQty, newQty,
            reason: (payload.reason || 'Expired/Spoiled disposed') + ' (Admin approved)', actor: actorLabel
          });
        } else if (reqRow.action_type === 'archive' || reqRow.action_type === 'restore') {
          await conn.query('UPDATE Inventory SET is_archived=? WHERE id=?', [reqRow.action_type === 'archive' ? 1 : 0, reqRow.target_id]);
        }
      } else if (reqRow.target_type === 'asset') {
        if (reqRow.action_type === 'asset_create') {
          const [ins] = await conn.query(
            'INSERT INTO CateringAssets (name, quantity, unit, damaged_qty, damage_notes) VALUES (?, ?, ?, ?, ?)',
            [payload.name, Number(payload.quantity) || 0, payload.unit || 'pcs', Number(payload.damaged_qty) || 0, payload.damage_notes || null]
          );
          await recordMovement(conn, {
            itemType: 'asset', itemId: ins.insertId, itemName: payload.name,
            changeQty: Number(payload.quantity) || 0, previousQty: 0, newQty: Number(payload.quantity) || 0,
            reason: 'Initial asset stock added (Admin approved)', actor: actorLabel
          });
        } else if (reqRow.action_type === 'asset_update') {
          const [cur] = await conn.query('SELECT quantity FROM CateringAssets WHERE id=? LIMIT 1', [reqRow.target_id]);
          if (!cur.length) { await conn.rollback(); return res.status(404).json({ error: 'Target asset no longer exists.' }); }
          const prevQty = Math.trunc(Number(cur[0].quantity) || 0);
          const newQty = Math.trunc(Number(payload.quantity) || 0);
          await conn.query('UPDATE CateringAssets SET name=?, quantity=?, unit=? WHERE id=?', [payload.name, newQty, payload.unit || 'pcs', reqRow.target_id]);
          if (newQty !== prevQty) {
            await recordMovement(conn, {
              itemType: 'asset', itemId: reqRow.target_id, itemName: payload.name,
              changeQty: newQty - prevQty, previousQty: prevQty, newQty,
              reason: (payload.reason || 'Asset updated') + ' (Admin approved)', actor: actorLabel
            });
          }
        } else if (reqRow.action_type === 'asset_damage') {
          const [cur] = await conn.query('SELECT name, quantity, damaged_qty FROM CateringAssets WHERE id=? LIMIT 1', [reqRow.target_id]);
          if (!cur.length) { await conn.rollback(); return res.status(404).json({ error: 'Target asset no longer exists.' }); }
          const prevQty = Math.trunc(Number(cur[0].quantity) || 0);
          const dmgQty = Math.min(prevQty, Math.trunc(Number(payload.qty) || 0));
          const newQty = Math.max(0, prevQty - dmgQty);
          const newDamaged = Math.trunc(Number(cur[0].damaged_qty) || 0) + dmgQty;
          await conn.query('UPDATE CateringAssets SET quantity=?, damaged_qty=?, damage_notes=? WHERE id=?', [newQty, newDamaged, payload.notes || null, reqRow.target_id]);
          await recordMovement(conn, {
            itemType: 'asset', itemId: reqRow.target_id, itemName: cur[0].name,
            changeQty: -dmgQty, previousQty: prevQty, newQty,
            reason: `Marked damaged (-${dmgQty}): ${payload.notes || 'Reported damage'} (Admin approved)`, actor: actorLabel
          });
        } else if (reqRow.action_type === 'asset_damage_resolve') {
          const [cur] = await conn.query('SELECT name, quantity, damaged_qty FROM CateringAssets WHERE id=? LIMIT 1', [reqRow.target_id]);
          if (!cur.length) { await conn.rollback(); return res.status(404).json({ error: 'Target asset no longer exists.' }); }
          const prevUsable = Math.trunc(Number(cur[0].quantity) || 0);
          const prevDamaged = Math.trunc(Number(cur[0].damaged_qty) || 0);
          const resolveQty = Math.min(prevDamaged, Math.trunc(Number(payload.qty) || 0));
          const newDamaged = Math.max(0, prevDamaged - resolveQty);
          const newUsable = payload.action === 'repair' ? prevUsable + resolveQty : prevUsable;
          await conn.query('UPDATE CateringAssets SET quantity=?, damaged_qty=?, damage_notes=CASE WHEN ? = 0 THEN NULL ELSE damage_notes END WHERE id=?', [newUsable, newDamaged, newDamaged, reqRow.target_id]);
          if (payload.action === 'repair' && resolveQty > 0) {
            await recordMovement(conn, {
              itemType: 'asset', itemId: reqRow.target_id, itemName: cur[0].name,
              changeQty: resolveQty, previousQty: prevUsable, newQty: newUsable,
              reason: `Repaired damaged asset (+${resolveQty}) (Admin approved)`, actor: actorLabel
            });
          }
        } else if (reqRow.action_type === 'asset_archive' || reqRow.action_type === 'asset_restore') {
          await conn.query('UPDATE CateringAssets SET is_archived=? WHERE id=?', [reqRow.action_type === 'asset_archive' ? 1 : 0, reqRow.target_id]);
        }
      } else if (reqRow.target_type === 'package') {
        if (reqRow.action_type === 'package_create') {
          const [dupe] = await conn.query('SELECT id FROM Packages WHERE LOWER(TRIM(name))=LOWER(TRIM(?)) LIMIT 1', [payload.name]);
          if (dupe.length) { await conn.rollback(); return res.status(409).json({ error: 'A package with this name already exists.' }); }
          const [ins] = await conn.query(
            'INSERT INTO Packages (name, price, min_guests, max_guests) VALUES (?, ?, ?, ?)',
            [payload.name, payload.price, payload.min_guests || 0, payload.max_guests || 0]
          );
          const pkgId = ins.insertId;
          for (const a of payload.assets || []) {
            await conn.query('INSERT INTO PackageAssets (package_id, asset_id, qty_required) VALUES (?, ?, ?)', [pkgId, a.asset_id, a.qty_required || 1]);
          }
          for (const d of payload.dishes || []) {
            await conn.query('INSERT INTO PackageDishes (package_id, dish_id) VALUES (?, ?)', [pkgId, d.dish_id]);
          }
          for (const f of payload.freebies || []) {
            await conn.query('INSERT INTO PackageFreebies (package_id, name) VALUES (?, ?)', [pkgId, f.name]);
          }
        } else if (reqRow.action_type === 'package_update') {
          const [cur] = await conn.query('SELECT id FROM Packages WHERE id=? LIMIT 1', [reqRow.target_id]);
          if (!cur.length) { await conn.rollback(); return res.status(404).json({ error: 'Target package no longer exists.' }); }
          await conn.query('UPDATE Packages SET name=?, price=?, min_guests=?, max_guests=? WHERE id=?', [payload.name, payload.price, payload.min_guests || 0, payload.max_guests || 0, reqRow.target_id]);
          await conn.query('DELETE FROM PackageAssets WHERE package_id=?', [reqRow.target_id]);
          for (const a of payload.assets || []) {
            await conn.query('INSERT INTO PackageAssets (package_id, asset_id, qty_required) VALUES (?, ?, ?)', [reqRow.target_id, a.asset_id, a.qty_required || 1]);
          }
          await conn.query('DELETE FROM PackageDishes WHERE package_id=?', [reqRow.target_id]);
          for (const d of payload.dishes || []) {
            await conn.query('INSERT INTO PackageDishes (package_id, dish_id) VALUES (?, ?)', [reqRow.target_id, d.dish_id]);
          }
          await conn.query('DELETE FROM PackageFreebies WHERE package_id=?', [reqRow.target_id]);
          for (const f of payload.freebies || []) {
            await conn.query('INSERT INTO PackageFreebies (package_id, name) VALUES (?, ?)', [reqRow.target_id, f.name]);
          }
        } else if (reqRow.action_type === 'package_archive' || reqRow.action_type === 'package_restore') {
          await conn.query('UPDATE Packages SET is_archived=? WHERE id=?', [reqRow.action_type === 'package_archive' ? 1 : 0, reqRow.target_id]);
        } else if (reqRow.action_type === 'package_popular') {
          if (payload.popular) await conn.query('UPDATE Packages SET is_popular=0 WHERE is_popular=1');
          await conn.query('UPDATE Packages SET is_popular=? WHERE id=?', [payload.popular ? 1 : 0, reqRow.target_id]);
        }
      } else if (reqRow.target_type === 'dish') {
        if (reqRow.action_type === 'dish_create') {
          const [dupe] = await conn.query('SELECT id FROM Dishes WHERE LOWER(TRIM(name))=LOWER(TRIM(?)) LIMIT 1', [payload.name]);
          if (dupe.length) { await conn.rollback(); return res.status(409).json({ error: 'A dish with this name already exists.' }); }
          await conn.query('INSERT INTO Dishes (name, category) VALUES (?, ?)', [payload.name, payload.category || 'Main Course']);
        } else if (reqRow.action_type === 'dish_update') {
          await conn.query('UPDATE Dishes SET name=?, category=? WHERE id=?', [payload.name, payload.category || 'Main Course', reqRow.target_id]);
        } else if (reqRow.action_type === 'dish_archive' || reqRow.action_type === 'dish_restore') {
          await conn.query('UPDATE Dishes SET is_archived=? WHERE id=?', [reqRow.action_type === 'dish_archive' ? 1 : 0, reqRow.target_id]);
        } else if (reqRow.action_type === 'dish_ingredients') {
          await conn.query('DELETE FROM DishIngredients WHERE dish_id=?', [reqRow.target_id]);
          for (const item of payload.ingredients || []) {
            await conn.query('INSERT INTO DishIngredients (dish_id, inventory_id, qty_required) VALUES (?, ?, ?)', [reqRow.target_id, item.inventory_id, item.qty_required]);
          }
        }
      }
    }

    await conn.query(
      'UPDATE inventory_approval_requests SET status=?, reviewed_by=?, review_notes=?, reviewed_at=NOW() WHERE id=?',
      [decision, req.user.username, reviewNotes || null, req.params.id]
    );
    await conn.commit();
    await writeAudit(req.user, `Inventory request ${decision}`, 'inventory', req.params.id, reqRow.summary);
    const notifView = reqRow.target_type === 'asset' ? 'assets' : reqRow.target_type === 'package' ? 'menu' : reqRow.target_type === 'dish' ? 'dishes' : 'inventory';
    await notify('approval', `Request ${decision}`, `Administrator ${req.user.username} ${decision}: ${reqRow.summary}`, ['manager'], notifView);
    res.json({ message: `Request ${decision}.` });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
};
