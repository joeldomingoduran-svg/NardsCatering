const pool = require('../Model/db');
const { notify } = require('../Model/notifications');
const { recordMovement, createApprovalRequest } = require('../Model/stockMovements');

exports.getAllAssets = async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM CateringAssets ORDER BY name ASC');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.createAsset = async (req, res) => {
  try {
    const { name, quantity, unit } = req.body;
    if (!name) return res.status(400).json({ error: 'Name is required' });
    const [existing] = await pool.query(
      'SELECT id FROM CateringAssets WHERE LOWER(TRIM(name))=LOWER(TRIM(?)) LIMIT 1',
      [name]
    );
    if (existing.length) return res.status(409).json({ error: 'An asset with this name already exists' });
    const qty = Math.trunc(Number(quantity) || 0);
    const cleanUnit = unit || 'pcs';

    if (req.user?.role === 'manager') {
      const requestId = await createApprovalRequest({
        actionType: 'asset_create',
        targetType: 'asset',
        itemName: name,
        payload: { name, quantity: qty, unit: cleanUnit },
        summary: `Add catering asset "${name}" (${qty} ${cleanUnit})`,
        user: req.user
      });
      await notify('approval', 'Asset Approval Required', `${req.user.username} requested to add asset "${name}".`, ['admin'], 'assets');
      return res.status(202).json({ pendingApproval: true, requestId, message: 'Asset addition submitted for Administrator approval.' });
    }

    const [result] = await pool.query(
      'INSERT INTO CateringAssets (name, quantity, unit) VALUES (?, ?, ?)',
      [name, qty, cleanUnit]
    );
    await recordMovement(pool, {
      itemType: 'asset',
      itemId: result.insertId,
      itemName: name,
      changeQty: qty,
      previousQty: 0,
      newQty: qty,
      reason: 'Initial asset stock added',
      actor: req.user?.username || 'system'
    });
    res.status(201).json({ message: 'Asset created', assetId: result.insertId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.updateAsset = async (req, res) => {
  try {
    const { name, quantity, unit } = req.body;
    if (!name) return res.status(400).json({ error: 'Name is required' });
    const [existing] = await pool.query(
      'SELECT id FROM CateringAssets WHERE LOWER(TRIM(name))=LOWER(TRIM(?)) AND id<>? LIMIT 1',
      [name, req.params.id]
    );
    if (existing.length) return res.status(409).json({ error: 'An asset with this name already exists' });
    const [prevRows] = await pool.query('SELECT quantity FROM CateringAssets WHERE id=? LIMIT 1', [req.params.id]);
    if (!prevRows.length) return res.status(404).json({ error: 'Asset not found' });
    const prevQty = Math.trunc(Number(prevRows[0].quantity) || 0);
    const newQty = Math.trunc(Number(quantity) || 0);
    const cleanUnit = unit || 'pcs';

    if (req.user?.role === 'manager') {
      const requestId = await createApprovalRequest({
        actionType: 'asset_update',
        targetType: 'asset',
        targetId: Number(req.params.id),
        itemName: name,
        payload: { name, quantity: newQty, unit: cleanUnit, reason: req.body.reason || '' },
        summary: `Update asset "${name}" (${prevQty} -> ${newQty} ${cleanUnit})`,
        user: req.user
      });
      await notify('approval', 'Asset Approval Required', `${req.user.username} requested to update asset "${name}".`, ['admin'], 'assets');
      return res.status(202).json({ pendingApproval: true, requestId, message: 'Asset update submitted for Administrator approval.' });
    }

    const [result] = await pool.query(
      'UPDATE CateringAssets SET name=?, quantity=?, unit=? WHERE id=?',
      [name, newQty, cleanUnit, req.params.id]
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'Asset not found' });
    if (newQty !== prevQty) {
      const diff = newQty - prevQty;
      await recordMovement(pool, {
        itemType: 'asset',
        itemId: req.params.id,
        itemName: name,
        changeQty: diff,
        previousQty: prevQty,
        newQty,
        reason: req.body.reason || (diff > 0 ? `Asset stock added (+${diff})` : `Asset adjustment (${diff})`),
        actor: req.user?.username || 'system'
      });
    }
    res.json({ message: 'Asset updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.reportDamage = async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM CateringAssets WHERE id=? LIMIT 1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Asset not found' });
    const asset = rows[0];
    const usable = Math.trunc(Number(asset.quantity) || 0);
    const qty = Math.trunc(Number(req.body?.qty ?? 0));
    if (!Number.isInteger(qty) || qty < 1 || qty > usable) {
      return res.status(400).json({ error: `Enter a damaged quantity between 1 and ${usable}.` });
    }
    const notes = String(req.body?.notes || 'Reported damaged during event/inspection').trim().slice(0, 300);

    if (req.user?.role === 'manager') {
      const requestId = await createApprovalRequest({
        actionType: 'asset_damage',
        targetType: 'asset',
        targetId: asset.id,
        itemName: asset.name,
        payload: { qty, notes },
        summary: `Report ${qty} ${asset.unit || 'pcs'} damaged for "${asset.name}" (${notes})`,
        user: req.user
      });
      await notify('approval', 'Asset Damage Approval Required', `${req.user.username} reported damaged "${asset.name}".`, ['admin'], 'assets');
      return res.status(202).json({ pendingApproval: true, requestId, message: 'Damage report submitted for Administrator approval.' });
    }

    const newUsable = Math.max(0, usable - qty);
    const newDamaged = Math.trunc(Number(asset.damaged_qty) || 0) + qty;
    await pool.query(
      'UPDATE CateringAssets SET quantity=?, damaged_qty=?, damage_notes=? WHERE id=?',
      [newUsable, newDamaged, notes, asset.id]
    );
    await recordMovement(pool, {
      itemType: 'asset',
      itemId: asset.id,
      itemName: asset.name,
      changeQty: -qty,
      previousQty: usable,
      newQty: newUsable,
      reason: `Marked damaged (-${qty}): ${notes}`,
      actor: req.user?.username || 'system'
    });
    res.json({ message: `Recorded ${qty} damaged ${asset.unit || ''} for ${asset.name}.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.resolveDamage = async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM CateringAssets WHERE id=? LIMIT 1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Asset not found' });
    const asset = rows[0];
    const damaged = Math.trunc(Number(asset.damaged_qty) || 0);
    const usable = Math.trunc(Number(asset.quantity) || 0);
    const action = String(req.body?.action || 'repair');
    if (!['repair', 'writeoff'].includes(action)) return res.status(400).json({ error: 'Choose repair or writeoff.' });
    const qty = Math.trunc(Number(req.body?.qty ?? damaged));
    if (!Number.isInteger(qty) || qty < 1 || qty > damaged) {
      return res.status(400).json({ error: `Enter a quantity between 1 and ${damaged}.` });
    }

    if (req.user?.role === 'manager') {
      const requestId = await createApprovalRequest({
        actionType: 'asset_damage_resolve',
        targetType: 'asset',
        targetId: asset.id,
        itemName: asset.name,
        payload: { action, qty },
        summary: `${action === 'repair' ? 'Repair & restore' : 'Write off'} ${qty} damaged "${asset.name}"`,
        user: req.user
      });
      await notify('approval', 'Asset Approval Required', `${req.user.username} requested to ${action} damaged "${asset.name}".`, ['admin'], 'assets');
      return res.status(202).json({ pendingApproval: true, requestId, message: 'Submitted for Administrator approval.' });
    }

    const newDamaged = Math.max(0, damaged - qty);
    const newUsable = action === 'repair' ? usable + qty : usable;
    await pool.query(
      'UPDATE CateringAssets SET quantity=?, damaged_qty=?, damage_notes=CASE WHEN ? = 0 THEN NULL ELSE damage_notes END WHERE id=?',
      [newUsable, newDamaged, newDamaged, asset.id]
    );
    if (action === 'repair') {
      await recordMovement(pool, {
        itemType: 'asset',
        itemId: asset.id,
        itemName: asset.name,
        changeQty: qty,
        previousQty: usable,
        newQty: newUsable,
        reason: `Repaired damaged asset (+${qty})`,
        actor: req.user?.username || 'system'
      });
    }
    res.json({ message: action === 'repair' ? `Restored ${qty} repaired ${asset.name}.` : `Wrote off ${qty} damaged ${asset.name}.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.deleteAsset = async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, name FROM CateringAssets WHERE id=? AND is_archived=0 LIMIT 1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Asset not found' });
    if (req.user?.role === 'manager') {
      const requestId = await createApprovalRequest({
        actionType: 'asset_archive',
        targetType: 'asset',
        targetId: rows[0].id,
        itemName: rows[0].name,
        payload: { archived: true },
        summary: `Archive asset "${rows[0].name}"`,
        user: req.user
      });
      await notify('approval', 'Asset Approval Required', `${req.user.username} requested to archive asset "${rows[0].name}".`, ['admin'], 'assets');
      return res.status(202).json({ pendingApproval: true, requestId, message: 'Archive request submitted for Administrator approval.' });
    }
    const [result] = await pool.query('UPDATE CateringAssets SET is_archived=1 WHERE id=? AND is_archived=0', [req.params.id]);
    if (!result.affectedRows) return res.status(404).json({ error: 'Asset not found' });
    res.json({ message: 'Asset archived' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.archiveAsset = async (req, res) => {
  try {
    const archived = req.body.archived === true;
    const [current] = await pool.query('SELECT id, name FROM CateringAssets WHERE id=?', [req.params.id]);
    if (!current.length) return res.status(404).json({ error: 'Asset not found' });
    if (!archived) {
      const [existing] = await pool.query(
        'SELECT id FROM CateringAssets WHERE LOWER(TRIM(name))=LOWER(TRIM(?)) AND id<>? LIMIT 1',
        [current[0].name, req.params.id]
      );
      if (existing.length) return res.status(409).json({ error: 'Another asset with this name already exists' });
    }
    if (req.user?.role === 'manager') {
      const requestId = await createApprovalRequest({
        actionType: archived ? 'asset_archive' : 'asset_restore',
        targetType: 'asset',
        targetId: current[0].id,
        itemName: current[0].name,
        payload: { archived },
        summary: `${archived ? 'Archive' : 'Restore'} asset "${current[0].name}"`,
        user: req.user
      });
      await notify('approval', 'Asset Approval Required', `${req.user.username} requested to ${archived ? 'archive' : 'restore'} "${current[0].name}".`, ['admin'], 'assets');
      return res.status(202).json({ pendingApproval: true, requestId, message: 'Submitted for Administrator approval.' });
    }
    const [result] = await pool.query(
      'UPDATE CateringAssets SET is_archived=? WHERE id=?',
      [archived ? 1 : 0, req.params.id]
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'Asset not found' });
    res.json({ message: archived ? 'Asset archived' : 'Asset restored' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
