const pool = require('../Model/db');

exports.getAllMenu = async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM Menu ORDER BY id DESC");
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.createMenu = async (req, res) => {
  try {
    const { name, description, price } = req.body;
    if (!name || !price) return res.status(400).json({ error: 'Name and price are required' });
    const [result] = await pool.query(
      "INSERT INTO Menu (name, description, price) VALUES (?, ?, ?)",
      [name, description ?? null, price]
    );
    res.status(201).json({ message: 'Menu item created', menuId: result.insertId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getMenuById = async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM Menu WHERE id = ?", [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Menu item not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.updateMenu = async (req, res) => {
  try {
    const { name, description, price } = req.body;
    const [result] = await pool.query(
      "UPDATE Menu SET name=?, description=?, price=? WHERE id=?",
      [name, description, price, req.params.id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Menu item not found' });
    res.json({ message: 'Menu updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.deleteMenu = async (req, res) => {
  try {
    const [result] = await pool.query("DELETE FROM Menu WHERE id=?", [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Menu item not found' });
    res.json({ message: 'Menu deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
