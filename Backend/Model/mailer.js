const nodemailer = require('nodemailer');

let transporter;

function getTransporter() {
  if (!transporter) {
    if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
      throw new Error('Email is not configured. Set GMAIL_USER and GMAIL_APP_PASSWORD in .env.');
    }
    transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD }
    });
  }
  return transporter;
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

exports.sendCodeEmail = async (to, subject, heading, code) => {
  await getTransporter().sendMail({
    from: `"Nards Catering" <${process.env.GMAIL_USER}>`,
    to,
    subject,
    text: `${heading}\n\nYour code is: ${code}\n\nIt expires in 10 minutes. If you did not request this, ignore this email.`,
    html: `<div style="font-family:Arial,sans-serif"><h2>${heading}</h2><p>Your code is:</p><p style="font-size:28px;font-weight:bold;letter-spacing:6px">${code}</p><p>It expires in 10 minutes. If you did not request this, ignore this email.</p></div>`
  });
};

exports.sendBookingFollowUpEmail = async (to, details, otpCode) => {
  const payLine = details.paymentOption
    ? `${details.paymentOption === 'down' ? '20% Down Payment' : 'Full Payment'}${details.amountDue != null ? ` (₱${Number(details.amountDue).toLocaleString('en-PH')})` : ''}`
    : 'To be coordinated';
  const transportAmt = Number(details.transportFee || 0);
  const distKm = Number(details.distanceKm || 0);
  const transportLine = transportAmt > 0
    ? `₱${transportAmt.toLocaleString('en-PH')} (${distKm > 30 ? `${distKm} km from Cainta — ₱500 base (30 km) + ${Math.ceil(distKm - 30)} km × ₱40` : `${distKm ? distKm + ' km from Cainta — ' : ''}within 30 km Cainta base`})`
    : '₱500 (Cainta up to 30 km base)';
  const textBody = [
    `Nard's Catering & Setup — Booking Follow-Up Notification`,
    ``,
    `Dear ${details.clientName},`,
    `Thank you for submitting your reservation request with Nard's Catering & Setup.`,
    ``,
    `Follow-Up Verification Code (OTP): ${otpCode}`,
    `Booking Reference: DB-${details.bookingId}`,
    `Event Type: ${details.eventType}`,
    `Package: ${details.packageName}`,
    `Guests: ${details.guests || 0} pax`,
    `Event Date & Time: ${details.eventDate}${details.eventTime ? ' at ' + details.eventTime : ''}`,
    `Venue: ${details.address}`,
    `Transport Fee: ${transportLine}`,
    `Payment Option: ${payLine}`,
    `Status: Pending Verification`,
    ``,
    details.awaitingPayment
      ? `Reminder: Please settle your payment and upload your receipt within 24 hours through your customer dashboard so our team can verify and confirm your reservation.`
      : `Your payment receipt has been received and is currently under review by our team.`,
    ``,
    `Keep your Follow-Up OTP (${otpCode}) and Booking Reference (DB-${details.bookingId}) for quick follow-ups.`
  ].join('\n');

  const htmlBody = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#2c241b;border:1px solid #e6dccb;border-radius:10px;overflow:hidden">
      <div style="background:#3a2d1a;color:#f7f1e5;padding:18px 24px">
        <h2 style="margin:0;font-size:20px">Nard's Catering &amp; Setup</h2>
        <p style="margin:4px 0 0;font-size:13px;color:#e4c88b">Booking Follow-Up Notification &amp; Verification Code</p>
      </div>
      <div style="padding:22px 24px;background:#fff">
        <p style="margin-top:0">Dear <strong>${esc(details.clientName)}</strong>,</p>
        <p>Thank you for choosing Nard's Catering &amp; Setup. Below is your booking follow-up verification code along with a copy of your reservation details:</p>
        <div style="background:#fbf7ee;border:1px solid #d9c08a;border-radius:8px;padding:14px 18px;text-align:center;margin:16px 0">
          <div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#785517">Follow-Up OTP Code</div>
          <div style="font-size:30px;font-weight:700;letter-spacing:6px;color:#3a2d1a;margin-top:4px">${esc(otpCode)}</div>
          <div style="font-size:12px;color:#70685e;margin-top:4px">Reference: <strong>DB-${esc(details.bookingId)}</strong></div>
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:13px;margin:12px 0">
          <tr><td style="padding:6px 0;color:#70685e;width:38%">Event Type</td><td style="padding:6px 0"><strong>${esc(details.eventType)}</strong></td></tr>
          <tr><td style="padding:6px 0;color:#70685e">Package</td><td style="padding:6px 0"><strong>${esc(details.packageName)}</strong></td></tr>
          <tr><td style="padding:6px 0;color:#70685e">Guests</td><td style="padding:6px 0">${esc(details.guests || 0)} pax</td></tr>
          <tr><td style="padding:6px 0;color:#70685e">Date &amp; Time</td><td style="padding:6px 0">${esc(details.eventDate)}${details.eventTime ? ' at ' + esc(details.eventTime) : ''}</td></tr>
          <tr><td style="padding:6px 0;color:#70685e">Venue</td><td style="padding:6px 0">${esc(details.address)}</td></tr>
          <tr><td style="padding:6px 0;color:#70685e">Transport Fee</td><td style="padding:6px 0">${esc(transportLine)}</td></tr>
          <tr><td style="padding:6px 0;color:#70685e">Payment</td><td style="padding:6px 0">${esc(payLine)}</td></tr>
          <tr><td style="padding:6px 0;color:#70685e">Current Status</td><td style="padding:6px 0"><strong>Pending Verification</strong></td></tr>
        </table>
        <p style="font-size:13px;background:#f8f5ef;padding:10px 12px;border-radius:6px;margin:14px 0 0">
          ${details.awaitingPayment
            ? 'Please settle your payment and upload your GCash receipt in your Customer Dashboard within <strong>24 hours</strong> so our staff can verify and confirm your reservation.'
            : 'Your payment receipt is now queued for verification by our team. You will receive an update once your booking is confirmed.'}
        </p>
      </div>
    </div>`;

  await getTransporter().sendMail({
    from: `"Nards Catering" <${process.env.GMAIL_USER}>`,
    to,
    subject: `Nard's Catering — Booking Follow-Up & OTP (Ref: DB-${details.bookingId})`,
    text: textBody,
    html: htmlBody
  });
};
