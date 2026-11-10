/**
 * Create Admin Account Script
 * Usage: node create-admin.js
 */

require('dotenv').config();
const pool = require('./Backend/Model/db');
const { hashPassword } = require('./Backend/Model/passwordUtils');

async function createAdmin() {
  try {
    console.log('🔐 Creating Admin Account...\n');

    // Admin details
    const name = 'Maynard Admin';
    const username = 'MaynardAdmin';
    const plainPassword = 'Nards2024!'; // Password meets all requirements

    // Validate password
    const passwordRegex = /^(?=.*[A-Z])(?=.*[a-z])(?=.*\d)(?=.*[!@#$%^&*]).{10,}$/;
    if (!passwordRegex.test(plainPassword)) {
      console.error('❌ Password does not meet requirements:');
      console.error('   - Minimum 10 characters');
      console.error('   - At least one uppercase letter');
      console.error('   - At least one lowercase letter');
      console.error('   - At least one number');
      console.error('   - At least one special character (!@#$%^&*)');
      process.exit(1);
    }

    console.log('✅ Password validation passed\n');

    // Hash password
    console.log('🔒 Hashing password...');
    const hashedPassword = await hashPassword(plainPassword);
    console.log('✅ Password hashed successfully\n');

    // Check if user already exists
    console.log('🔍 Checking if user already exists...');
    const [existing] = await pool.query(
      'SELECT id, username FROM StaffUsers WHERE username = ? LIMIT 1',
      [username]
    );

    if (existing && existing.length > 0) {
      console.log('⚠️  User already exists with ID:', existing[0].id);
      console.log('Updating existing user...\n');
      
      await pool.query(
        'UPDATE StaffUsers SET password = ?, role = ?, is_active = ? WHERE username = ?',
        [hashedPassword, 'admin', 1, username]  // Use 1 for true (boolean)
      );
      
      console.log('✅ Admin account updated successfully!\n');
    } else {
      // Insert admin account
      console.log('📝 Creating new admin account...');
      const [result] = await pool.query(
        `INSERT INTO StaffUsers (name, username, password, role, is_active)
         VALUES (?, ?, ?, ?, ?)`,
        [name, username, hashedPassword, 'admin', 1]  // Use 1 for true (boolean)
      );

      console.log('✅ Admin account created successfully!\n');
      if (result) {
        console.log('Account Details:');
        console.log('  ID:', result.insertId);
        console.log('  Name:', name);
        console.log('  Username:', username);
        console.log('  Role: admin');
      }
    }

    console.log('\n🔐 Login Credentials:');
    console.log('  Username:', username);
    console.log('  Password:', plainPassword);
    console.log('\n📍 Login URL: http://localhost:3000/login');
    console.log('\n⚠️  IMPORTANT: Do not share these credentials!');
    console.log('✅ Admin account is ready to use!\n');

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.code === 'ECONNREFUSED' || error.message.includes('ECONNREFUSED')) {
      console.error('\n⚠️  Database connection failed!');
      console.error('Make sure:');
      console.error('  1. PostgreSQL/Supabase database is running');
      console.error('  2. DATABASE_URL is set in .env file');
      console.error('  3. Network connectivity to database is available');
    }
    process.exit(1);
  }
}

createAdmin();
