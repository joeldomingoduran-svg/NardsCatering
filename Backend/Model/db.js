const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;
const missingUrlError = 'DATABASE_URL is not set. Add the Supabase Session pooler connection string to the environment variables.';

const pool = new Pool({
  connectionString,
  ssl: connectionString && !/localhost|127\.0\.0\.1/.test(connectionString) ? { rejectUnauthorized: false } : undefined,
  max: process.env.VERCEL ? 3 : 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 15_000
});
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

// Hardcoded admin account, created on startup if it does not exist yet.
async function ensureAdminAccount() {
  await verifyConnection();
  await pool.query('ALTER TABLE StaffUsers ADD COLUMN IF NOT EXISTS profileImage varchar(255)');
  const [rows] = await pool.query('SELECT id FROM StaffUsers WHERE username = ? LIMIT 1', ['Admin']);
  if (!rows.length) {
    await pool.query(
      "INSERT INTO StaffUsers (name, username, password, role, is_active) VALUES (?, ?, ?, 'admin', 1)",
      ['System Administrator', 'Admin', 'Nards2024']
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
