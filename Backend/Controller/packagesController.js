const pool = require('../Model/db');
const { notify } = require('../Model/notifications');
const { createApprovalRequest } = require('../Model/stockMovements');


exports.getAllPackages = async (req, res) => {
  try {
    const [packages] = await pool.query('SELECT * FROM Packages ORDER BY id ASC');
    for (const pkg of packages) {
      const [assets] = await pool.query(
        `SELECT pa.qty_required, ca.id AS asset_id, ca.name, ca.unit, ca.quantity AS available_qty, COALESCE(ca.is_archived, 0) AS asset_archived
         FROM PackageAssets pa
         JOIN CateringAssets ca ON ca.id = pa.asset_id
         WHERE pa.package_id = ?`,
        [pkg.id]
      );
      pkg.assets = assets;
      const [dishes] = await pool.query(
        `SELECT pd.dish_id, d.name, d.category
         FROM PackageDishes pd
         JOIN Dishes d ON d.id = pd.dish_id
         WHERE pd.package_id = ?`,
        [pkg.id]
      );
      pkg.dishes = dishes;
      const [freebies] = await pool.query(
        'SELECT id, name FROM PackageFreebies WHERE package_id = ? ORDER BY id ASC',
        [pkg.id]
      );
      pkg.freebies = freebies;

      const unavailableItems = [];
      try {
        const [ingRows] = await pool.query(
          `SELECT i.id AS inventory_id, i.name, i.unit, i.quantity AS available_qty, COALESCE(i.is_archived, 0) AS is_archived,
                  CAST(SUM(di.qty_required) AS SIGNED) AS required_qty
           FROM (SELECT DISTINCT dish_id FROM PackageDishes WHERE package_id = ?) pd
           JOIN DishIngredients di ON di.dish_id = pd.dish_id
           JOIN Inventory i ON i.id = di.inventory_id
           GROUP BY i.id, i.name, i.unit, i.quantity, i.is_archived`,
          [pkg.id]
        );
        for (const ing of ingRows) {
          const avail = Number(ing.available_qty) || 0;
          const reqQty = Number(ing.required_qty) || 0;
          if (Number(ing.is_archived) === 1 || avail <= 0 || avail < reqQty) {
            unavailableItems.push({
              type: 'ingredient',
              name: ing.name,
              available: avail,
              required: reqQty,
              unit: ing.unit || ''
            });
          }
        }
      } catch (e) {}

      for (const a of assets) {
        const avail = Number(a.available_qty) || 0;
        const reqQty = Number(a.qty_required) || 0;
        if (Number(a.asset_archived) === 1 || avail <= 0 || avail < reqQty) {
          unavailableItems.push({
            type: 'asset',
            name: a.name,
            available: avail,
            required: reqQty,
            unit: a.unit || ''
          });
        }
      }

      pkg.unavailable_items = unavailableItems;
      pkg.is_available = unavailableItems.length === 0;
    }
    res.json(packages);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


exports.getPackageById = async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM Packages WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Package not found' });
    const pkg = rows[0];
    const [assets] = await pool.query(
      `SELECT pa.qty_required, ca.id AS asset_id, ca.name, ca.unit
       FROM PackageAssets pa
       JOIN CateringAssets ca ON ca.id = pa.asset_id
       WHERE pa.package_id = ?`,
      [pkg.id]
    );
    pkg.assets = assets;
    const [dishes] = await pool.query(
      `SELECT pd.dish_id, d.name, d.category
       FROM PackageDishes pd
       JOIN Dishes d ON d.id = pd.dish_id
       WHERE pd.package_id = ?`,
      [pkg.id]
    );
    pkg.dishes = dishes;
    const [freebies] = await pool.query(
      'SELECT id, name FROM PackageFreebies WHERE package_id = ? ORDER BY id ASC',
      [pkg.id]
    );
    pkg.freebies = freebies;
    res.json(pkg);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


exports.createPackage = async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const { name, price, min_guests, max_guests, assets, dishes, freebies } = req.body;
    if (!name || price == null) {
      await conn.rollback();
      return res.status(400).json({ error: 'Name and price are required' });
    }
    if (Number(max_guests) > 0 && Number(max_guests) < Number(min_guests || 0)) {
      await conn.rollback();
      return res.status(400).json({ error: 'Maximum guests cannot be less than minimum guests.' });
    }
    const [existing] = await conn.query(
      'SELECT id FROM Packages WHERE LOWER(TRIM(name))=LOWER(TRIM(?)) LIMIT 1',
      [name]
    );
    if (existing.length) {
      await conn.rollback();
      return res.status(409).json({ error: 'A package with this name already exists' });
    }
    if (req.user?.role === 'manager') {
      await conn.rollback();
      const requestId = await createApprovalRequest({
        actionType: 'package_create',
        targetType: 'package',
        itemName: name,
        payload: { name, price, min_guests: min_guests || 0, max_guests: max_guests || 0, assets: assets || [], dishes: dishes || [], freebies: freebies || [] },
        summary: `Add menu package "${name}" (₱${Number(price).toLocaleString('en-PH')})`,
        user: req.user
      });
      await notify('approval', 'Package Approval Required', `${req.user.username} requested to add package "${name}".`, ['admin'], 'menu');
      return res.status(202).json({ pendingApproval: true, requestId, message: 'Package request submitted for Administrator approval.' });
    }
    const [result] = await conn.query(
      'INSERT INTO Packages (name, price, min_guests, max_guests) VALUES (?, ?, ?, ?)',
      [name, price, min_guests || 0, max_guests || 0]
    );
    const packageId = result.insertId;
    if (Array.isArray(assets) && assets.length) {
      for (const a of assets) {
        await conn.query(
          'INSERT INTO PackageAssets (package_id, asset_id, qty_required) VALUES (?, ?, ?)',
          [packageId, a.asset_id, a.qty_required || 1]
        );
      }
    }
    if (Array.isArray(dishes) && dishes.length) {
      for (const d of dishes) {
        await conn.query(
          'INSERT INTO PackageDishes (package_id, dish_id) VALUES (?, ?)',
          [packageId, d.dish_id]
        );
      }
    }
    if (Array.isArray(freebies) && freebies.length) {
      for (const f of freebies) {
        await conn.query(
          'INSERT INTO PackageFreebies (package_id, name) VALUES (?, ?)',
          [packageId, f.name]
        );
      }
    }
    await conn.commit();
    res.status(201).json({ message: 'Package created', packageId });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
};


exports.updatePackage = async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const { name, price, min_guests, max_guests, assets, dishes, freebies } = req.body;
    if (!name || price == null) {
      await conn.rollback();
      return res.status(400).json({ error: 'Name and price are required' });
    }
    if (Number(max_guests) > 0 && Number(max_guests) < Number(min_guests || 0)) {
      await conn.rollback();
      return res.status(400).json({ error: 'Maximum guests cannot be less than minimum guests.' });
    }
    const [existing] = await conn.query(
      'SELECT id FROM Packages WHERE LOWER(TRIM(name))=LOWER(TRIM(?)) AND id<>? LIMIT 1',
      [name, req.params.id]
    );
    if (existing.length) {
      await conn.rollback();
      return res.status(409).json({ error: 'A package with this name already exists' });
    }
    if (req.user?.role === 'manager') {
      const [existsPkg] = await conn.query('SELECT id FROM Packages WHERE id=? LIMIT 1', [req.params.id]);
      await conn.rollback();
      if (!existsPkg.length) return res.status(404).json({ error: 'Package not found' });
      const requestId = await createApprovalRequest({
        actionType: 'package_update',
        targetType: 'package',
        targetId: req.params.id,
        itemName: name,
        payload: { name, price, min_guests: min_guests || 0, max_guests: max_guests || 0, assets: assets || [], dishes: dishes || [], freebies: freebies || [] },
        summary: `Update menu package "${name}" (₱${Number(price).toLocaleString('en-PH')})`,
        user: req.user
      });
      await notify('approval', 'Package Approval Required', `${req.user.username} requested to update package "${name}".`, ['admin'], 'menu');
      return res.status(202).json({ pendingApproval: true, requestId, message: 'Package update submitted for Administrator approval.' });
    }
    const [result] = await conn.query(
      'UPDATE Packages SET name=?, price=?, min_guests=?, max_guests=? WHERE id=?',
      [name, price, min_guests || 0, max_guests || 0, req.params.id]
    );
    if (!result.affectedRows) {
      await conn.rollback();
      return res.status(404).json({ error: 'Package not found' });
    }
    await conn.query('DELETE FROM PackageAssets WHERE package_id=?', [req.params.id]);
    if (Array.isArray(assets) && assets.length) {
      for (const a of assets) {
        await conn.query(
          'INSERT INTO PackageAssets (package_id, asset_id, qty_required) VALUES (?, ?, ?)',
          [req.params.id, a.asset_id, a.qty_required || 1]
        );
      }
    }
    await conn.query('DELETE FROM PackageDishes WHERE package_id=?', [req.params.id]);
    if (Array.isArray(dishes) && dishes.length) {
      for (const d of dishes) {
        await conn.query(
          'INSERT INTO PackageDishes (package_id, dish_id) VALUES (?, ?)',
          [req.params.id, d.dish_id]
        );
      }
    }
    await conn.query('DELETE FROM PackageFreebies WHERE package_id=?', [req.params.id]);
    if (Array.isArray(freebies) && freebies.length) {
      for (const f of freebies) {
        await conn.query(
          'INSERT INTO PackageFreebies (package_id, name) VALUES (?, ?)',
          [req.params.id, f.name]
        );
      }
    }
    await conn.commit();
    res.json({ message: 'Package updated' });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
};


