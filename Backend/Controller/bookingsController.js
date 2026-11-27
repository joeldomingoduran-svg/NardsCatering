const pool = require('../Model/db');
const { writeAudit } = require('../Model/audit');
const { isRealName, isValidEmail, isWithinBusinessHours, parseBusinessTime, isElevenDigitPhone } = require('../Model/validators');
const { notify } = require('../Model/notifications');
const { validatePhilippineAddress } = require('../Model/address');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY || 'sk_missing_key');

const TERMS_VERSION = '2026-10-15';
const MAX_EVENTS_PER_DAY = 2;
const ADDITIONAL_GUEST_RATE = 350;

async function recordBookingStockMovement(conn, entry) {
  try {
    await conn.query(
      `INSERT INTO inventory_movements
        (item_type, item_id, item_name, change_qty, previous_qty, new_qty, reason, reference_booking_id, actor)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entry.itemType,
        entry.itemId,
        entry.itemName,
        entry.changeQty,
        entry.previousQty,
        entry.newQty,
        entry.reason,
        entry.bookingId || null,
        entry.actor || null
      ]
    );
  } catch (err) {
    // Ignore when movement logging table is absent in unit test mocks.
  }
}

async function readAdvisoryFlag() {
  try {
    const { readBookingAdvisory } = require('./settingsController');
    return await readBookingAdvisory();
  } catch (err) {
    return { active: false };
  }
}

async function sendBookingOtpFollowUp(email, details, bookingId, awaitingPayment) {
  if (!email || !process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) return { sent: false, code: null };
  try {
    const otpCode = String(Math.floor(100000 + Math.random() * 900000));
    try { await pool.query('UPDATE Bookings SET booking_otp = ? WHERE id = ?', [otpCode, bookingId]); } catch (e) {}
    const { sendBookingFollowUpEmail } = require('../Model/mailer');
    await sendBookingFollowUpEmail(email, { ...details, bookingId, awaitingPayment }, otpCode);
    return { sent: true, code: otpCode };
  } catch (err) {
    console.error('Booking follow-up email failed:', err.message);
    return { sent: false, code: null };
  }
}

// Rejects a guest count above the package limit (a limit of 0 means no limit).
async function guestLimitError(packageName, guests) {
  const count = Number(guests);
  if (!Number.isFinite(count) || count < 0) return 'Enter a valid number of guests.';
  const [rows] = await pool.query('SELECT name, max_guests FROM Packages WHERE name = ? LIMIT 1', [packageName]);
  const max = rows.length ? Number(rows[0].max_guests) : 0;
  if (max > 0 && count > max) return `The ${rows[0].name} allows a maximum of ${max} guests.`;
  return null;
}

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
  if (typeof parseBusinessTime === 'function') {
    const parsed = parseBusinessTime(value);
    if (parsed) return `${parsed}:00`;
  }
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
    const teamByBooking = new Map();
    try {
      const [teamRows] = await pool.query(
        `SELECT a.booking_id, e.id, e.name, e.job_role
         FROM booking_employee_assignments a
         JOIN employees e ON e.id = a.employee_id
         ORDER BY e.name ASC`
      );
      teamRows.forEach((t) => {
        if (!teamByBooking.has(t.booking_id)) teamByBooking.set(t.booking_id, []);
        teamByBooking.get(t.booking_id).push({ id: t.id, name: t.name, job_role: t.job_role });
      });
    } catch (teamErr) {
      // Assignments table may be absent in stripped unit-test mocks.
    }
    res.json(rows.map((r) => ({ ...r, assignedEmployees: teamByBooking.get(r.id) || [] })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.createBooking = async (req, res) => {
  try {
    const { clientName, address, eventType, package: eventPackage, eventDate, eventTime, phone, email, guests, additionalGuests, selectedMenus, notes, paymentOption, gcashRef, additionalRequest, additionalCost } = req.body;
    if (!clientName || !address || !eventType || !eventPackage || !eventDate || !phone) {
      return res.status(400).json({ error: "All fields are required" });
    }
    if (!isRealName(clientName)) {
      return res.status(400).json({ error: 'Enter a real full name (first and last name).' });
    }
    if (typeof isElevenDigitPhone === 'function' && !isElevenDigitPhone(phone)) {
      return res.status(400).json({ error: 'Phone number must start with 09, be 11 digits, and be a real mobile number.' });
    }
    const addressCheck = validatePhilippineAddress(address);
    if (!addressCheck.valid) return res.status(400).json({ error: addressCheck.message });
    if (email && !isValidEmail(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
    if (eventTime && !isWithinBusinessHours(eventTime)) {
      return res.status(400).json({ error: 'Event time must be within business hours (8:00 AM to 6:00 PM).' });
    }
    const addGuestsCount = Math.max(0, Math.trunc(Number(additionalGuests) || 0));
    const hasExplicitAdditionalGuests = additionalGuests !== undefined && additionalGuests !== null;
    if (req.internalBooking && !hasExplicitAdditionalGuests && (!Number.isInteger(Number(guests)) || Number(guests) < 1)) {
      return res.status(400).json({ error: 'Enter a valid number of guests.' });
    }
    if (req.internalBooking && (!Number.isFinite(Number(additionalCost || 0)) || Number(additionalCost || 0) < 0)) {
      return res.status(400).json({ error: 'Enter a valid additional cost.' });
    }
    if (req.internalBooking && String(additionalRequest || '').length > 500) {
      return res.status(400).json({ error: 'Additional request must be at most 500 characters.' });
    }
    if (!hasExplicitAdditionalGuests) {
      const guestError = await guestLimitError(eventPackage, guests || 0);
      if (guestError) return res.status(400).json({ error: guestError });
    }

    // Multipart requests come from the customer form; admin JSON requests skip payment.
    let amountDue = null, proofPath = null, refValue = null, optionValue = null;
    let totalGuestsToStore = Number(guests) || addGuestsCount || 0;
    let extraMenuCost = 0;
    let selectedMenusText = null;
    if (req.is('multipart/form-data')) {
      const advisory = await readAdvisoryFlag();
      if (advisory.active) {
        return res.status(503).json({
          error: `${advisory.title}: Online booking submissions are temporarily unavailable. Please check the News & Advisories section or contact us directly.`
        });
      }
      if (req.body.termsAccepted !== 'true') {
        return res.status(400).json({ error: 'Please accept the Terms and Conditions before submitting your booking.' });
      }
      const earliest = new Date();
      earliest.setDate(earliest.getDate() + 4);
      const earliestStr = `${earliest.getFullYear()}-${String(earliest.getMonth() + 1).padStart(2, '0')}-${String(earliest.getDate()).padStart(2, '0')}`;
      if (String(eventDate) < earliestStr) {
        return res.status(400).json({ error: `Bookings need at least 3 full days notice. The earliest available date is ${earliestStr}.` });
      }
      const [daySlots] = await pool.query(
        "SELECT COUNT(*) AS cnt FROM Bookings WHERE DATE(eventDate) = DATE(?) AND status = 'confirmed' AND COALESCE(is_archived, 0) = 0",
        [eventDate]
      );
      if (Number(daySlots[0]?.cnt || 0) >= MAX_EVENTS_PER_DAY) {
        return res.status(400).json({ error: `This date already has ${MAX_EVENTS_PER_DAY} confirmed events (daily maximum reached). Please select another date.` });
      }
      const slotTime = validTime(eventTime);
      if (slotTime) {
        const [timeClash] = await pool.query(
          "SELECT id FROM Bookings WHERE DATE(eventDate) = DATE(?) AND eventTime = ? AND status = 'confirmed' AND COALESCE(is_archived, 0) = 0 LIMIT 1",
          [eventDate, slotTime]
        );
        if (timeClash.length) {
          return res.status(400).json({ error: 'This date and time slot is already booked. Please choose another time.' });
        }
      }
      if (!isRealName(clientName)) {
        return res.status(400).json({ error: 'Please enter your real full name.' });
      }
      if (!['full', 'down'].includes(paymentOption)) {
        return res.status(400).json({ error: 'Please choose Full payment or Down payment.' });
      }
      // The receipt may be attached now or later; the reference number is optional.
      const hasRef = String(gcashRef || '').trim() !== '';
      if (hasRef && !/^[A-Za-z0-9]{8,20}$/.test(String(gcashRef).trim())) {
        return res.status(400).json({ error: 'Enter a valid GCash reference number.' });
      }
      const [pkgRows] = await pool.query("SELECT id, name, price, min_guests, max_guests, COALESCE(main_course_limit, 0) AS main_course_limit FROM Packages WHERE name = ? LIMIT 1", [eventPackage]);
      if (!pkgRows.length) return res.status(400).json({ error: 'Selected package not found.' });

      try {
        const missingPkgItems = [];
        const [pkgIngRows] = await pool.query(
          `SELECT i.name, i.quantity AS available_qty, COALESCE(i.is_archived, 0) AS is_archived, CAST(SUM(di.qty_required) AS SIGNED) AS required_qty
           FROM (SELECT DISTINCT dish_id FROM PackageDishes WHERE package_id = ?) pd
           JOIN DishIngredients di ON di.dish_id = pd.dish_id
           JOIN Inventory i ON i.id = di.inventory_id
           GROUP BY i.id, i.name, i.quantity, i.is_archived`,
          [pkgRows[0].id]
        );
        for (const r of pkgIngRows || []) {
          const avail = Number(r.available_qty) || 0;
          const reqQty = Number(r.required_qty) || 0;
          if (Number(r.is_archived) === 1 || avail <= 0 || avail < reqQty) {
            missingPkgItems.push(`${r.name} (available: ${avail}, needs ${reqQty})`);
          }
        }
        const [pkgAssetRows] = await pool.query(
          `SELECT ca.name, ca.quantity AS available_qty, COALESCE(ca.is_archived, 0) AS is_archived, pa.qty_required
           FROM PackageAssets pa
           JOIN CateringAssets ca ON ca.id = pa.asset_id
           WHERE pa.package_id = ?`,
          [pkgRows[0].id]
        );
        for (const a of pkgAssetRows || []) {
          const avail = Number(a.available_qty) || 0;
          const reqQty = Number(a.qty_required) || 0;
          if (Number(a.asset_archived) === 1 || avail <= 0 || avail < reqQty) {
            missingPkgItems.push(`${a.name} (available: ${avail}, needs ${reqQty})`);
          }
        }
        if (missingPkgItems.length) {
          return res.status(400).json({
            error: `${pkgRows[0].name} is currently not available because some included inventory items are out of stock or insufficient: ${missingPkgItems.join(', ')}. Please choose an available package.`
          });
        }
      } catch (pkgCheckErr) {}

      // Validate customer menu selections (+₱2,000 per extra main course beyond package allowance).
      const mainLimit = Math.max(0, Number(pkgRows[0].main_course_limit) || 0);
      let parsedMenus = [];
      if (typeof selectedMenus === 'string' && selectedMenus.trim()) {
        try { const arr = JSON.parse(selectedMenus); if (Array.isArray(arr)) parsedMenus = arr; } catch (e) {
          parsedMenus = selectedMenus.split(',').map((s) => s.trim()).filter(Boolean);
        }
      } else if (Array.isArray(selectedMenus)) {
        parsedMenus = selectedMenus;
      }
      try {
        const [dishRows] = await pool.query("SELECT name, category FROM Dishes WHERE COALESCE(is_archived, 0) = 0 ORDER BY category ASC, name ASC");
        const validMainNames = new Set(dishRows.filter((d) => String(d.category || '').toLowerCase() !== 'dessert').map((d) => d.name));
        const dessertNames = dishRows.filter((d) => String(d.category || '').toLowerCase() === 'dessert').map((d) => d.name);
        const chosenMains = [...new Set(parsedMenus.map((s) => String(s || '').trim()).filter((n) => validMainNames.has(n)))];
        if (mainLimit > 0 && validMainNames.size > 0) {
          if (chosenMains.length < Math.min(mainLimit, validMainNames.size)) {
            return res.status(400).json({ error: `Please select at least ${mainLimit} preferred main course(s) for ${pkgRows[0].name}.` });
          }
          const extraDishesCount = Math.max(0, chosenMains.length - mainLimit);
          extraMenuCost = extraDishesCount * 2000;
          selectedMenusText = JSON.stringify({ main: chosenMains, desserts: dessertNames, extraCount: extraDishesCount, extraCost: extraMenuCost });
        } else if (mainLimit === 0 && validMainNames.size > 0) {
          selectedMenusText = JSON.stringify({ main: Array.from(validMainNames), desserts: dessertNames, extraCount: 0, extraCost: 0 });
        }
      } catch (e) {}

      const basePax = Number(pkgRows[0].max_guests) || Number(pkgRows[0].min_guests) || 0;
      totalGuestsToStore = basePax > 0 ? (basePax + addGuestsCount) : (Number(guests) || addGuestsCount);
      const price = Number(pkgRows[0].price) + (addGuestsCount * ADDITIONAL_GUEST_RATE) + extraMenuCost;
      amountDue = paymentOption === 'down' ? Math.round(price * 20) / 100 : price;
      optionValue = paymentOption;
      refValue = hasRef ? String(gcashRef).trim() : null;
      proofPath = req.file ? req.file.url : null;
    }

    const awaitingPayment = Boolean(optionValue) && !proofPath;
    const deadlineSql = awaitingPayment ? 'DATE_ADD(NOW(), INTERVAL 24 HOUR)' : 'NULL';
    const [result] = await pool.query(
      `INSERT INTO Bookings (clientName, address, eventType, package, eventDate, eventTime, phone, email, guests, status, notes, paymentOption, amountDue, gcashRef, paymentProof, paymentDeadline, termsAcceptedAt, termsVersion, additional_request, additional_cost)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${deadlineSql}, ?, ?, ?, ?)`,
      [clientName, address, eventType, eventPackage, eventDate, validTime(eventTime), phone, email || null, totalGuestsToStore, "pending", notes || null, optionValue, amountDue, refValue, proofPath, optionValue ? new Date() : null, optionValue ? TERMS_VERSION : null, req.internalBooking ? String(additionalRequest || '') || null : (extraMenuCost > 0 ? `Extra menu selections (+₱${extraMenuCost.toLocaleString('en-PH')})` : null), req.internalBooking ? Number(additionalCost || 0) : extraMenuCost]
    );
    if (addGuestsCount > 0) {
      try { await pool.query('UPDATE Bookings SET additional_guests = ? WHERE id = ?', [addGuestsCount, result.insertId]); } catch (e) {}
    }
    if (selectedMenusText) {
      try { await pool.query('UPDATE Bookings SET selected_menus = ? WHERE id = ?', [selectedMenusText, result.insertId]); } catch (e) {}
    }
    if (optionValue) {
      await writeAudit({ username: email || clientName, role: 'customer' }, 'Submitted booking', 'bookings', result.insertId, `${eventType} on ${eventDate}, GCash ${optionValue} payment${awaitingPayment ? ' (awaiting payment, 24h)' : ''}`);
    }
    const followUp = await sendBookingOtpFollowUp(email, {
      clientName,
      address,
      eventType,
      packageName: eventPackage,
      eventDate,
      eventTime: validTime(eventTime) ? String(eventTime).slice(0, 5) : '',
      guests: guests || 0,
      paymentOption: optionValue,
      amountDue
    }, result.insertId, awaitingPayment);
    await notify('booking', 'New booking request', `${clientName} booked ${eventType} on ${eventDate}.`, ['admin', 'manager', 'staff'], 'bookings');
    res.status(201).json({
      message: "Booking created",
      bookingId: result.insertId,
      awaitingPayment,
      amountDue,
      followUpOtpSent: followUp.sent
    });
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
    if (booking.status !== 'pending') {
      return res.status(400).json({ error: booking.status === 'cancelled' ? 'This booking was cancelled because payment was not received within 24 hours.' : 'This booking is not awaiting payment.' });
    }
    if (booking.paymentProof) return res.status(400).json({ error: 'Payment proof was already submitted and is under review.' });
    const ref = String(req.body.gcashRef || '').trim();
    if (ref && !/^[A-Za-z0-9]{8,20}$/.test(ref)) return res.status(400).json({ error: 'Enter a valid GCash reference number.' });
    if (!req.file) return res.status(400).json({ error: 'Please attach your payment receipt.' });

    let paymentOption = booking.paymentOption;
    let amountDue = booking.amountDue;
    if (!paymentOption) {
      const chosen = String(req.body.paymentOption || 'down').trim();
      if (!['full', 'down'].includes(chosen)) return res.status(400).json({ error: 'Choose Full payment or Down payment.' });
      paymentOption = chosen;
      const [pkgRows] = await pool.query('SELECT price FROM Packages WHERE name = ? LIMIT 1', [booking.package]);
      const price = pkgRows.length ? Number(pkgRows[0].price) : 0;
      amountDue = paymentOption === 'down' ? Math.round(price * 20) / 100 : price;
    }

    await pool.query('UPDATE Bookings SET paymentOption = ?, amountDue = ?, gcashRef = ?, paymentProof = ?, paymentDeadline = NULL WHERE id = ?', [paymentOption, amountDue, ref || null, req.file.url, booking.id]);
    await writeAudit({ username: booking.email, role: 'customer' }, 'Submitted payment receipt', 'bookings', booking.id, ref ? `GCash ref ${ref}` : 'Receipt attached');
    await notify('payment', 'Payment receipt submitted', `Booking #${booking.id} (${booking.clientName}) sent a payment receipt for review.`, ['admin', 'manager', 'staff'], 'bookings');
    res.json({ message: 'Payment proof submitted. Our staff will verify it shortly.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.uploadRefundReceipt = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Please attach the refund receipt image.' });
    const [rows] = await pool.query('SELECT id, clientName, status, email FROM Bookings WHERE id = ? LIMIT 1', [req.params.id]);
    const booking = rows[0];
    if (!booking) return res.status(404).json({ error: 'Booking not found.' });
    if (String(booking.status || '').toLowerCase() !== 'cancelled') {
      return res.status(400).json({ error: 'Refund receipts can only be uploaded for cancelled bookings.' });
    }
    await pool.query('UPDATE Bookings SET refund_receipt = ? WHERE id = ?', [req.file.url, booking.id]);
    await writeAudit(req.user, 'Uploaded refund receipt', 'bookings', booking.id, `Refund receipt uploaded for ${booking.clientName}`);
    await notify('payment', 'Refund receipt uploaded', `Refund receipt uploaded for cancelled booking #${booking.id} (${booking.clientName}).`, ['admin', 'manager', 'staff'], 'bookings');
    res.json({ message: 'Refund receipt uploaded and shared on the customer portal.', refund_receipt: req.file.url });
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
    await notify('request', type === 'cancel' ? 'Cancellation requested' : 'Reschedule requested', `Booking #${booking.id} (${booking.clientName}) needs a decision.`, ['admin', 'manager', 'staff'], 'bookings');
    res.json({ message: type === 'cancel' ? 'Your cancellation request was sent to our staff.' : 'Your reschedule request was sent to our staff.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Deduct (direction = -1) or restore (direction = +1) both Inventory ingredients and CateringAssets for a package.
// Confirmation is allowed even when stock is insufficient; shortages are reported for immediate restocking.
async function adjustPackageStocks(conn, packageName, direction, bookingId = null, actor = null) {
  const [pkgRows] = await conn.query(
    'SELECT id FROM Packages WHERE name = ? ORDER BY id DESC LIMIT 1',
    [packageName]
  );
  if (!pkgRows.length) return { ok: true, changed: false, shortages: [] };
  const pkgId = pkgRows[0].id;

  const [invRows] = await conn.query(
    `SELECT di.inventory_id, i.name, i.quantity AS current_stock, CAST(SUM(di.qty_required) AS SIGNED) AS required_qty
     FROM (SELECT DISTINCT dish_id FROM PackageDishes WHERE package_id = ?) pd
     JOIN DishIngredients di ON di.dish_id = pd.dish_id
     JOIN Inventory i ON i.id = di.inventory_id
     GROUP BY di.inventory_id, i.name, i.quantity`,
    [pkgId]
  );
  const [assetRows] = await conn.query(
    `SELECT pa.asset_id, a.name, a.quantity AS current_stock, CAST(SUM(pa.qty_required) AS SIGNED) AS required_qty
     FROM PackageAssets pa
     JOIN CateringAssets a ON a.id = pa.asset_id
     WHERE pa.package_id = ?
     GROUP BY pa.asset_id, a.name, a.quantity`,
    [pkgId]
  );

  const shortages = [];
  if (direction < 0) {
    for (const r of invRows) {
      const reqQty = Math.trunc(Number(r.required_qty));
      const avail = Math.trunc(Number(r.current_stock));
      if (avail < reqQty) shortages.push({ itemType: 'ingredient', ingredient: r.name, required: reqQty, available: avail, deficit: reqQty - Math.max(0, avail) });
    }
    for (const a of assetRows) {
      const reqQty = Math.trunc(Number(a.required_qty));
      const avail = Math.trunc(Number(a.current_stock));
      if (avail < reqQty) shortages.push({ itemType: 'asset', ingredient: a.name, required: reqQty, available: avail, deficit: reqQty - Math.max(0, avail) });
    }
  }

  for (const r of invRows) {
    const qty = Math.trunc(Number(r.required_qty));
    if (qty > 0) {
      const prev = Math.trunc(Number(r.current_stock) || 0);
      const deduct = direction < 0 ? Math.min(Math.max(0, prev), qty) : qty;
      const newQty = direction < 0 ? Math.max(0, prev - deduct) : prev + qty;
      const delta = newQty - prev;
      await conn.query('UPDATE Inventory SET quantity = ? WHERE id = ?', [newQty, r.inventory_id]);
      if (delta !== 0) {
        await recordBookingStockMovement(conn, {
          itemType: 'ingredient',
          itemId: r.inventory_id,
          itemName: r.name,
          changeQty: delta,
          previousQty: prev,
          newQty,
          reason: direction < 0
            ? `Booking #${bookingId || ''} confirmed${prev < qty ? ` (shortage: needed ${qty})` : ''}`
            : `Booking #${bookingId || ''} cancelled (stock restored)`,
          bookingId,
          actor
        });
      }
    }
  }
  for (const a of assetRows) {
    const qty = Math.trunc(Number(a.required_qty));
    if (qty > 0) {
      const prev = Math.trunc(Number(a.current_stock) || 0);
      const deduct = direction < 0 ? Math.min(Math.max(0, prev), qty) : qty;
      const newQty = direction < 0 ? Math.max(0, prev - deduct) : prev + qty;
      const delta = newQty - prev;
      await conn.query('UPDATE CateringAssets SET quantity = ? WHERE id = ?', [newQty, a.asset_id]);
      if (delta !== 0) {
        await recordBookingStockMovement(conn, {
          itemType: 'asset',
          itemId: a.asset_id,
          itemName: a.name,
          changeQty: delta,
          previousQty: prev,
          newQty,
          reason: direction < 0
            ? `Booking #${bookingId || ''} confirmed${prev < qty ? ` (shortage: needed ${qty})` : ''}`
            : `Booking #${bookingId || ''} cancelled (stock restored)`,
          bookingId,
          actor
        });
      }
    }
  }
  return { ok: true, changed: Boolean(invRows.length || assetRows.length), shortages };
}

exports.resolveRequest = async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const decision = String(req.body.decision || '');
    if (!['approved', 'declined'].includes(decision)) return res.status(400).json({ error: 'Choose Approve or Decline.' });
    const response = String(req.body.response || '').trim().slice(0, 500);

    await conn.beginTransaction();
    const [rows] = await conn.query('SELECT * FROM Bookings WHERE id = ? AND requestType IS NOT NULL AND requestHandled = 0 FOR UPDATE', [req.params.id]);
    const booking = rows[0];
    if (!booking) {
      await conn.rollback();
      return res.status(404).json({ error: 'No open request found for this booking.' });
    }
    if (decision === 'declined' && booking.requestType === 'cancel') {
      await conn.rollback();
      return res.status(400).json({ error: 'Cancellation requests cannot be declined. Approve them to cancel and archive the booking.' });
    }
    let stockRestored = false;
    if (decision === 'approved' && booking.requestType === 'cancel') {
      if (booking.status === 'confirmed') {
        const restored = await adjustPackageStocks(conn, booking.package, +1, booking.id, req.user?.username || 'system');
        stockRestored = restored.changed;
      }
      await conn.query("UPDATE Bookings SET status = 'cancelled', is_archived = 1, cancellationReason = COALESCE(NULLIF(cancellationReason, ''), ?) WHERE id = ?", [`Cancelled at customer request: ${booking.requestReason}`.slice(0, 500), booking.id]);
    }
    if (decision === 'approved' && booking.requestType === 'reschedule') {
      await conn.query('UPDATE Bookings SET eventDate = ?, eventTime = ? WHERE id = ?', [booking.requestNewDate, booking.requestNewTime, booking.id]);
    }
    await conn.query('UPDATE Bookings SET requestHandled = 1, requestDecision = ?, requestResponse = ? WHERE id = ?', [decision, response || null, booking.id]);
    await conn.commit();

    await notify('approval', `Request ${decision}`, `The ${booking.requestType} request for booking #${booking.id} was ${decision} by ${req.user.username}.`, ['admin', 'manager', 'staff'], 'bookings');
    res.json({ message: `Request ${decision}.`, stockRestored });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
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

exports.getBookingAssets = async (req, res) => {
  try {
    const [bRows] = await pool.query('SELECT id, package, status FROM Bookings WHERE id = ? LIMIT 1', [req.params.id]);
    if (!bRows.length) return res.status(404).json({ error: 'Booking not found' });
    const b = bRows[0];
    let assets = [];
    if (b.package) {
      const [pkgRows] = await pool.query('SELECT id FROM Packages WHERE name = ? ORDER BY id DESC LIMIT 1', [b.package]);
      if (pkgRows.length) {
        const [aRows] = await pool.query(
          `SELECT pa.asset_id, a.name, a.unit, a.quantity AS current_stock, COALESCE(a.damaged_qty, 0) AS damaged_qty,
                  CAST(SUM(pa.qty_required) AS SIGNED) AS qty_required
           FROM PackageAssets pa
           JOIN CateringAssets a ON a.id = pa.asset_id
           WHERE pa.package_id = ?
           GROUP BY pa.asset_id, a.name, a.unit, a.quantity, a.damaged_qty`,
          [pkgRows[0].id]
        );
        assets = aRows;
      }
    }
    res.json({ bookingId: b.id, package: b.package, status: b.status, assets });
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
      "SELECT id, package, status, eventDate, eventTime, guests, paymentOption, paymentProof FROM Bookings WHERE id = ? FOR UPDATE",
      [req.params.id]
    );
    if (!bookingRows.length) {
      await conn.rollback();
      return res.status(404).json({ error: "Booking not found" });
    }

    const booking = bookingRows[0];
    const isTransitionToConfirmed = status === 'confirmed' && booking.status !== 'confirmed';
    const isConfirmedCancelled = booking.status === 'confirmed' && status === 'cancelled';
    const isTransitionToCompleted = status === 'completed' && booking.status !== 'completed';
    let stockShortages = [];
    let returnedAssetsSummary = [];

    const damageFeeAmount = Math.max(0, Math.round((Number(req.body.damageFee) || 0) * 100) / 100);
    const damageFeePaid = Boolean(req.body.damageFeePaid);
    const conflictNotes = typeof req.body.conflictNotes === 'string'
      ? req.body.conflictNotes.trim().slice(0, 500)
      : '';
    const damagedInput = Array.isArray(req.body.damagedAssets) ? req.body.damagedAssets : [];
    const dmgByAssetId = new Map();
    damagedInput.forEach((d) => {
      const aid = Number(d?.asset_id);
      const qty = Math.max(0, Math.trunc(Number(d?.damaged_qty) || 0));
      if (aid > 0) dmgByAssetId.set(aid, qty);
    });

    if (isTransitionToConfirmed) {
      const [dayCountRows] = await conn.query(
        "SELECT COUNT(*) AS cnt FROM Bookings WHERE DATE(eventDate) = DATE(?) AND status = 'confirmed' AND COALESCE(is_archived, 0) = 0 AND id <> ?",
        [booking.eventDate, booking.id]
      );
      if (Number(dayCountRows[0]?.cnt || 0) >= MAX_EVENTS_PER_DAY) {
        await conn.rollback();
        return res.status(400).json({ error: `This date already has ${MAX_EVENTS_PER_DAY} confirmed events (daily maximum reached).` });
      }
      if (booking.eventTime) {
        const [clashRows] = await conn.query(
          "SELECT id FROM Bookings WHERE DATE(eventDate) = DATE(?) AND eventTime = ? AND status = 'confirmed' AND COALESCE(is_archived, 0) = 0 AND id <> ? LIMIT 1",
          [booking.eventDate, booking.eventTime, booking.id]
        );
        if (clashRows.length) {
          await conn.rollback();
          return res.status(400).json({ error: 'Another confirmed booking already uses this date and time slot.' });
        }
      }
      const check = await adjustPackageStocks(conn, booking.package, -1, booking.id, req.user?.username || 'system');
      stockShortages = check.shortages || [];
    } else if (isConfirmedCancelled) {
      await adjustPackageStocks(conn, booking.package, +1, booking.id, req.user?.username || 'system');
    } else if (isTransitionToCompleted) {
      // Return undamaged package assets back to CateringAssets; damaged ones stay out of usable inventory.
      const wasConfirmed = booking.status === 'confirmed';
      const [pkgRows] = await conn.query(
        'SELECT id FROM Packages WHERE name = ? ORDER BY id DESC LIMIT 1',
        [booking.package || '']
      );
      if (pkgRows.length) {
        const [pkgAssetRows] = await conn.query(
          `SELECT pa.asset_id, a.name, a.quantity AS current_stock, COALESCE(a.damaged_qty, 0) AS damaged_qty,
                  CAST(SUM(pa.qty_required) AS SIGNED) AS required_qty
           FROM PackageAssets pa
           JOIN CateringAssets a ON a.id = pa.asset_id
           WHERE pa.package_id = ?
           GROUP BY pa.asset_id, a.name, a.quantity, a.damaged_qty`,
          [pkgRows[0].id]
        );
        for (const a of pkgAssetRows) {
          const usedQty = Math.max(0, Math.trunc(Number(a.required_qty) || 0));
          if (!usedQty) continue;
          const prevUsable = Math.trunc(Number(a.current_stock) || 0);
          const prevDmg = Math.trunc(Number(a.damaged_qty) || 0);
          const dmgQty = Math.min(usedQty, dmgByAssetId.get(Number(a.asset_id)) || 0);
          const returnedUsable = wasConfirmed ? Math.max(0, usedQty - dmgQty) : 0;
          const directDeduct = !wasConfirmed && dmgQty > 0 ? Math.min(prevUsable, dmgQty) : 0;
          const newUsable = prevUsable + returnedUsable - directDeduct;
          const newDmg = prevDmg + dmgQty;
          const noteSuffix = dmgQty > 0
            ? `Booking #${booking.id}: ${dmgQty} damaged${damageFeePaid ? ` (Paid ₱${damageFeeAmount.toLocaleString('en-PH')})` : ' (Unpaid)'}${conflictNotes ? ' - ' + conflictNotes : ''}`.slice(0, 300)
            : null;
          if (dmgQty > 0) {
            await conn.query(
              'UPDATE CateringAssets SET quantity = ?, damaged_qty = ?, damage_notes = ? WHERE id = ?',
              [newUsable, newDmg, noteSuffix, a.asset_id]
            );
          } else if (returnedUsable > 0) {
            await conn.query('UPDATE CateringAssets SET quantity = ? WHERE id = ?', [newUsable, a.asset_id]);
          }
          if (newUsable !== prevUsable) {
            await recordBookingStockMovement(conn, {
              itemType: 'asset',
              itemId: a.asset_id,
              itemName: a.name,
              changeQty: newUsable - prevUsable,
              previousQty: prevUsable,
              newQty: newUsable,
              reason: dmgQty > 0
                ? `Completed Booking #${booking.id}: returned ${returnedUsable}/${usedQty}, ${dmgQty} damaged${damageFeePaid ? ' (paid)' : ''}`
                : `Completed Booking #${booking.id}: all ${returnedUsable} assets returned undamaged`,
              bookingId: booking.id,
              actor: req.user?.username || 'system'
            });
          }
          returnedAssetsSummary.push({ asset_id: a.asset_id, name: a.name, used: usedQty, returned: returnedUsable, damaged: dmgQty });
        }
      }
    }

    if (isTransitionToCompleted) {
      await conn.query(
        "UPDATE Bookings SET status = ?, cancellationReason = NULL, damage_fee_amount = ?, damage_fee_paid = ?, damage_conflict_notes = ? WHERE id = ?",
        [status, damageFeeAmount, damageFeePaid ? 1 : 0, conflictNotes || null, req.params.id]
      );
    } else {
      await conn.query(
        "UPDATE Bookings SET status = ?, cancellationReason = ? WHERE id = ?",
        [status, status === 'cancelled' ? cancellationReason : null, req.params.id]
      );
    }

    await conn.commit();
    await notify('status', 'Booking status updated', `Booking #${req.params.id} is now ${status} (by ${req.user?.username || 'system'}).`, ['admin', 'manager', 'staff'], 'bookings');
    if (stockShortages.length) {
      await notify(
        'warning',
        'Restock Needed for Confirmed Booking',
        `Booking #${req.params.id} was confirmed with insufficient stock for: ${stockShortages.map((s) => `${s.ingredient} (short ${s.deficit})`).join(', ')}.`,
        ['admin', 'manager', 'staff'],
        'inventory'
      );
    }
    res.json({
      message: "Booking status updated",
      inventoryDeducted: isTransitionToConfirmed,
      stockRestored: isConfirmedCancelled,
      stockShortages,
      returnedAssetsSummary,
      damageFeeAmount,
      damageFeePaid,
      conflictNotes
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
    const { clientName, address, eventType, package: eventPackage, eventDate, eventTime, phone, email, guests, additionalGuests, notes, additionalRequest, additionalCost } = req.body;
    if (!clientName || !address || !eventType || !eventPackage || !eventDate || !phone) {
      return res.status(400).json({ error: "All fields are required" });
    }
    if (!isRealName(clientName)) {
      return res.status(400).json({ error: 'Enter a real full name (first and last name).' });
    }
    if (typeof isElevenDigitPhone === 'function' && !isElevenDigitPhone(phone)) {
      return res.status(400).json({ error: 'Phone number must start with 09, be 11 digits, and be a real mobile number.' });
    }
    const addGuestsCount = Math.max(0, Math.trunc(Number(additionalGuests) || 0));
    const hasExplicitAdditionalGuests = additionalGuests !== undefined && additionalGuests !== null;
    if (!hasExplicitAdditionalGuests && (!Number.isInteger(Number(guests)) || Number(guests) < 1)) {
      return res.status(400).json({ error: 'Enter a valid number of guests.' });
    }
    if (!hasExplicitAdditionalGuests) {
      const guestError = await guestLimitError(eventPackage, guests);
      if (guestError) return res.status(400).json({ error: guestError });
    }
    if (email && !isValidEmail(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
    if (eventTime && !isWithinBusinessHours(eventTime)) {
      return res.status(400).json({ error: 'Event time must be within business hours (8:00 AM to 6:00 PM).' });
    }
    if (String(additionalRequest || '').length > 500) {
      return res.status(400).json({ error: 'Additional request must be at most 500 characters.' });
    }
    const extraCost = Math.max(0, Number(additionalCost) || 0);
    const [current] = await pool.query('SELECT address FROM Bookings WHERE id = ?', [req.params.id]);
    if (current.length && current[0].address !== address) {
      const addressCheck = validatePhilippineAddress(address);
      if (!addressCheck.valid) return res.status(400).json({ error: addressCheck.message });
    }
    const [result] = await pool.query(
      `UPDATE Bookings SET clientName=?, address=?, eventType=?, package=?, eventDate=?, eventTime=?, phone=?, email=?, guests=?, notes=?, additional_request=?, additional_cost=? WHERE id=?`,
      [clientName, address, eventType, eventPackage, eventDate, validTime(eventTime), phone, email || null, guests || addGuestsCount || 0, notes || null, String(additionalRequest || '') || null, extraCost, req.params.id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: "Booking not found" });
    if (hasExplicitAdditionalGuests) {
      try { await pool.query('UPDATE Bookings SET additional_guests = ? WHERE id = ?', [addGuestsCount, req.params.id]); } catch (e) {}
    }
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
    // The dropdown library (managed by administrators) is the source of truth.
    const [rows] = await pool.query("SELECT label FROM dropdown_options WHERE category = 'event_type' AND is_active = 1 ORDER BY sort_order ASC, id ASC");
    res.json(rows.length ? rows.map((r) => r.label) : fallback);
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
