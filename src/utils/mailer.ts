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

export const sendEmail = async (to: string[], subject: string, text: string, html?: string) => {
  try {
    const info = await transporter.sendMail({
      from: `"${process.env.SMTP_FROM_NAME || 'CodeJude Football'}" <${process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER}>`,
      to: to.join(', '),
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
