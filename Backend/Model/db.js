const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_SERVER,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  waitForConnections: true,
  connectionLimit: 10,
  enableKeepAlive: true,
  dateStrings: true
});

async function ensureClientTableSchema() {
  try {
    const [rows] = await pool.query("SHOW COLUMNS FROM Clients LIKE 'password'");

    if (rows.length === 0) {
      await pool.query("ALTER TABLE Clients ADD COLUMN password VARCHAR(255) NOT NULL DEFAULT '' AFTER email");
      console.log('✅ Added missing password column to Clients table.');
    }
  } catch (error) {
    if (error && error.code === 'ER_NO_SUCH_TABLE') {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS Clients (
          id INT NOT NULL AUTO_INCREMENT,
          name VARCHAR(255) NOT NULL,
          contact VARCHAR(20) NOT NULL DEFAULT '+63 000 000 0000',
          email VARCHAR(255) NOT NULL,
          password VARCHAR(255) NOT NULL DEFAULT '',
          PRIMARY KEY (id),
          UNIQUE KEY uq_clients_email (email)
        )
      `);
      console.log('✅ Created missing Clients table with Gmail auth schema.');
      return;
    }

    console.warn('⚠️ Client schema check warning:', error.message);
  }
}

async function ensureStaffUsersTableSchema() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS StaffUsers (
        id INT NOT NULL AUTO_INCREMENT,
        name VARCHAR(255) NOT NULL,
        username VARCHAR(100) NOT NULL,
        password VARCHAR(255) NOT NULL,
        role ENUM('admin', 'manager', 'staff') NOT NULL DEFAULT 'staff',
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_staff_users_username (username)
      )
    `);
    await addColumnIfMissing('StaffUsers', 'profileImage', 'VARCHAR(255) DEFAULT NULL');
    await pool.query("ALTER TABLE StaffUsers MODIFY role ENUM('admin', 'manager', 'staff') NOT NULL DEFAULT 'staff'");
    const [mgr] = await pool.query("SELECT id FROM StaffUsers WHERE role = 'manager' LIMIT 1");
    if (mgr.length === 0) {
      await pool.query(
        "INSERT IGNORE INTO StaffUsers (name, username, password, role, is_active) VALUES (?, ?, ?, 'manager', 1)",
        [process.env.MANAGER_NAME || 'Operations Manager', process.env.MANAGER_USERNAME || 'manager', process.env.MANAGER_PASSWORD || 'nards2024']
      );
      console.log('Created default manager account.');
    }

    const [rows] = await pool.query("SELECT id FROM StaffUsers WHERE role = 'admin' LIMIT 1");
    if (rows.length === 0) {
      await pool.query(
        "INSERT INTO StaffUsers (name, username, password, role, is_active) VALUES (?, ?, ?, 'admin', 1)",
        [process.env.ADMIN_NAME || 'System Administrator', process.env.ADMIN_USERNAME || 'admin', process.env.ADMIN_PASSWORD || 'nards2024']
      );
      console.log('Created default administrator account.');
    }
  } catch (error) {
    console.warn('Staff user schema check warning:', error.message);
  }
}

async function ensureLoginHistoryTableSchema() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS LoginHistory (
        id INT NOT NULL AUTO_INCREMENT,
        user_id INT NOT NULL,
        username VARCHAR(100) NOT NULL,
        role ENUM('admin', 'manager', 'staff') NOT NULL,
        logged_in_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        INDEX idx_login_history_user (user_id),
        CONSTRAINT fk_login_history_user FOREIGN KEY (user_id) REFERENCES StaffUsers(id) ON DELETE CASCADE
      )
    `);
    await pool.query("ALTER TABLE LoginHistory MODIFY role ENUM('admin', 'manager', 'staff') NOT NULL");
  } catch (error) {
    console.warn('Login history schema check warning:', error.message);
  }
}

async function ensureInventoryTableSchema() {
  try {
    const [rows] = await pool.query("SHOW COLUMNS FROM Inventory LIKE 'is_archived'");

    if (rows.length === 0) {
      await pool.query("ALTER TABLE Inventory ADD COLUMN is_archived TINYINT(1) NOT NULL DEFAULT 0");
      console.log('✅ Added missing is_archived column to Inventory table.');
    }
  } catch (error) {
    console.warn('⚠️ Inventory schema check warning:', error.message);
  }
}

async function ensureAssetsTableSchema() {
  try {
    const [rows] = await pool.query("SHOW COLUMNS FROM CateringAssets LIKE 'is_archived'");

    if (rows.length === 0) {
      await pool.query("ALTER TABLE CateringAssets ADD COLUMN is_archived TINYINT(1) NOT NULL DEFAULT 0");
      console.log('✅ Added missing is_archived column to CateringAssets table.');
    }
  } catch (error) {
    console.warn('⚠️ Assets schema check warning:', error.message);
  }
}

async function ensureOperationsArchiveSchema() {
  for (const table of ['Packages', 'Dishes']) {
    try {
      const [rows] = await pool.query(`SHOW COLUMNS FROM ${table} LIKE 'is_archived'`);
      if (rows.length === 0) {
        await pool.query(`ALTER TABLE ${table} ADD COLUMN is_archived TINYINT(1) NOT NULL DEFAULT 0`);
        console.log(`✅ Added missing is_archived column to ${table} table.`);
      }
    } catch (error) {
      console.warn(`⚠️ ${table} schema check warning:`, error.message);
    }
  }
  try {
    await addColumnIfMissing('Packages', 'is_popular', 'TINYINT(1) NOT NULL DEFAULT 0');
  } catch (error) {
    console.warn('⚠️ Packages is_popular schema check warning:', error.message);
  }
}

async function addColumnIfMissing(table, column, definition) {
  const [rows] = await pool.query(`SHOW COLUMNS FROM ${table} LIKE ?`, [column]);
  if (rows.length === 0) {
    await pool.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    return true;
  }
  return false;
}

async function ensureAuditSchema() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS AuditLog (
        id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        userId INT DEFAULT NULL,
        username VARCHAR(100) NOT NULL,
        role VARCHAR(20) NOT NULL,
        action VARCHAR(80) NOT NULL,
        entity VARCHAR(40) DEFAULT NULL,
        entityId VARCHAR(40) DEFAULT NULL,
        details VARCHAR(500) DEFAULT NULL,
        createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_audit_created (createdAt)
      )
    `);
  } catch (error) {
    console.warn('Audit log schema check warning:', error.message);
  }
}

