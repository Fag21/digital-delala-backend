const nodemailer = require("nodemailer");
require("dotenv").config();

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  secure: false,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

async function sendPaymentNotificationToAdmin({ userName, userEmail, plan, amount, bank, screenshotUrl }) {
  await transporter.sendMail({
    from:    `"Digital Delala" <${process.env.SMTP_USER}>`,
    to:      process.env.ADMIN_EMAIL,
    subject: `[Delala] አዲስ ክፍያ ደረሰኝ — ${userName}`,
    html: `<div style="font-family:sans-serif">
      <h2 style="color:#0f6c45">አዲስ ክፍያ ለፍቃድ ቀርቧል</h2>
      <p><b>ተጠቃሚ:</b> ${userName} (${userEmail})</p>
      <p><b>እቅድ:</b> ${plan === 'yearly' ? 'ዓመታዊ' : 'ወርሃዊ'} — ${amount} ብር</p>
      <p><b>ባንክ:</b> ${bank}</p>
      <img src="${screenshotUrl}" style="max-width:400px;border-radius:8px" />
      <p>ወደ Admin Dashboard ይሂዱ።</p>
    </div>`,
  });
}

async function sendApprovalEmail({ toEmail, toName, plan, amount }) {
  await transporter.sendMail({
    from:    `"Digital Delala" <${process.env.SMTP_USER}>`,
    to:      toEmail,
    subject: `[Delala] ፕሪሚየም ፍቃድ ተሰጥቷል! ✅`,
    html: `<div style="font-family:sans-serif">
      <h2 style="color:#0f6c45">ፕሪሚየም ተሰጥቷል! 🎉</h2>
      <p>ሰላም <b>${toName}</b>! ክፍያዎ ፀድቋል።</p>
      <p>የ${amount} ብር ${plan === 'yearly' ? 'ዓመታዊ' : 'ወርሃዊ'} ፕሪሚየም አለዎት።</p>
    </div>`,
  });
}

async function sendRejectionEmail({ toEmail, toName, reason }) {
  await transporter.sendMail({
    from:    `"Digital Delala" <${process.env.SMTP_USER}>`,
    to:      toEmail,
    subject: `[Delala] ክፍያ ደረሰኝ ተሰርዟል`,
    html: `<div style="font-family:sans-serif">
      <h2 style="color:#dc2626">ክፍያ ተሰርዟል</h2>
      <p>ሰላም <b>${toName}</b>. ክፍያ ደረሰኝዎ አልተቀበለም።</p>
      <p><b>ምክንያት:</b> ${reason || 'ደረሰኝ ግልጽ አይደለም'}</p>
      <p>እባክዎ ግልጽ ስክሪንሾት ጨምረው ዳግም ሞክሩ።</p>
    </div>`,
  });
}

async function sendOtpEmail({ toEmail, toName, code }) {
  await transporter.sendMail({
    from:    `"Digital Delala" <${process.env.SMTP_USER}>`,
    to:      toEmail,
    subject: `[Delala] የማረጋገጫ ኮድ / Your verification code: ${code}`,
    html: `<div style="font-family:sans-serif;max-width:420px">
      <h2 style="color:#0f6c45">ኢሜይልዎን ያረጋግጡ / Verify your email</h2>
      <p>ሰላም <b>${toName || ''}</b>! የማረጋገጫ ኮድዎ ይኸውና።</p>
      <p>Hello <b>${toName || ''}</b>! Use the code below to verify your email.</p>
      <div style="font-size:32px;font-weight:800;letter-spacing:8px;color:#0f6c45;background:#f0f7f3;border-radius:12px;padding:16px;text-align:center;margin:18px 0">${code}</div>
      <p style="color:#666;font-size:13px">ይህ ኮድ በ10 ደቂቃ ውስጥ ጊዜው ያልፋል። / This code expires in 10 minutes. If you didn't request it, ignore this email.</p>
    </div>`,
  });
}

async function sendHelpTicket({ name, email, type, message }) {
  await transporter.sendMail({
    from: `"Digital Delala" <${process.env.SMTP_USER}>`,
    to:   process.env.SUPPORT_EMAIL,
    replyTo: email,
    subject: `[Delala] ${type === 'report' ? '⚠️ ችግር' : '💬 ጥያቄ'} — ${name}`,
    html: `<div style="font-family:sans-serif">
      <h2>${type === 'report' ? 'ችግር ሪፖርት' : 'ጥያቄ'}</h2>
      <p><b>ስም:</b> ${name} | <b>ኢሜይል:</b> ${email}</p>
      <p style="white-space:pre-wrap">${message}</p>
    </div>`,
  });
}

module.exports = { sendPaymentNotificationToAdmin, sendApprovalEmail, sendRejectionEmail, sendHelpTicket, sendOtpEmail };