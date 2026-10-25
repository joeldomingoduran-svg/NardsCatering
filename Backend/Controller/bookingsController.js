const pool = require('../Model/db');
const { writeAudit } = require('../Model/audit');
const { isRealName } = require('../Model/validators');
const { validatePhilippineAddress } = require('../Model/address');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const TERMS_VERSION = '2026-10-15';

exports.createPaymentIntent = async (req, res) => {
  try {
    const { clientName, address, eventType, package: eventPackage, eventDate, phone, email, guests, notes } = req.body;
    if (!clientName || !address || !eventType || !eventPackage || !eventDate || !phone) {
      return res.status(400).json({ error: 'All required fields must be filled in.' });
    }

    // Fetch Stripe product price for reservation fee
    const productId = 'prod_UYIjt3ddPNgUbH';
    // Get price object for the product
    const prices = await stripe.prices.list({ product: productId, active: true, limit: 1 });
    if (!prices.data.length) {
      return res.status(400).json({ error: 'Stripe product price not found.' });
    }
    const priceObj = prices.data[0];
    const amountCentavos = priceObj.unit_amount;
    const reservationFee = amountCentavos / 100;

    // Insert booking with paymentStatus = 'unpaid' (not yet confirmed)
    const [result] = await pool.query(
      `INSERT INTO Bookings (clientName, address, eventType, package, eventDate, phone, email, guests, status, notes, paymentStatus, downPaymentAmount)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, 'unpaid', ?)`,
      [clientName, address, eventType, eventPackage, eventDate, phone, email || null, guests || 0, notes || null, reservationFee]
    );
    const bookingId = result.insertId;

    // Create Stripe PaymentIntent for reservation fee
    const paymentIntent = await stripe.paymentIntents.create({
      amount:   amountCentavos,
      currency: priceObj.currency,
      metadata: {
        bookingId: String(bookingId),
        package: eventPackage,
        productId,
        paymentType: 'reservation'
      }
    });

    res.json({ clientSecret: paymentIntent.client_secret, bookingId, amount: reservationFee });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.confirmPayment = async (req, res) => {
  try {
    const { bookingId, paymentIntentId } = req.body;
    if (!bookingId || !paymentIntentId) {
      return res.status(400).json({ error: 'bookingId and paymentIntentId are required.' });
    }

    // Verify payment status with Stripe server-side
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    if (paymentIntent.status !== 'succeeded') {
      return res.status(400).json({ error: 'Payment has not succeeded yet.' });
    }

    // Confirm the booking in the DB
    await pool.query(
      "UPDATE Bookings SET paymentStatus = 'paid', stripePaymentIntentId = ? WHERE id = ?",
      [paymentIntentId, bookingId]
    );

    res.json({ message: 'Payment confirmed.', bookingId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Customer bookings without payment proof are cancelled once the 24-hour window ends.
async function expireUnpaidBookings() {
  const [result] = await pool.query(
    `UPDATE Bookings SET status = 'cancelled'
     WHERE status = 'pending' AND paymentOption IS NOT NULL AND paymentProof IS NULL
       AND paymentDeadline IS NOT NULL AND paymentDeadline < NOW()`
  );
  return result.affectedRows;
}
exports.expireUnpaidBookings = expireUnpaidBookings;

function validTime(value) {
  const m = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/.exec(String(value || '').trim());
  return m ? `${m[1]}:${m[2]}:00` : null;
}

exports.validateAddress = (req, res) => {
  res.json(validatePhilippineAddress(req.body?.address));
};

exports.getAllBookings = async (req, res) => {
  try {
    await expireUnpaidBookings();
    const [rows] = await pool.query(
      "SELECT *, GREATEST(TIMESTAMPDIFF(SECOND, NOW(), paymentDeadline), 0) AS paymentSecondsLeft FROM Bookings ORDER BY id DESC"
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.createBooking = async (req, res) => {
  try {
    const { clientName, address, eventType, package: eventPackage, eventDate, eventTime, phone, email, guests, notes, paymentOption, gcashRef } = req.body;
    if (!clientName || !address || !eventType || !eventPackage || !eventDate || !phone) {
      return res.status(400).json({ error: "All fields are required" });
    }
    const addressCheck = validatePhilippineAddress(address);
    if (!addressCheck.valid) return res.status(400).json({ error: addressCheck.message });

    // Multipart requests come from the customer form; admin JSON requests skip payment.
    let amountDue = null, proofPath = null, refValue = null, optionValue = null;
    if (req.is('multipart/form-data')) {
      if (req.body.termsAccepted !== 'true') {
        return res.status(400).json({ error: 'Please accept the Terms and Conditions before submitting your booking.' });
      }
      const earliest = new Date();
      earliest.setDate(earliest.getDate() + 4);
      const earliestStr = `${earliest.getFullYear()}-${String(earliest.getMonth() + 1).padStart(2, '0')}-${String(earliest.getDate()).padStart(2, '0')}`;
      if (String(eventDate) < earliestStr) {
        return res.status(400).json({ error: `Bookings need at least 3 full days notice. The earliest available date is ${earliestStr}.` });
      }
      if (!isRealName(clientName)) {
        return res.status(400).json({ error: 'Please enter your real full name.' });
      }
      if (!/^\d{11}$/.test(String(phone).trim())) {
        return res.status(400).json({ error: 'Phone number must be exactly 11 digits.' });
      }
      if (!['full', 'down'].includes(paymentOption)) {
        return res.status(400).json({ error: 'Please choose Full payment or Down payment.' });
      }
      // The receipt may be attached now or later; the reference number is optional.
      const hasRef = String(gcashRef || '').trim() !== '';
      if (hasRef && !/^[A-Za-z0-9]{8,20}$/.test(String(gcashRef).trim())) {
        return res.status(400).json({ error: 'Enter a valid GCash reference number.' });
      }
      const [pkgRows] = await pool.query("SELECT price FROM Packages WHERE name = ? LIMIT 1", [eventPackage]);
      if (!pkgRows.length) return res.status(400).json({ error: 'Selected package not found.' });
      const price = Number(pkgRows[0].price);
      amountDue = paymentOption === 'down' ? Math.round(price * 20) / 100 : price;
      optionValue = paymentOption;
      refValue = hasRef ? String(gcashRef).trim() : null;
      proofPath = req.file ? `/uploads/${req.file.filename}` : null;
    }

    const awaitingPayment = Boolean(optionValue) && !proofPath;
    const deadlineSql = awaitingPayment ? 'DATE_ADD(NOW(), INTERVAL 24 HOUR)' : 'NULL';
    const [result] = await pool.query(
      `INSERT INTO Bookings (clientName, address, eventType, package, eventDate, eventTime, phone, email, guests, status, notes, paymentOption, amountDue, gcashRef, paymentProof, paymentDeadline, termsAcceptedAt, termsVersion)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${deadlineSql}, ?, ?)`,
      [clientName, address, eventType, eventPackage, eventDate, validTime(eventTime), phone, email || null, guests || 0, "pending", notes || null, optionValue, amountDue, refValue, proofPath, optionValue ? new Date() : null, optionValue ? TERMS_VERSION : null]
    );
    if (optionValue) {
      await writeAudit({ username: email || clientName, role: 'customer' }, 'Submitted booking', 'bookings', result.insertId, `${eventType} on ${eventDate}, GCash ${optionValue} payment${awaitingPayment ? ' (awaiting payment, 24h)' : ''}`);
    }
    res.status(201).json({ message: "Booking created", bookingId: result.insertId, awaitingPayment, amountDue });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Customer sends payment proof for a booking that was created without it.
exports.submitPaymentProof = async (req, res) => {
  try {
    await expireUnpaidBookings();
    const [rows] = await pool.query('SELECT * FROM Bookings WHERE id = ?', [req.params.id]);
    const booking = rows[0];
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!booking || !email || String(booking.email || '').trim().toLowerCase() !== email) {
      return res.status(404).json({ error: 'Booking not found.' });
    }
    if (booking.status !== 'pending' || !booking.paymentOption) {
      return res.status(400).json({ error: booking.status === 'cancelled' ? 'This booking was cancelled because payment was not received within 24 hours.' : 'This booking is not awaiting payment.' });
    }
    if (booking.paymentProof) return res.status(400).json({ error: 'Payment proof was already submitted and is under review.' });
    const ref = String(req.body.gcashRef || '').trim();
    if (ref && !/^[A-Za-z0-9]{8,20}$/.test(ref)) return res.status(400).json({ error: 'Enter a valid GCash reference number.' });
    if (!req.file) return res.status(400).json({ error: 'Please attach your payment receipt.' });

    await pool.query('UPDATE Bookings SET gcashRef = ?, paymentProof = ?, paymentDeadline = NULL WHERE id = ?', [ref || null, `/uploads/${req.file.filename}`, booking.id]);
    await writeAudit({ username: booking.email, role: 'customer' }, 'Submitted payment receipt', 'bookings', booking.id, ref ? `GCash ref ${ref}` : 'Receipt attached');
    res.json({ message: 'Payment proof submitted. Our staff will verify it shortly.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// A valid note is at least 20 characters of real words, not keyboard mashing.
function validateNote(text) {
  const msg = 'Please write a valid note of at least 20 characters explaining your reason.';
  if (text.length < 20) return msg;
  const words = text.split(/\s+/).filter((w) => /[A-Za-z]{2,}/.test(w));
  if (words.length < 4) return msg + ' Use complete words.';
  if ((text.match(/[A-Za-z]/g) || []).length < 15) return msg;
  if (/(.)\1{4,}/.test(text)) return msg + ' Avoid repeated characters.';
  if (new Set(words.map((w) => w.toLowerCase())).size < 3) return msg + ' Avoid repeating the same word.';
  return null;
}

// Customer asks to cancel or reschedule; staff and managers see the reason on the bookings page.
exports.requestChange = async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM Bookings WHERE id = ?', [req.params.id]);
    const booking = rows[0];
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!booking || !email || String(booking.email || '').trim().toLowerCase() !== email) {
      return res.status(404).json({ error: 'Booking not found.' });
    }
    if (!['pending', 'confirmed'].includes(booking.status)) {
      return res.status(400).json({ error: 'Only pending or confirmed bookings can be cancelled or rescheduled.' });
    }
    if (booking.requestType && !booking.requestHandled) {
      return res.status(400).json({ error: 'You already have a request waiting for staff. Please wait for their reply.' });
    }
    const type = String(req.body.type || '');
    if (!['cancel', 'reschedule'].includes(type)) return res.status(400).json({ error: 'Choose Cancel or Reschedule.' });
    const reason = String(req.body.reason || '').trim();
    const noteError = validateNote(reason);
    if (noteError) return res.status(400).json({ error: noteError });
    if (reason.length > 1000) return res.status(400).json({ error: 'Reason must be 1000 characters or fewer.' });

    let newDate = null;
    let newTime = null;
    if (type === 'reschedule') {
      const bookedDate = booking.eventDate instanceof Date
        ? `${booking.eventDate.getFullYear()}-${String(booking.eventDate.getMonth() + 1).padStart(2, '0')}-${String(booking.eventDate.getDate()).padStart(2, '0')}`
        : String(booking.eventDate || '').slice(0, 10);
      const now = new Date();
      const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      if (bookedDate && bookedDate <= todayStr) {
        return res.status(400).json({ error: 'Rescheduling is not available on the day of the event.' });
      }
      newTime = String(req.body.newTime || '').trim();
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(newTime)) return res.status(400).json({ error: 'Choose your preferred new time.' });
      newDate = String(req.body.newDate || '').trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate)) return res.status(400).json({ error: 'Choose your preferred new date.' });
      const earliest = new Date();
      earliest.setDate(earliest.getDate() + 4);
      const earliestStr = `${earliest.getFullYear()}-${String(earliest.getMonth() + 1).padStart(2, '0')}-${String(earliest.getDate()).padStart(2, '0')}`;
      if (newDate < earliestStr) return res.status(400).json({ error: `Bookings need at least 3 full days notice. The earliest valid new date is ${earliestStr}.` });
    }

    await pool.query(
      'UPDATE Bookings SET requestType = ?, requestReason = ?, requestNewDate = ?, requestNewTime = ?, requestAt = NOW(), requestHandled = 0, requestDecision = NULL, requestResponse = NULL WHERE id = ?',
      [type, reason, newDate, newTime, booking.id]
    );
    await writeAudit({ username: booking.email, role: 'customer' }, type === 'cancel' ? 'Requested cancellation' : 'Requested reschedule', 'bookings', booking.id, reason.slice(0, 200));
    res.json({ message: type === 'cancel' ? 'Your cancellation request was sent to our staff.' : 'Your reschedule request was sent to our staff.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.resolveRequest = async (req, res) => {
  try {
    const decision = String(req.body.decision || '');
    if (!['approved', 'declined'].includes(decision)) return res.status(400).json({ error: 'Choose Approve or Decline.' });
    const response = String(req.body.response || '').trim().slice(0, 500);
    const [rows] = await pool.query('SELECT * FROM Bookings WHERE id = ? AND requestType IS NOT NULL AND requestHandled = 0', [req.params.id]);
    const booking = rows[0];
    if (!booking) return res.status(404).json({ error: 'No open request found for this booking.' });
    if (decision === 'declined' && booking.requestType === 'cancel') {
      return res.status(400).json({ error: 'Cancellation requests cannot be declined. Approve them to cancel and archive the booking.' });
    }
    if (decision === 'approved' && booking.requestType === 'cancel') {
      await pool.query("UPDATE Bookings SET status = 'cancelled', is_archived = 1, cancellationReason = COALESCE(NULLIF(cancellationReason, ''), ?) WHERE id = ?", [`Cancelled at customer request: ${booking.requestReason}`.slice(0, 500), booking.id]);
    }
    if (decision === 'approved' && booking.requestType === 'reschedule') {
      await pool.query('UPDATE Bookings SET eventDate = ?, eventTime = ? WHERE id = ?', [booking.requestNewDate, booking.requestNewTime, booking.id]);
    }
    await pool.query('UPDATE Bookings SET requestHandled = 1, requestDecision = ?, requestResponse = ? WHERE id = ?', [decision, response || null, booking.id]);
    res.json({ message: `Request ${decision}.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getBookingById = async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM Bookings WHERE id = ?", [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: "Booking not found" });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.updateBookingStatus = async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { status } = req.body;
    const cancellationReason = typeof req.body.cancellationReason === 'string'
      ? req.body.cancellationReason.trim()
      : '';
    const validStatuses = ["pending", "confirmed", "completed", "cancelled"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: "Invalid status. Use: pending, confirmed, completed, or cancelled" });
    }
    if (status === 'cancelled' && !cancellationReason) {
      return res.status(400).json({ error: 'A reason is required when cancelling a booking.' });
    }
    if (cancellationReason.length > 500) {
      return res.status(400).json({ error: 'Cancellation reason must be 500 characters or fewer.' });
    }

    await conn.beginTransaction();

    const [bookingRows] = await conn.query(
      "SELECT id, package, status, guests, paymentOption, paymentProof FROM Bookings WHERE id = ? FOR UPDATE",
      [req.params.id]
    );
    if (!bookingRows.length) {
      await conn.rollback();
      return res.status(404).json({ error: "Booking not found" });
    }

    const booking = bookingRows[0];
    const isTransitionToConfirmed = status === 'confirmed' && booking.status !== 'confirmed';

    if (isTransitionToConfirmed) {
      const [pkgRows] = await conn.query(
        'SELECT id FROM Packages WHERE name = ? ORDER BY id DESC LIMIT 1',
        [booking.package]
      );

      if (pkgRows.length) {
        const pkg = pkgRows[0];

        const [requiredRows] = await conn.query(
          `SELECT di.inventory_id, i.name, i.quantity AS current_stock, CAST(SUM(di.qty_required) AS SIGNED) AS required_qty
           FROM (
             SELECT DISTINCT dish_id
             FROM PackageDishes
             WHERE package_id = ?
           ) pd
           JOIN DishIngredients di ON di.dish_id = pd.dish_id
           JOIN Inventory i ON i.id = di.inventory_id
           GROUP BY di.inventory_id, i.name, i.quantity`,
          [pkg.id]
        );

        if (requiredRows.length) {
          const insufficient = requiredRows.filter((r) => Number(r.current_stock) < Math.trunc(Number(r.required_qty)));
          if (insufficient.length) {
            await conn.rollback();
            return res.status(400).json({
              error: 'Insufficient ingredient stock for confirmation',
              details: insufficient.map((i) => ({
                ingredient: i.name,
                required: Math.trunc(Number(i.required_qty)),
                available: Math.trunc(Number(i.current_stock))
              }))
            });
          }

          for (const reqRow of requiredRows) {
            const requiredQty = Math.trunc(Number(reqRow.required_qty));
            await conn.query(
              'UPDATE Inventory SET quantity = quantity - ? WHERE id = ?',
              [requiredQty, reqRow.inventory_id]
            );
          }
        }
      }
    }

    await conn.query(
      "UPDATE Bookings SET status = ?, cancellationReason = ? WHERE id = ?",
      [status, status === 'cancelled' ? cancellationReason : null, req.params.id]
    );

    await conn.commit();
    res.json({
      message: "Booking status updated",
      inventoryDeducted: isTransitionToConfirmed
    });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
};

exports.updateBooking = async (req, res) => {
  try {
    const { clientName, address, eventType,     package: eventPackage, eventDate, eventTime, phone, email, guests, notes } = req.body;
    if (!clientName || !address || !eventType || !eventPackage || !eventDate || !phone) {
      return res.status(400).json({ error: "All fields are required" });
    }
    if (![25, 50, 100].includes(Number(guests))) {
      return res.status(400).json({ error: 'Guests must be 25, 50 or 100 pax.' });
    }
    const [current] = await pool.query('SELECT address FROM Bookings WHERE id = ?', [req.params.id]);
    if (current.length && current[0].address !== address) {
      const addressCheck = validatePhilippineAddress(address);
      if (!addressCheck.valid) return res.status(400).json({ error: addressCheck.message });
    }
    const [result] = await pool.query(
      `UPDATE Bookings SET clientName=?, address=?, eventType=?, package=?,       eventDate=?, eventTime=?, phone=?, email=?, guests=?, notes=? WHERE id=?`,
            [clientName, address, eventType, eventPackage, eventDate, validTime(eventTime), phone, email || null, guests || 0, notes || null, req.params.id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: "Booking not found" });
    res.json({ message: "Booking updated" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.archiveBooking = async (req, res) => {
  try {
    const archived = req.body.archived === false ? 0 : 1;
    const [result] = await pool.query('UPDATE Bookings SET is_archived = ? WHERE id = ?', [archived, req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Booking not found' });
    res.json({ message: archived ? 'Booking archived' : 'Booking restored' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getEventTypes = async (req, res) => {
  const fallback = ['Wedding', 'Birthday Party', 'Christening', 'Debut', 'Baptismal', 'Party', 'Anniversary', 'House Blessing', 'Corporate Event', 'Other'];
  try {
    const [rows] = await pool.query("SELECT DISTINCT eventType FROM Bookings WHERE eventType IS NOT NULL AND eventType != '' ORDER BY eventType ASC");
    const fromDb = rows.map(r => r.eventType);
    
    const merged = [...fromDb, ...fallback.filter(f => !fromDb.some(d => d.toLowerCase() === f.toLowerCase()))];
    res.json(merged);
  } catch (err) {
    res.json(fallback);
  }
};

exports.deleteBooking = async (req, res) => {
  try {
    const [result] = await pool.query("DELETE FROM Bookings WHERE id = ?", [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: "Booking not found" });
    res.json({ message: "Booking deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


exports.getTodayEvents = async (req, res) => {
  try {
    const n = new Date();
    const today = n.getFullYear() + '-' + String(n.getMonth()+1).padStart(2,'0') + '-' + String(n.getDate()).padStart(2,'0');
    const [rows] = await pool.query(
      "SELECT * FROM Bookings WHERE status = 'confirmed' AND DATE(eventDate) = ? ORDER BY eventDate ASC",
      [today]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


exports.getUpcomingEvents = async (req, res) => {
  try {
    const n = new Date();
    const today = n.getFullYear() + '-' + String(n.getMonth()+1).padStart(2,'0') + '-' + String(n.getDate()).padStart(2,'0');
    const f = new Date(n.getFullYear(), n.getMonth(), n.getDate() + 30);
    const limit = f.getFullYear() + '-' + String(f.getMonth()+1).padStart(2,'0') + '-' + String(f.getDate()).padStart(2,'0');
    const [rows] = await pool.query(
      "SELECT * FROM Bookings WHERE status = 'confirmed' AND DATE(eventDate) > ? AND DATE(eventDate) <= ? ORDER BY eventDate ASC LIMIT 15",
      [today, limit]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


exports.getStatusSummary = async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT status, COUNT(*) AS count FROM Bookings GROUP BY status"
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
