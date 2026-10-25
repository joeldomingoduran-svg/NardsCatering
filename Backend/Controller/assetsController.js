const pool = require('../Model/db');

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
    const [result] = await pool.query(
      'INSERT INTO CateringAssets (name, quantity, unit) VALUES (?, ?, ?)',
      [name, quantity ?? 0, unit || 'pcs']
    );
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
    const [result] = await pool.query(
      'UPDATE CateringAssets SET name=?, quantity=?, unit=? WHERE id=?',
      [name, quantity ?? 0, unit || 'pcs', req.params.id]
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'Asset not found' });
    res.json({ message: 'Asset updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.deleteAsset = async (req, res) => {
  try {
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
    if (!archived) {
      const [current] = await pool.query('SELECT name FROM CateringAssets WHERE id=?', [req.params.id]);
      if (!current.length) return res.status(404).json({ error: 'Asset not found' });
      const [existing] = await pool.query(
        'SELECT id FROM CateringAssets WHERE LOWER(TRIM(name))=LOWER(TRIM(?)) AND id<>? LIMIT 1',
        [current[0].name, req.params.id]
      );
      if (existing.length) return res.status(409).json({ error: 'Another asset with this name already exists' });
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
