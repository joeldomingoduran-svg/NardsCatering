const pool = require('../Model/db');

const peso = (n) => '\u20b1' + Number(n).toLocaleString('en-PH');
const MONTHS = 'january february march april may june july august september october november december'.split(' ');
const STATUS_TEXT = { pending: 'Pending', confirmed: 'Confirmed', completed: 'Completed', cancelled: 'Cancelled' };

const CONTACT_EMAIL = 'nardscatering@gmail.com';
const CONTACT_PHONE = process.env.CONTACT_PHONE || '+63 XXX XXX XXXX';

const SUGGESTIONS = ['Packages and prices', 'How do I book?', 'Payment methods', 'Check my booking', 'Is a date available?'];
const CONTACT_REPLY = 'Thank you for reaching out. I am unable to confidently answer that question here. Please visit our Contact section for our contact details, or email our team directly at nardscatering@gmail.com. We will be happy to assist you.';

function contactResponse(reply = CONTACT_REPLY) {
  return { reply, contact: true };
}

function parseDate(text) {
  const iso = text.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  const named = text.toLowerCase().match(new RegExp(`\\b(${MONTHS.join('|')})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s*(\\d{4}))?`));
  if (named) {
    const now = new Date();
    let year = named[3] ? Number(named[3]) : now.getFullYear();
    const month = MONTHS.indexOf(named[1]) + 1;
    const day = Number(named[2]);
    const build = (y) => `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (!named[3] && new Date(build(year) + 'T00:00:00') < now) year += 1;
    return build(year);
  }
  return null;
}

async function loadPackages() {
  const [pkgs] = await pool.query('SELECT id, name, price, min_guests FROM Packages WHERE is_archived = 0 ORDER BY price ASC');
  const [dishes] = await pool.query(
    `SELECT pd.package_id, d.name, d.category FROM PackageDishes pd JOIN Dishes d ON d.id = pd.dish_id WHERE d.is_archived = 0 ORDER BY d.category, d.name`
  );
  const [freebies] = await pool.query('SELECT package_id, name FROM PackageFreebies');
  return pkgs.map((p) => ({
    ...p,
    dishes: dishes.filter((d) => d.package_id === p.id),
    freebies: freebies.filter((f) => f.package_id === p.id).map((f) => f.name)
  }));
}

function describePackage(p) {
  const lines = [`${p.name} - ${peso(p.price)}${p.min_guests ? ` (minimum ${p.min_guests} guests)` : ''}`];
  if (p.dishes.length) lines.push('Menu: ' + p.dishes.map((d) => d.name).join(', '));
  if (p.freebies.length) lines.push('Freebies: ' + p.freebies.join(', '));
  return lines.join('\n');
}

async function answer(message, email) {
  const text = String(message || '').toLowerCase().trim();
  const has = (...words) => words.some((w) => text.includes(w));

  if (!text) return { reply: 'Hi! I am the Nard\'s Catering assistant. How can I help you?' };

  if (has('my booking', 'booking status', 'my reservation', 'check my', 'status of')) {
    if (!email) return { reply: 'Please log in with your Gmail account so I can look up your bookings.', suggestions: ['How do I book?'] };
    const [rows] = await pool.query(
      `SELECT id, eventType, package, eventDate, status, paymentOption, paymentProof, amountDue, requestType, requestHandled, requestDecision,
              GREATEST(TIMESTAMPDIFF(SECOND, NOW(), paymentDeadline), 0) AS secondsLeft
       FROM Bookings WHERE LOWER(email) = ? AND is_archived = 0 ORDER BY id DESC LIMIT 5`,
      [email.toLowerCase()]
    );
    if (!rows.length) return { reply: 'You have no bookings yet. Fill in the booking form on this page to send your first request.', suggestions: ['How do I book?'] };
    const lines = rows.map((b) => {
      const req = b.requestType ? ` - ${b.requestType} request ${b.requestHandled ? (b.requestDecision || 'handled') : 'waiting for staff'}` : '';
      let pay = '';
      if (b.status === 'pending' && b.paymentOption) {
        if (b.paymentProof) pay = ' - PAID (receipt received), staff is reviewing it';
        else if (b.secondsLeft > 0) pay = ` - please pay ${peso(b.amountDue)} via GCash, ${Math.ceil(b.secondsLeft / 3600)}h left`;
      }
      return `#${b.id} ${b.eventType} (${b.package}) on ${String(b.eventDate).split('T')[0]}: ${STATUS_TEXT[b.status] || b.status}${pay}${req}`;
    });
    return { reply: 'Your latest bookings:\n' + lines.join('\n') };
  }

  if (has('available', 'availability', 'vacant', 'free date', 'open date') || (parseDate(text) && has('date', 'book', 'on '))) {
    const date = parseDate(text);
    if (!date) return { reply: 'Which date? Please type it like 2026-12-25 or December 25, 2026.' };
    const min = new Date();
    min.setDate(min.getDate() + 4);
    const minStr = `${min.getFullYear()}-${String(min.getMonth() + 1).padStart(2, '0')}-${String(min.getDate()).padStart(2, '0')}`;
    if (date < minStr) return { reply: `Bookings need at least 3 full days notice. The earliest date you can book is ${minStr}.` };
    const [[row]] = await pool.query(
      "SELECT COUNT(*) AS n FROM Bookings WHERE DATE(eventDate) = ? AND status IN ('pending','confirmed') AND is_archived = 0",
      [date]
    );
    return {
      reply: row.n
        ? `${date} already has ${row.n} reservation${row.n > 1 ? 's' : ''}. You may still send a request and our staff will confirm availability.`
        : `${date} is open. You can book it using the form on this page.`
    };
  }

  if (has('package', 'price', 'how much', 'cost', 'rate', 'menu', 'dish', 'food', 'freebie', 'inclusion', 'promo')) {
    const pkgs = await loadPackages();
    if (!pkgs.length) return { reply: 'Our packages are being updated. Please check back soon.' };
    const named = pkgs.filter((p) => text.includes(p.name.toLowerCase()));
    if (named.length) return { reply: named.map(describePackage).join('\n\n'), suggestions: ['How do I book?', 'Payment methods'] };
    return {
      reply: 'Our packages:\n' + pkgs.map((p) => `- ${p.name}: ${peso(p.price)}${p.min_guests ? ` (min. ${p.min_guests} guests)` : ''}`).join('\n') + '\n\nAsk about a package by name to see its menu and freebies.',
      suggestions: pkgs.slice(0, 3).map((p) => p.name)
    };
  }

  if (has('cancel', 'refund', 'expire', 'resched', 'postpone', 'move my', 'change date', 'change my date')) {
    return {
      reply: 'You can send a cancel or reschedule request from "My Bookings" with a valid note (at least 20 characters). Reschedules need a new date and time that follows the 3-day rule (e.g. today Oct 10 -> earliest Oct 14).\n\nYour note goes to our Staff and Manager. A cancellation, once approved, is cancelled and moved to the booking archive. A reschedule can be approved or declined. You are notified of every update in your bell icon.\n\nRefund policy: the 20% down payment is non-refundable; for a full payment, 80% is refundable.\n\nFor a faster update, contact Nard\'s Catering: ' + CONTACT_EMAIL + ' or ' + CONTACT_PHONE + '.',
      suggestions: ['Check my booking', 'Payment methods']
    };
  }

  if (has('pay', 'gcash', 'down payment', 'downpayment', 'deposit', 'proof', 'reference', 'receipt', '24')) {
    return {
      reply: 'Payment is through GCash. You can choose Full payment or a 20% Down payment, and the GCash QR is shown on the booking form (use "Show QR code").\n\nUpload your receipt (a screenshot or photo of your GCash payment) in the Payment part of the booking form, or later inside My Bookings on your pending booking. Our Staff and Manager see it in their bookings list, and your booking is marked PAID (green) once the receipt is received, or UNPAID (red) while it is missing.\n\nPayment is not required to send your booking. It goes to our staff right away with status PENDING. Please settle the payment within 24 hours so staff can confirm it; unpaid bookings are cancelled after 24 hours.',
      suggestions: ['Check my booking', 'How do I book?']
    };
  }

  if (has('book', 'reserve', 'reservation', 'how to', 'steps', 'process')) {
    return {
      reply: '1. Log in with your Gmail account.\n2. Fill in the booking form: name, venue address (must be in the Philippines), phone, event type, package and date (at least 3 full days ahead).\n3. Choose Full or Down payment (20%).\n4. Submit. Your booking goes to our staff as PENDING.\n5. Pay via the GCash QR within 24 hours.\n6. Staff confirms the booking once the payment is settled.',
      suggestions: ['Payment methods', 'Packages and prices']
    };
  }

  if (has('address', 'venue', 'location', 'where', 'area', 'deliver')) {
    return { reply: 'We cater events within the Philippines. Enter a complete venue address, e.g. "123 Rizal St., Brgy. San Jose, Quezon City". Invalid or non-Philippine addresses are not accepted.' };
  }


  if (has('notice', 'advance', 'how soon', 'earliest', 'lead')) {
    return { reply: 'Bookings need at least 3 full days notice before the event date.' };
  }

  if (has('event', 'wedding', 'birthday', 'christening', 'debut', 'blessing')) {
    const [rows] = await pool.query("SELECT DISTINCT eventType FROM Bookings WHERE eventType IS NOT NULL AND eventType != '' LIMIT 12");
    const types = ['Christening', 'Birthday Party', 'Wedding', 'Party', 'House Blessing'];
    rows.forEach((r) => { if (!types.some((t) => t.toLowerCase() === r.eventType.toLowerCase())) types.push(r.eventType); });
    return { reply: 'We cater events such as: ' + types.join(', ') + '.' };
  }

  if (has('login', 'log in', 'sign up', 'signup', 'register', 'otp', 'verify', 'password', 'account')) {
    return { reply: 'Sign up with a Gmail address and verify it with the 6-digit code we email you. If you forgot your password, use "Forgot password" on the login page to receive a reset code.' };
  }

  if (has('contact', 'call', 'phone', 'staff', 'human', 'talk to')) {
    return contactResponse('Our team will be happy to assist you. Please visit our Contact section for available contact details, or email us at nardscatering@gmail.com.');
  }

  if (/^(hi|hello|hey|good (morning|afternoon|evening)|kumusta)/.test(text)) {
    return { reply: 'Hello! Welcome to Nard\'s Catering. I can help with packages, booking steps, payment and your booking status.', suggestions: SUGGESTIONS };
  }

  if (has('thank', 'salamat')) return { reply: 'You are welcome! Let me know if you need anything else.' };

  return { ...contactResponse(), suggestions: SUGGESTIONS };
}

exports.chat = async (req, res) => {
  try {
    const message = String(req.body?.message || '').slice(0, 300);
    const email = String(req.body?.email || '').trim().slice(0, 255);
    res.json(await answer(message, email));
  } catch (err) {
    res.status(500).json(contactResponse('I am sorry, but I cannot respond right now. Please visit our Contact section or email our team at nardscatering@gmail.com for assistance.'));
  }
};