async function ensureOtpPaymentSchema() {
  try {
    // Existing accounts default to verified so current users are not locked out.
    const added = await addColumnIfMissing('Clients', 'isVerified', 'TINYINT(1) NOT NULL DEFAULT 1');
    if (added) {
      await pool.query("ALTER TABLE Clients ALTER COLUMN isVerified SET DEFAULT 0");
    }
    await addColumnIfMissing('Clients', 'otpHash', 'VARCHAR(64) DEFAULT NULL');
    await addColumnIfMissing('Clients', 'otpExpires', 'DATETIME DEFAULT NULL');
    await addColumnIfMissing('Clients', 'otpAttempts', 'INT NOT NULL DEFAULT 0');
    await addColumnIfMissing('Clients', 'otpSentAt', 'DATETIME DEFAULT NULL');
    await addColumnIfMissing('Clients', 'resetHash', 'VARCHAR(64) DEFAULT NULL');
    await addColumnIfMissing('Clients', 'resetExpires', 'DATETIME DEFAULT NULL');
    await addColumnIfMissing('Clients', 'resetAttempts', 'INT NOT NULL DEFAULT 0');
    await addColumnIfMissing('Clients', 'otpSendCount', 'INT NOT NULL DEFAULT 0');
    await addColumnIfMissing('Clients', 'otpWindowStart', 'DATETIME DEFAULT NULL');
    await addColumnIfMissing('Clients', 'resetSendCount', 'INT NOT NULL DEFAULT 0');
    await addColumnIfMissing('Clients', 'resetWindowStart', 'DATETIME DEFAULT NULL');

    await pool.query(`
      CREATE TABLE IF NOT EXISTS Settings (
        settingKey VARCHAR(100) NOT NULL PRIMARY KEY,
        settingValue VARCHAR(500) DEFAULT NULL
      )
    `);

    await addColumnIfMissing('Bookings', 'paymentOption', "ENUM('full','down') DEFAULT NULL");
    await addColumnIfMissing('Bookings', 'amountDue', 'DECIMAL(10,2) DEFAULT NULL');
    await addColumnIfMissing('Bookings', 'gcashRef', 'VARCHAR(50) DEFAULT NULL');
    await addColumnIfMissing('Bookings', 'paymentProof', 'VARCHAR(255) DEFAULT NULL');
    await addColumnIfMissing('Bookings', 'paymentDeadline', 'DATETIME DEFAULT NULL');
    await addColumnIfMissing('Bookings', 'cancellationReason', 'VARCHAR(500) DEFAULT NULL');
    await addColumnIfMissing('Bookings', 'eventTime', 'TIME DEFAULT NULL');
    await addColumnIfMissing('Bookings', 'requestType', "VARCHAR(12) DEFAULT NULL");
    await addColumnIfMissing('Bookings', 'requestReason', "VARCHAR(1000) DEFAULT NULL");
    await addColumnIfMissing('Bookings', 'requestNewDate', "DATE DEFAULT NULL");
    await addColumnIfMissing('Bookings', 'requestAt', "DATETIME DEFAULT NULL");
    await addColumnIfMissing('Bookings', 'requestHandled', "TINYINT(1) NOT NULL DEFAULT 0");
    await addColumnIfMissing('Bookings', 'requestNewTime', "TIME DEFAULT NULL");
    await addColumnIfMissing('Bookings', 'requestDecision', "VARCHAR(10) DEFAULT NULL");
    await addColumnIfMissing('Bookings', 'requestResponse', "VARCHAR(500) DEFAULT NULL");
    await addColumnIfMissing('Bookings', 'is_archived', 'TINYINT(1) NOT NULL DEFAULT 0');
    await addColumnIfMissing('Bookings', 'termsAcceptedAt', 'DATETIME DEFAULT NULL');
    await addColumnIfMissing('Bookings', 'termsVersion', 'VARCHAR(20) DEFAULT NULL');
  } catch (error) {
    console.warn('OTP/payment schema check warning:', error.message);
  }
}

pool.ensureOtpPaymentSchema = ensureOtpPaymentSchema;
pool.ensureAuditSchema = ensureAuditSchema;
pool.ensureClientTableSchema = ensureClientTableSchema;
pool.ensureStaffUsersTableSchema = ensureStaffUsersTableSchema;
pool.ensureLoginHistoryTableSchema = ensureLoginHistoryTableSchema;
pool.ensureInventoryTableSchema = ensureInventoryTableSchema;
pool.ensureAssetsTableSchema = ensureAssetsTableSchema;
pool.ensureOperationsArchiveSchema = ensureOperationsArchiveSchema;

module.exports = pool;
