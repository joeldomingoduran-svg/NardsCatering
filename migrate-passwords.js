/**
 * Password Migration Script
 * 
 * This script converts plaintext passwords in the database to bcrypt hashes.
 * Run this ONCE after deploying the password security updates.
 * 
 * BEFORE running this script:
 * 1. Ensure AUTH_TOKEN_SECRET is set in .env
 * 2. Back up your database
 * 3. Stop the application server
 * 
 * Usage: node migrate-passwords.js
 */

require('dotenv').config();
const pool = require('./Backend/Model/db');
const { hashPassword } = require('./Backend/Model/passwordUtils');

const STAFF_TABLE = 'Staff';
const CLIENT_TABLE = 'Clients';

async function migrateTablePasswords(tableName, userIdColumn) {
  console.log(`\nMigrating ${tableName} passwords...`);

  try {
    // Get all users with plaintext passwords
    const [users] = await pool.query(
      `SELECT ${userIdColumn} AS id, password FROM ${tableName} WHERE password IS NOT NULL AND password NOT LIKE '$2a$%' AND password NOT LIKE '$2b$%'`
    );

    if (users.length === 0) {
      console.log(`✓ ${tableName}: No plaintext passwords found (already migrated)`);
      return;
    }

    console.log(`Found ${users.length} users with plaintext passwords in ${tableName}`);

    let migrated = 0;
    let failed = 0;

    for (const user of users) {
      try {
        const hashedPassword = await hashPassword(user.password);
        await pool.query(
          `UPDATE ${tableName} SET password = ? WHERE ${userIdColumn} = ?`,
          [hashedPassword, user.id]
        );
        migrated++;
        process.stdout.write('.');
      } catch (err) {
        failed++;
        process.stdout.write('F');
        console.error(`\n  Failed to migrate ${userIdColumn} ${user.id}: ${err.message}`);
      }
    }

    console.log(`\n✓ ${tableName}: ${migrated} migrated, ${failed} failed`);
  } catch (err) {
    console.error(`✗ Error migrating ${tableName}:`, err.message);
    throw err;
  }
}

async function main() {
  console.log('='.repeat(60));
  console.log('Password Migration Script');
  console.log('='.repeat(60));

  try {
    // Test database connection
    const [result] = await pool.query('SELECT 1');
    console.log('✓ Database connection successful');

    // Migrate Staff table
    await migrateTablePasswords(STAFF_TABLE, 'id');

    // Migrate Clients table
    await migrateTablePasswords(CLIENT_TABLE, 'id');

    console.log('\n' + '='.repeat(60));
    console.log('✓ Migration complete!');
    console.log('='.repeat(60));
    console.log('\nNext steps:');
    console.log('1. Verify the application works correctly');
    console.log('2. Test staff login (Backend/Controller/staffController.js:loginStaff)');
    console.log('3. Test customer login (Backend/Controller/clientController.js:loginClient)');
    console.log('4. Test password changes');
    console.log('5. Commit migration record to git');
    process.exit(0);
  } catch (err) {
    console.error('\n' + '='.repeat(60));
    console.error('✗ Migration failed:', err.message);
    console.error('='.repeat(60));
    console.error('\nTroubleshooting:');
    console.error('- Check that AUTH_TOKEN_SECRET is set in .env');
    console.error('- Verify DATABASE_URL is correct');
    console.error('- Ensure database is accessible and running');
    console.error('- Verify backup exists before retrying');
    process.exit(1);
  }
}

main();
