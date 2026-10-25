require('dotenv').config();
const mysql = require('mysql2/promise');

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_SERVER,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    port: Number(process.env.DB_PORT)
  });

  const [cols] = await conn.query(
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'bookings'",
    [process.env.DB_DATABASE]
  );
  const existing = cols.map(c => c.COLUMN_NAME.toLowerCase());

  if (!existing.includes('stripepaymentintentid')) {
    await conn.query('ALTER TABLE bookings ADD COLUMN stripePaymentIntentId VARCHAR(255) DEFAULT NULL');
    console.log('  + stripePaymentIntentId added');
  } else { console.log('  ~ stripePaymentIntentId already exists'); }

  if (!existing.includes('paymentstatus')) {
    await conn.query("ALTER TABLE bookings ADD COLUMN paymentStatus ENUM('unpaid','paid','failed') NOT NULL DEFAULT 'unpaid'");
    console.log('  + paymentStatus added');
  } else { console.log('  ~ paymentStatus already exists'); }

  if (!existing.includes('downpaymentamount')) {
    await conn.query('ALTER TABLE bookings ADD COLUMN downPaymentAmount DECIMAL(10,2) DEFAULT NULL');
    console.log('  + downPaymentAmount added');
  } else { console.log('  ~ downPaymentAmount already exists'); }

  console.log('Migration complete: payment columns added to bookings table.');
  await conn.end();
})().catch(e => { console.error('Migration failed:', e.message); process.exit(1); });
