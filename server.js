require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const PORT = process.env.PORT || 3000;

const app = express();
const { writeAudit } = require('./Backend/Model/audit');

app.use(cors());
app.use(express.json());

// The project root is served statically, so keep secrets and server code out of it.
app.use((req, res, next) => {
  let p;
  try { p = decodeURIComponent(req.path); } catch (e) { return res.status(400).end(); }
  const blocked =
    p.split('/').some((seg) => seg.startsWith('.')) ||
    /^\/Backend\//i.test(p) ||
    /^\/node_modules\/(?!sweetalert2\/)/i.test(p) ||
    /\.(sql|mwb)$/i.test(p) ||
    /^\/(server|menu-api|migrate-stripe)\.js$/i.test(p) ||
    /^\/package(-lock)?\.json$/i.test(p);
  if (blocked) return res.status(404).end();
  next();
});

app.use(express.static(path.join(__dirname), { dotfiles: 'deny' }));

// Records every successful change made by a logged-in admin or staff member.
app.use((req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  res.on('finish', () => {
    if (!req.user || res.statusCode >= 400) return;
    const [entity, id, sub] = req.originalUrl.split('?')[0].split('/').filter(Boolean);
    const verb = req.method === 'POST' ? 'Created' : req.method === 'DELETE' ? 'Deleted' : 'Updated';
    const action = sub === 'status' && req.body?.status
      ? `Set status to ${req.body.status}`
      : sub === 'archive' ? (req.body?.archived === false ? 'Restored' : 'Archived') : `${verb}`;
    writeAudit(req.user, `${action} ${entity}`, entity, id && /^\d+$/.test(id) ? id : null, `${req.method} ${req.originalUrl.split('?')[0]}`);
  });
  next();
});

const pool = require('./Backend/Model/db');
const schemaReady = (async () => {
  await pool.ensureAuditSchema?.();
  await pool.ensureClientTableSchema?.();
  await pool.ensureOtpPaymentSchema?.();
  await pool.ensureStaffUsersTableSchema?.();
  await pool.ensureLoginHistoryTableSchema?.();
  await pool.ensureInventoryTableSchema?.();
  await pool.ensureAssetsTableSchema?.();
  await pool.ensureOperationsArchiveSchema?.();
})();
schemaReady.then(() => {
  const expire = () => require('./Backend/Controller/bookingsController').expireUnpaidBookings().catch(() => {});
  expire();
  setInterval(expire, 5 * 60 * 1000);
}).catch((error) => {
  console.error('Database initialization failed:', error.message);
});

app.use(async (req, res, next) => {
  try {
    await schemaReady;
    next();
  } catch (error) {
    res.status(503).json({ error: 'Database schema is still initializing. Please try again.' });
  }
});


app.get('/', (req, res) => {
  res.redirect('/login');
});


app.get('/login', (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.sendFile(path.join(__dirname, 'Login', 'Login.html'));
});


app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'Admin', 'Admin.html'));
});

app.get('/manager', (req, res) => {
  res.sendFile(path.join(__dirname, 'Manager', 'Manager.html'));
});

// Not /staff: that path is the staff accounts API.
app.get('/staff-portal', (req, res) => {
  res.sendFile(path.join(__dirname, 'Staff', 'Staff.html'));
});


app.get('/customer', (req, res) => {
  res.sendFile(path.join(__dirname, 'Customer', 'index.html'));
});

app.get('/terms', (req, res) => {
  res.sendFile(path.join(__dirname, 'Customer', 'Terms.html'));
});


app.get('/customer-login', (req, res) => {
  res.sendFile(path.join(__dirname, 'Customer', 'CustomerLogin.html'));
});




app.use('/staff',     require('./Backend/Routes/staff'));
app.use('/bookings',  require('./Backend/Routes/bookings'));
app.use('/clients',   require('./Backend/Routes/client'));
app.use('/inventory', require('./Backend/Routes/inventory'));
app.use('/menu',      require('./Backend/Routes/menu'));
app.use('/packages',  require('./Backend/Routes/packages'));
app.use('/assets',    require('./Backend/Routes/assets'));
app.use('/dishes',    require('./Backend/Routes/dishes'));
app.use('/settings',  require('./Backend/Routes/settings'));
app.use('/audit',     require('./Backend/Routes/audit'));
app.use('/chat',      require('./Backend/Routes/chat'));




// Loopback only: the site is not reachable from other machines.
app.listen(PORT, '127.0.0.1', () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});