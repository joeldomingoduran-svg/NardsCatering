const pool = require('../Model/db');

const CATEGORIES = {
  event_type: 'Event Type',
  inventory_category: 'Inventory Category',
  inventory_unit: 'Inventory Unit',
  asset_unit: 'Asset Unit'
};

const SEED = {
  event_type: ['Wedding', 'Birthday Party', 'Christening', 'Debut', 'Baptismal', 'Party', 'Anniversary', 'House Blessing', 'Corporate Event', 'Other'],
  inventory_category: ['Meat & Poultry', 'Seafood', 'Vegetables', 'Dairy', 'Grains & Rice', 'Spices & Condiments', 'Beverages', 'Other'],
  inventory_unit: ['kg', 'g', 'L', 'mL', 'pcs', 'sacks', 'boxes', 'cans'],
  asset_unit: ['pcs', 'sets', 'units']
};

exports.seedDropdowns = async () => {
  const [existing] = await pool.query('SELECT category FROM dropdown_options GROUP BY category');
  const seeded = new Set(existing.map((r) => r.category));
  for (const [category, labels] of Object.entries(SEED)) {
    if (seeded.has(category)) continue;
    let order = 0;
    for (const label of labels) {
      await pool.query(
        'INSERT INTO dropdown_options (category, label, sort_order, is_active) VALUES (?, ?, ?, 1) ON CONFLICT (category, label) DO NOTHING RETURNING id',
        [category, label, ++order]
      );
    }
  }
};

// Public: forms read the active options of one category.
exports.listActive = async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT label FROM dropdown_options WHERE category = ? AND is_active = 1 ORDER BY sort_order ASC, id ASC',
      [req.params.category]
    );
    res.json(rows.map((r) => r.label));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.listAll = async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, category, label, sort_order, is_active FROM dropdown_options ORDER BY category, sort_order, id');
    res.json({ categories: CATEGORIES, options: rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

function cleanLabel(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 120);
}

exports.create = async (req, res) => {
  try {
    const category = String(req.body.category || '');
    const label = cleanLabel(req.body.label);
    if (!CATEGORIES[category]) return res.status(400).json({ error: 'Unknown dropdown category.' });
    if (!label) return res.status(400).json({ error: 'Enter an option label.' });
    const [dupe] = await pool.query('SELECT id FROM dropdown_options WHERE category = ? AND LOWER(label) = LOWER(?) LIMIT 1', [category, label]);
    if (dupe.length) return res.status(409).json({ error: 'This option already exists.' });
    const [max] = await pool.query('SELECT COALESCE(MAX(sort_order), 0) AS m FROM dropdown_options WHERE category = ?', [category]);
    const [result] = await pool.query(
      'INSERT INTO dropdown_options (category, label, sort_order, is_active) VALUES (?, ?, ?, 1)',
      [category, label, Number(max[0].m) + 1]
    );
    res.status(201).json({ id: result.insertId, message: 'Option added.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.update = async (req, res) => {
  try {
    const label = cleanLabel(req.body.label);
    if (!label) return res.status(400).json({ error: 'Enter an option label.' });
    const [rows] = await pool.query('SELECT category FROM dropdown_options WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Option not found.' });
    const [dupe] = await pool.query('SELECT id FROM dropdown_options WHERE category = ? AND LOWER(label) = LOWER(?) AND id <> ? LIMIT 1', [rows[0].category, label, req.params.id]);
    if (dupe.length) return res.status(409).json({ error: 'This option already exists.' });
    const sort = Number.isFinite(Number(req.body.sort_order)) ? Math.trunc(Number(req.body.sort_order)) : null;
    await pool.query('UPDATE dropdown_options SET label = ?, sort_order = COALESCE(?, sort_order) WHERE id = ?', [label, sort, req.params.id]);
    res.json({ message: 'Option updated.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.setStatus = async (req, res) => {
  try {
    const [result] = await pool.query('UPDATE dropdown_options SET is_active = ? WHERE id = ?', [req.body.is_active ? 1 : 0, req.params.id]);
    if (!result.affectedRows) return res.status(404).json({ error: 'Option not found.' });
    res.json({ message: req.body.is_active ? 'Option activated.' : 'Option deactivated.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.remove = async (req, res) => {
  try {
    const [result] = await pool.query('DELETE FROM dropdown_options WHERE id = ?', [req.params.id]);
    if (!result.affectedRows) return res.status(404).json({ error: 'Option not found.' });
    res.json({ message: 'Option deleted.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