exports.deletePackage = async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, name FROM Packages WHERE id=? AND is_archived=0 LIMIT 1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Package not found' });
    if (req.user?.role === 'manager') {
      const requestId = await createApprovalRequest({
        actionType: 'package_archive',
        targetType: 'package',
        targetId: rows[0].id,
        itemName: rows[0].name,
        payload: { archived: true },
        summary: `Archive menu package "${rows[0].name}"`,
        user: req.user
      });
      await notify('approval', 'Package Approval Required', `${req.user.username} requested to archive package "${rows[0].name}".`, ['admin'], 'menu');
      return res.status(202).json({ pendingApproval: true, requestId, message: 'Archive request submitted for Administrator approval.' });
    }
    const [result] = await pool.query('UPDATE Packages SET is_archived=1 WHERE id=? AND is_archived=0', [req.params.id]);
    if (!result.affectedRows) return res.status(404).json({ error: 'Package not found' });
    res.json({ message: 'Package archived' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.setPopularPackage = async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const popular = req.body.popular === true;
    await conn.beginTransaction();
    const [rows] = await conn.query('SELECT id, name FROM Packages WHERE id=?', [req.params.id]);
    if (!rows.length) {
      await conn.rollback();
      return res.status(404).json({ error: 'Package not found' });
    }
    if (req.user?.role === 'manager') {
      await conn.rollback();
      const requestId = await createApprovalRequest({
        actionType: 'package_popular',
        targetType: 'package',
        targetId: rows[0].id,
        itemName: rows[0].name,
        payload: { popular },
        summary: `${popular ? 'Set' : 'Remove'} Popular badge on "${rows[0].name}"`,
        user: req.user
      });
      await notify('approval', 'Package Approval Required', `${req.user.username} requested popular status change on "${rows[0].name}".`, ['admin'], 'menu');
      return res.status(202).json({ pendingApproval: true, requestId, message: 'Popular package change submitted for Administrator approval.' });
    }
    // Only one package can carry the Popular badge at a time.
    if (popular) await conn.query('UPDATE Packages SET is_popular=0 WHERE is_popular=1');
    await conn.query('UPDATE Packages SET is_popular=? WHERE id=?', [popular ? 1 : 0, req.params.id]);
    await conn.commit();
    res.json({ message: popular ? 'Package marked as popular' : 'Popular badge removed' });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
};

exports.archivePackage = async (req, res) => {
  try {
    const archived = req.body.archived === true;
    const [current] = await pool.query('SELECT id, name FROM Packages WHERE id=?', [req.params.id]);
    if (!current.length) return res.status(404).json({ error: 'Package not found' });
    if (!archived) {
      const [existing] = await pool.query(
        'SELECT id FROM Packages WHERE LOWER(TRIM(name))=LOWER(TRIM(?)) AND id<>? LIMIT 1',
        [current[0].name, req.params.id]
      );
      if (existing.length) return res.status(409).json({ error: 'Another package with this name already exists' });
    }
    if (req.user?.role === 'manager') {
      const requestId = await createApprovalRequest({
        actionType: archived ? 'package_archive' : 'package_restore',
        targetType: 'package',
        targetId: current[0].id,
        itemName: current[0].name,
        payload: { archived },
        summary: `${archived ? 'Archive' : 'Restore'} menu package "${current[0].name}"`,
        user: req.user
      });
      await notify('approval', 'Package Approval Required', `${req.user.username} requested to ${archived ? 'archive' : 'restore'} package "${current[0].name}".`, ['admin'], 'menu');
      return res.status(202).json({ pendingApproval: true, requestId, message: 'Submitted for Administrator approval.' });
    }
    const [result] = await pool.query(
      'UPDATE Packages SET is_archived=? WHERE id=?',
      [archived ? 1 : 0, req.params.id]
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'Package not found' });
    res.json({ message: archived ? 'Package archived' : 'Package restored' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
