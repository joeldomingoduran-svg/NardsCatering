const { Pool } = require('pg');
const { hashPassword } = require('./passwordUtils');

const rawUrl = process.env.DATABASE_URL;
// Serverless instances are short-lived, so use Supabase's transaction pooler (6543) instead of session mode (5432).
const connectionString = rawUrl && process.env.VERCEL && /pooler\.supabase\.com:5432\//.test(rawUrl)
  ? rawUrl.replace('pooler.supabase.com:5432/', 'pooler.supabase.com:6543/')
  : rawUrl;
const missingUrlError = 'DATABASE_URL is not set. Add the Supabase Session pooler connection string to the environment variables.';

const pool = new Pool({
  connectionString,
  ssl: connectionString && !/localhost|127\.0\.0\.1/.test(connectionString) ? { rejectUnauthorized: false } : undefined,
  max: process.env.VERCEL ? 3 : 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 15_000,
  statement_timeout: 20_000,
  keepAlive: true
});
// A dropped idle connection must not crash the function.
pool.on('error', (error) => console.error('Idle database client error:', error.message));
const queryPool = pool.query.bind(pool);

const quotedIdentifiers = [
  'StaffUsers', 'LoginHistory', 'Bookings', 'CateringAssets', 'PackageAssets',
  'PackageDishes', 'PackageFreebies', 'DishIngredients', 'AuditLog', 'Settings',
  'Clients', 'Inventory', 'Menu', 'Packages', 'Dishes', 'clientName',
  'eventType', 'eventDate', 'cancellationReason', 'stripePaymentIntentId', 'paymentStatus',
  'downPaymentAmount', 'termsAcceptedAt', 'termsVersion', 'settingKey',
  'settingValue', 'profileImage', 'createdAt', 'userId', 'entityId',
  'isVerified', 'otpHash', 'otpExpires', 'otpAttempts', 'otpSentAt',
  'resetHash', 'resetExpires', 'resetAttempts', 'otpSendCount',
  'otpWindowStart', 'resetSendCount', 'resetWindowStart', 'requestType',
  'requestReason', 'requestNewDate', 'requestAt', 'requestHandled',
  'requestNewTime', 'requestDecision', 'requestResponse', 'paymentOption',
  'amountDue', 'gcashRef', 'paymentProof', 'paymentDeadline', 'eventTime',
  'paymentSecondsLeft', 'secondsLeft'
];
const identifierPattern = new RegExp(`\\b(${quotedIdentifiers.join('|')})\\b`, 'g');

function prepareQuery(text) {
  let sql = text.replace(identifierPattern, '"$1"');
  sql = sql
    .replace(/TIMESTAMPDIFF\s*\(\s*SECOND\s*,\s*NOW\(\)\s*,\s*("?[\w.]+"?)\s*\)/gi,
      'EXTRACT(EPOCH FROM ($1 - NOW()))::integer')
    .replace(/TIMESTAMPDIFF\s*\(\s*SECOND\s*,\s*("?[\w.]+"?)\s*,\s*NOW\(\)\s*\)/gi,
      'EXTRACT(EPOCH FROM (NOW() - $1))::integer')
    .replace(/DATE_ADD\s*\(\s*NOW\(\)\s*,\s*INTERVAL\s+(\d+)\s+HOUR\s*\)/gi,
      "NOW() + INTERVAL '$1 hours'")
    .replace(/\bSIGNED\b/gi, 'BIGINT');

  let index = 0;
  sql = sql.replace(/\?/g, () => `$${++index}`);

  const insert = /^\s*INSERT\s+INTO\s+("(?:[^"]|"")*"|[\w]+)/i.exec(sql);
  if (insert && !/\bRETURNING\b/i.test(sql)) {
    const table = insert[1].replaceAll('"', '');
    if (table !== 'Settings') sql = `${sql.trimEnd()} RETURNING id`;
  }

  if (/^\s*INSERT\s+INTO/i.test(sql) && !/\bON\s+CONFLICT\b/i.test(sql)) {
    sql = sql.replace(
      /ON\s+DUPLICATE\s+KEY\s+UPDATE\s+"?settingValue"?\s*=\s*VALUES\s*\(\s*"?settingValue"?\s*\)/i,
      'ON CONFLICT ("settingKey") DO UPDATE SET "settingValue" = EXCLUDED."settingValue"'
    );
  }

  return sql;
}

async function execute(client, text, values = []) {
  if (!connectionString) throw new Error(missingUrlError);
  const sql = prepareQuery(text);
  let result;
  try {
    result = await client.query(sql, values);
  } catch (error) {
    if (error.code === '23505') error.code = 'ER_DUP_ENTRY';
    throw error;
  }
  if (/^\s*(SELECT|WITH)\b/i.test(sql)) return [result.rows];

  const header = { affectedRows: result.rowCount };
  if (/^\s*INSERT\b/i.test(sql) && result.rows[0]) {
    header.insertId = result.rows[0].id;
  }
  return [header];
}

pool.query = (text, values) => execute({ query: queryPool }, text, values);
pool.getConnection = async () => {
  if (!connectionString) throw new Error(missingUrlError);
  const client = await pool.connect();
  return {
    query: (text, values) => execute(client, text, values),
    beginTransaction: () => client.query('BEGIN'),
    commit: () => client.query('COMMIT'),
    rollback: () => client.query('ROLLBACK'),
    release: () => client.release()
  };
};

let connectionCheck;
async function verifyConnection() {
  if (!connectionCheck) {
    connectionCheck = pool.query('SELECT 1').catch((error) => {
      connectionCheck = null;
      throw error;
    });
  }
  await connectionCheck;
}

