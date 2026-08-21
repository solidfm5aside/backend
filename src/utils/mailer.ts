import nodemailer from 'nodemailer';
import logger from './logger';

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'mail.privateemail.com',
  port: parseInt(process.env.SMTP_PORT || '465'),
  secure: process.env.SMTP_PORT === '465', // true for 465, false for other ports
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export const sendEmail = async (
  to: string[],
  subject: string,
  text: string,
  html?: string,
  options: { blindCopy?: boolean } = {}
) => {
  try {
    const fromAddress = `"${process.env.SMTP_FROM_NAME || 'SolidFM 5-Aside'}" <${process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER}>`;
    const info = await transporter.sendMail({
      from: fromAddress,
      to: options.blindCopy ? fromAddress : to.join(', '),
      bcc: options.blindCopy ? to.join(', ') : undefined,
      subject,
      text,
      html: html || text.replace(/\n/g, '<br>'),
    });

    logger.info(`Message sent: %s`, info.messageId);
    return info;
  } catch (error) {
    logger.error('Error sending email:', error);
    throw error;
  }
};
