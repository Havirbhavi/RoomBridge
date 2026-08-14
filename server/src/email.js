import nodemailer from "nodemailer";

const smtpConfigured = Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASSWORD);

const transporter = smtpConfigured
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === "true",
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD
      }
    })
  : null;

export async function sendUniversityVerificationEmail({ email, name, code }) {
  if (!transporter) return { delivered: false, provider: "development-preview" };

  await transporter.sendMail({
    from: process.env.EMAIL_FROM || "RoomBridge <verify@roombridge.example>",
    to: email,
    subject: "Verify your RoomBridge university email",
    text: `Hi ${name}, your RoomBridge verification code is ${code}. It expires in 15 minutes.`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:24px">
        <h1 style="font-size:24px">Verify your university email</h1>
        <p>Hi ${name}, enter this code in RoomBridge. It expires in 15 minutes.</p>
        <p style="font-size:30px;font-weight:800;letter-spacing:8px">${code}</p>
        <p>If you did not create this account, you can ignore this message.</p>
      </div>
    `
  });
  return { delivered: true, provider: "smtp" };
}
