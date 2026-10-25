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

exports.sendCodeEmail = async (to, subject, heading, code) => {
  await getTransporter().sendMail({
    from: `"Nards Catering" <${process.env.GMAIL_USER}>`,
    to,
    subject,
    text: `${heading}\n\nYour code is: ${code}\n\nIt expires in 10 minutes. If you did not request this, ignore this email.`,
    html: `<div style="font-family:Arial,sans-serif"><h2>${heading}</h2><p>Your code is:</p><p style="font-size:28px;font-weight:bold;letter-spacing:6px">${code}</p><p>It expires in 10 minutes. If you did not request this, ignore this email.</p></div>`
  });
};
