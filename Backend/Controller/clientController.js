const crypto = require('crypto');
const pool = require('../Model/db');
const { sendCodeEmail } = require('../Model/mailer');
const { writeAudit } = require('../Model/audit');
const { isRealName, isElevenDigitPhone } = require('../Model/validators');

const CODE_TTL_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_ATTEMPTS = 3;
const NAME_PART = /^[A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u00FF][A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u00FF'\- ]*$/;
const cleanPart = (v) => String(v || '').trim().replace(/\s+/g, ' ');

const makeCode = () => String(crypto.randomInt(0, 1000000)).padStart(6, '0');
const hashCode = (code) => crypto.createHash('sha256').update(String(code)).digest('hex');
const codesMatch = (code, hash) => {
  const a = Buffer.from(hashCode(code), 'hex');
  const b = Buffer.from(hash || '', 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

const MAX_CODES = 3;
const LIMIT_MESSAGE = 'You have reached the limit of 3 verification codes. Please try signing up or using Forgot Password again after 24 hours.';

class LimitError extends Error {}

// Counts codes sent in a rolling 24 hour window; throws once 3 have been used.
async function takeCodeQuota(clientId, kind) {
  const count = kind + 'SendCount';
  const start = kind + 'WindowStart';
  const [[row]] = await pool.query(
    `SELECT ${count} AS n, TIMESTAMPDIFF(SECOND, ${start}, NOW()) AS age FROM Clients WHERE id = ?`, [clientId]
  );
  const fresh = row.age === null || row.age >= 24 * 3600;
  if (!fresh && row.n >= MAX_CODES) throw new LimitError(LIMIT_MESSAGE);
  await pool.query(
    fresh ? `UPDATE Clients SET ${count} = 1, ${start} = NOW() WHERE id = ?` : `UPDATE Clients SET ${count} = ${count} + 1 WHERE id = ?`,
    [clientId]
  );
}

async function codesLeft(clientId, kind) {
  const [[row]] = await pool.query(
    `SELECT ${kind}SendCount AS n, TIMESTAMPDIFF(SECOND, ${kind}WindowStart, NOW()) AS age FROM Clients WHERE id = ?`, [clientId]
  );
  return row.age === null || row.age >= 24 * 3600 ? MAX_CODES : Math.max(0, MAX_CODES - row.n);
}

async function issueOtp(clientId, email, name) {
  await takeCodeQuota(clientId, 'otp');
  const code = makeCode();
  await pool.query(
    "UPDATE Clients SET otpHash = ?, otpExpires = ?, otpAttempts = 0, otpSentAt = NOW() WHERE id = ?",
    [hashCode(code), new Date(Date.now() + CODE_TTL_MS), clientId]
  );
  await sendCodeEmail(email, 'Verify your Nards Catering account', `Hi ${String(name).replace(/[<>&"]/g, '')}, verify your email`, code);
}

const isGmail = (value) => /^[^\s@]+@gmail\.com$/i.test((value || '').trim());
const isStrongPassword = (value) => typeof value === 'string' && value.length >= 8 && /[^A-Za-z0-9]/.test(value);
const isValidContact = (value) => isElevenDigitPhone(value);

exports.getAllClients = async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT id, name, contact, email FROM Clients ORDER BY id DESC");
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.signupClient = async (req, res) => {
  try {
    const { contact, email, password } = req.body;
    const firstName = cleanPart(req.body.firstName);
    const lastName = cleanPart(req.body.lastName);
    if (!NAME_PART.test(firstName) || !NAME_PART.test(lastName)) {
      return res.status(400).json({ error: 'First name and last name must contain letters only (no numbers).' });
    }
    const name = firstName + ' ' + lastName;
    if (!isRealName(name)) {
      return res.status(400).json({ error: 'Please enter your real first and last name.' });
    }
    if (!email || !isGmail(email)) {
      return res.status(400).json({ error: 'Please use a valid Gmail address for your account.' });
    }
    if (!isStrongPassword(password)) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long and include a special character.' });
    }
    if (!isValidContact(contact)) {
      return res.status(400).json({ error: 'Contact number must be exactly 11 digits (e.g. 09171234567).' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const [existing] = await pool.query("SELECT id, isVerified FROM Clients WHERE LOWER(email) = ? LIMIT 1", [normalizedEmail]);
    if (existing.length > 0 && existing[0].isVerified) {
      return res.status(409).json({ error: 'This Gmail account is already registered.' });
    }

    const safeContact = contact.trim();
    let clientId;
    const isRetry = existing.length > 0;
    if (isRetry) {
      // An earlier sign-up was never verified; refresh its details and send a new code.
      clientId = existing[0].id;
      await pool.query("UPDATE Clients SET name = ?, contact = ?, password = ? WHERE id = ?", [name.trim(), safeContact, password, clientId]);
    } else {
      const [result] = await pool.query(
        "INSERT INTO Clients (name, contact, email, password, isVerified) VALUES (?, ?, ?, ?, 0)",
        [name.trim(), safeContact, normalizedEmail, password]
      );
      clientId = result.insertId;
    }

    try {
      await issueOtp(clientId, normalizedEmail, name.trim());
    } catch (mailErr) {
      if (mailErr instanceof LimitError) {
        return res.status(429).json({ error: mailErr.message, limitReached: true });
      }
      console.error('OTP email failed:', mailErr.message);
      if (!isRetry) await pool.query("DELETE FROM Clients WHERE id = ?", [clientId]);
      return res.status(502).json({ error: 'Could not send the verification email. Please try again later.' });
    }

    res.status(201).json({
      message: 'Account created. A 6-digit code was sent to your Gmail.',
      codesLeft: await codesLeft(clientId, 'otp'),
      requiresOtp: true,
      email: normalizedEmail
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.loginClient = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const [rows] = await pool.query(
      "SELECT id, name, contact, email, password, isVerified FROM Clients WHERE LOWER(email) = ? LIMIT 1",
      [normalizedEmail]
    );

    if (!rows.length || rows[0].password !== password) {
      return res.status(401).json({ error: 'Invalid Gmail or password.' });
    }
    if (!rows[0].isVerified) {
      return res.status(403).json({ error: 'Please verify your Gmail with the code we sent.', requiresOtp: true, email: normalizedEmail });
    }

    const client = rows[0];
    const safeClient = { id: client.id, name: client.name, contact: client.contact, email: client.email };
    await writeAudit({ username: client.email, role: 'customer' }, 'Logged in', 'session', client.id, null);
    res.json({ message: 'Login successful.', client: safeClient });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.verifyOtp = async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const code = String(req.body.code || '').trim();
    if (!isGmail(email) || !/^\d{6}$/.test(code)) {
      return res.status(400).json({ error: 'Enter the 6-digit code.' });
    }
    const [rows] = await pool.query(
      "SELECT id, name, contact, email, isVerified, otpHash, otpExpires, otpAttempts FROM Clients WHERE LOWER(email) = ? LIMIT 1",
      [email]
    );
    const c = rows[0];
    if (!c || !c.otpHash) return res.status(400).json({ error: 'Invalid or expired code.' });
    if (c.isVerified) return res.status(400).json({ error: 'Account already verified. Please log in.' });
    if (c.otpAttempts >= MAX_ATTEMPTS || new Date(c.otpExpires) < new Date()) {
      if (await codesLeft(c.id, 'otp') === 0) return res.status(429).json({ error: LIMIT_MESSAGE, limitReached: true });
      return res.status(400).json({ error: 'Code expired or too many attempts (3 max). Please request a new one.' });
    }
    if (!codesMatch(code, c.otpHash)) {
      await pool.query("UPDATE Clients SET otpAttempts = otpAttempts + 1 WHERE id = ?", [c.id]);
      const left = MAX_ATTEMPTS - (c.otpAttempts + 1);
      if (left <= 0 && await codesLeft(c.id, 'otp') === 0) return res.status(429).json({ error: LIMIT_MESSAGE, limitReached: true });
      return res.status(400).json({ error: left > 0 ? `Incorrect code. ${left} attempt${left === 1 ? '' : 's'} left.` : 'Incorrect code. Too many attempts, please request a new code.' });
    }
    await pool.query("UPDATE Clients SET isVerified = 1, otpHash = NULL, otpExpires = NULL, otpAttempts = 0 WHERE id = ?", [c.id]);
    await writeAudit({ username: c.email, role: 'customer' }, 'Customer account verified', 'clients', c.id, null);
    res.json({ message: 'Email verified.', client: { id: c.id, name: c.name, contact: c.contact, email: c.email } });
  } catch (err) {
    res.status(500).json({ error: 'Verification failed.' });
  }
};

exports.resendOtp = async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const [rows] = await pool.query(
      "SELECT id, name, isVerified, otpSentAt FROM Clients WHERE LOWER(email) = ? LIMIT 1", [email]
    );
    const c = rows[0];
    const generic = { message: 'If the account exists and is unverified, a new code was sent.' };
    if (!c || c.isVerified) return res.json(generic);
    if (c.otpSentAt && Date.now() - new Date(c.otpSentAt).getTime() < RESEND_COOLDOWN_MS) {
      return res.status(429).json({ error: 'Please wait a minute before requesting another code.' });
    }
    await issueOtp(c.id, email, c.name);
    res.json({ ...generic, codesLeft: await codesLeft(c.id, 'otp') });
  } catch (err) {
    if (err instanceof LimitError) return res.status(429).json({ error: err.message, limitReached: true });
    console.error('Resend OTP failed:', err.message);
    res.status(502).json({ error: 'Could not send the email. Please try again later.' });
  }
};

exports.forgotPassword = async (req, res) => {
  const generic = { message: 'If that Gmail is registered, a reset code was sent.' };
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!isGmail(email)) return res.status(400).json({ error: 'Enter a valid Gmail address.' });
    const [rows] = await pool.query(
      "SELECT id, otpSentAt, resetExpires FROM Clients WHERE LOWER(email) = ? LIMIT 1", [email]
    );
    const c = rows[0];
    if (!c) return res.json(generic);
    // resetExpires - TTL gives the time the last code was issued.
    if (c.resetExpires && new Date(c.resetExpires).getTime() - CODE_TTL_MS > Date.now() - RESEND_COOLDOWN_MS) {
      return res.status(429).json({ error: 'Please wait a minute before requesting another code.' });
    }
    await takeCodeQuota(c.id, 'reset');
    const code = makeCode();
    await pool.query(
      "UPDATE Clients SET resetHash = ?, resetExpires = ?, resetAttempts = 0 WHERE id = ?",
      [hashCode(code), new Date(Date.now() + CODE_TTL_MS), c.id]
    );
    await sendCodeEmail(email, 'Reset your Nards Catering password', 'Password reset request', code);
    res.json({ ...generic, codesLeft: await codesLeft(c.id, 'reset') });
  } catch (err) {
    if (err instanceof LimitError) return res.status(429).json({ error: err.message, limitReached: true });
    console.error('Reset email failed:', err.message);
    res.status(502).json({ error: 'Could not send the email. Please try again later.' });
  }
};

exports.resetPassword = async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const code = String(req.body.code || '').trim();
    const { newPassword } = req.body;
    if (!isGmail(email) || !/^\d{6}$/.test(code)) {
      return res.status(400).json({ error: 'Enter the 6-digit code.' });
    }
    if (!isStrongPassword(newPassword)) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long and include a special character.' });
    }
    const [rows] = await pool.query(
      "SELECT id, password, resetHash, resetExpires, resetAttempts FROM Clients WHERE LOWER(email) = ? LIMIT 1", [email]
    );
    const c = rows[0];
    if (!c || !c.resetHash || c.resetAttempts >= MAX_ATTEMPTS || new Date(c.resetExpires) < new Date()) {
      if (c && c.resetAttempts >= MAX_ATTEMPTS && await codesLeft(c.id, 'reset') === 0) {
        return res.status(429).json({ error: LIMIT_MESSAGE, limitReached: true });
      }
      return res.status(400).json({ error: 'Invalid or expired code.' });
    }
    if (!codesMatch(code, c.resetHash)) {
      await pool.query("UPDATE Clients SET resetAttempts = resetAttempts + 1 WHERE id = ?", [c.id]);
      const left = MAX_ATTEMPTS - (c.resetAttempts + 1);
      if (left <= 0 && await codesLeft(c.id, 'reset') === 0) return res.status(429).json({ error: LIMIT_MESSAGE, limitReached: true });
      return res.status(400).json({ error: left > 0 ? `Invalid code. ${left} attempt${left === 1 ? '' : 's'} left.` : 'Too many attempts. Please request a new code.' });
    }
    if (newPassword === c.password) {
      return res.status(400).json({ error: 'Your new password must be different from your old password.' });
    }
    // A successful reset proves control of the inbox, so the account is also verified.
    await pool.query(
      "UPDATE Clients SET password = ?, isVerified = 1, resetHash = NULL, resetExpires = NULL, resetAttempts = 0 WHERE id = ?",
      [newPassword, c.id]
    );
    res.json({ message: 'Password updated. You can now log in.' });
  } catch (err) {
    res.status(500).json({ error: 'Password reset failed.' });
  }
};