// Tables and columns added after the first release. Each step is skipped when it already exists, to avoid table locks.
async function columnExists(table, column) {
  const [rows] = await pool.query(
    'SELECT 1 FROM information_schema.columns WHERE table_schema = \'public\' AND table_name = ? AND column_name = ? LIMIT 1',
    [table.toLowerCase(), column]
  );
  return rows.length > 0;
}

async function ensureExtraSchema() {
  if (!(await columnExists('Packages', 'max_guests'))) {
    await pool.query('ALTER TABLE Packages ADD COLUMN IF NOT EXISTS max_guests integer NOT NULL DEFAULT 0');
  }
  if (!(await columnExists('Bookings', 'additional_request'))) {
    await pool.query('ALTER TABLE Bookings ADD COLUMN IF NOT EXISTS additional_request varchar(500)');
    await pool.query('ALTER TABLE Bookings ADD COLUMN IF NOT EXISTS additional_cost numeric(10, 2) NOT NULL DEFAULT 0');
  }
  await pool.query(`CREATE TABLE IF NOT EXISTS role_permissions (
    role varchar(20) NOT NULL, permission varchar(60) NOT NULL, allowed smallint NOT NULL DEFAULT 0,
    PRIMARY KEY (role, permission))`);
  await pool.query(`CREATE TABLE IF NOT EXISTS dropdown_options (
    id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, category varchar(40) NOT NULL, label varchar(120) NOT NULL,
    sort_order integer NOT NULL DEFAULT 0, is_active smallint NOT NULL DEFAULT 1, UNIQUE (category, label))`);
  await pool.query(`CREATE TABLE IF NOT EXISTS notifications (
    id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, type varchar(30) NOT NULL, title varchar(120) NOT NULL,
    message varchar(400), target_roles varchar(60) NOT NULL DEFAULT 'admin,manager,staff', link_view varchar(30),
    created_at timestamp NOT NULL DEFAULT NOW())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS notification_state (
    user_id integer PRIMARY KEY, last_read_id integer NOT NULL DEFAULT 0)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS employees (
    id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    name varchar(120) NOT NULL, age integer NOT NULL, address varchar(255) NOT NULL,
    job_role varchar(60) NOT NULL, is_active smallint NOT NULL DEFAULT 1,
    created_at timestamp NOT NULL DEFAULT NOW(), updated_at timestamp NOT NULL DEFAULT NOW())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS booking_employee_assignments (
    booking_id integer NOT NULL, employee_id integer NOT NULL,
    PRIMARY KEY (booking_id, employee_id),
    FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE)`);
  await pool.query('ALTER TABLE StaffUsers ALTER COLUMN role TYPE varchar(20) USING role::text');
  await pool.query(`CREATE TABLE IF NOT EXISTS role_definitions (
    role varchar(20) PRIMARY KEY, display_name varchar(60) NOT NULL, description varchar(255),
    is_active smallint NOT NULL DEFAULT 1, is_system smallint NOT NULL DEFAULT 0,
    created_at timestamp NOT NULL DEFAULT NOW(), updated_at timestamp NOT NULL DEFAULT NOW())`);
  await pool.query(`INSERT INTO role_definitions (role, display_name, description, is_system)
    VALUES ('admin', 'Administrator', 'Full access to every system module.', 1),
           ('manager', 'Manager', 'Manages bookings, operations, reports and staff workflows.', 1),
           ('staff', 'Staff', 'Manages day-to-day bookings and customer requests.', 1)
    ON CONFLICT (role) DO NOTHING RETURNING role`);
  await require('./permissions').seedPermissions();
  await require('../Controller/dropdownsController').seedDropdowns();
}
async function ensureAdminAccount() {
  await verifyConnection();
  // Avoid ALTER TABLE (takes a heavy lock) unless the column is actually missing.
  const [cols] = await pool.query(
    "SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'staffusers' AND column_name = 'profileimage' LIMIT 1"
  );
  if (!cols.length) {
    await pool.query('ALTER TABLE StaffUsers ADD COLUMN IF NOT EXISTS profileImage varchar(255)');
  }
  await ensureExtraSchema();
  const [rows] = await pool.query('SELECT id FROM StaffUsers WHERE username = ? LIMIT 1', ['Admin']);
  if (!rows.length) {
    const password = process.env.ADMIN_INITIAL_PASSWORD;
    if (!password || password.length < 10 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) ||
        !/[0-9]/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
      console.warn('Administrator bootstrap skipped: set ADMIN_INITIAL_PASSWORD to a password with at least 10 characters, uppercase, lowercase, a number, and a special character.');
      return;
    }
    const hashedPassword = await hashPassword(password);
    await pool.query(
      "INSERT INTO StaffUsers (name, username, password, role, is_active) VALUES (?, ?, ?, 'admin', 1)",
      ['System Administrator', 'Admin', hashedPassword]
    );
    console.log('Created default administrator account.');
  }
}

pool.ensureOtpPaymentSchema = verifyConnection;
pool.ensureAuditSchema = verifyConnection;
pool.ensureClientTableSchema = verifyConnection;
pool.ensureStaffUsersTableSchema = ensureAdminAccount;
pool.ensureLoginHistoryTableSchema = verifyConnection;
pool.ensureInventoryTableSchema = verifyConnection;
pool.ensureAssetsTableSchema = verifyConnection;
pool.ensureOperationsArchiveSchema = verifyConnection;

module.exports = pool;