exports.createClient = async (req, res) => {
  try {
    const { name, contact, email, password } = req.body;
    if (!isRealName(name)) {
      return res.status(400).json({ error: 'Enter the client\'s real full name.' });
    }
    if (contact && !isValidContact(contact)) {
      return res.status(400).json({ error: 'Contact number must be exactly 11 digits.' });
    }
    if (!email || !isGmail(email)) {
      return res.status(400).json({ error: 'Use a valid Gmail address.' });
    }
    if (!isStrongPassword(password)) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long and include a special character.' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const [existing] = await pool.query("SELECT id FROM Clients WHERE LOWER(email) = ? LIMIT 1", [normalizedEmail]);
    if (existing.length > 0) {
      return res.status(409).json({ error: 'Email already registered.' });
    }

    const [result] = await pool.query(
      "INSERT INTO Clients (name, contact, email, password, isVerified) VALUES (?, ?, ?, ?, 1)",
      [name.trim(), contact || '+63 000 000 0000', normalizedEmail, password]
    );
    res.status(201).json({ message: 'Client created', clientId: result.insertId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getClientById = async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT id, name, contact, email FROM Clients WHERE id = ?", [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Client not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.updateClient = async (req, res) => {
  try {
    const { name, contact, email, password } = req.body;
    if (!isRealName(name)) return res.status(400).json({ error: 'Enter the client\'s real full name.' });
    if (contact && !isValidContact(contact)) return res.status(400).json({ error: 'Contact number must be exactly 11 digits.' });
    const updateValues = [name, contact, email];
    if (password) {
      updateValues.push(password);
    }
    const query = password
      ? "UPDATE Clients SET name=?, contact=?, email=?, password=? WHERE id=?"
      : "UPDATE Clients SET name=?, contact=?, email=? WHERE id=?";
    const params = password ? [...updateValues, req.params.id] : [...updateValues, req.params.id];
    const [result] = await pool.query(query, params);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Client not found' });
    res.json({ message: 'Client updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.deleteClient = async (req, res) => {
  try {
    const [result] = await pool.query("DELETE FROM Clients WHERE id=?", [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Client not found' });
    res.json({ message: 'Client deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
