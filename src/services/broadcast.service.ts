import Team from '@/models/team.model';
import { sendEmail } from '@/utils/mailer';
import logger from '@/utils/logger';

/**
 * Service to handle tournament-wide broadcasts
 */
export const sendBroadcast = async (message: string, subject: string = 'Tournament Update - CodeJude Football') => {
  try {
    // Fetch ALL teams regardless of status (Pending/Registered/Withdrawn)
    const teams = await Team.find({ isDeleted: false }, 'contactEmail name captainName');
    
    // Extract unique emails
    const recipientEmails = Array.from(new Set(
      teams
        .map(t => t.contactEmail)
        .filter(email => !!email && email.trim() !== '')
    ));

    if (recipientEmails.length === 0) {
      throw new Error('No valid recipients found');
    }

    logger.info(`Sending broadcast to ${recipientEmails.length} recipients...`);

    // We send to recipients as BCC for privacy
    // Note: Some SMTP servers limit BCC size, but for ~100 teams it should be fine.
    // If you have 1000+ teams, you might need a loop or Mailgun/SendGrid batching.
    await sendEmail(recipientEmails, subject, message);

    return {
       recipientCount: recipientEmails.length,
       success: true
    };
  } catch (error) {
    logger.error('Error in Broadcast Service:', error);
    throw error;
  }
};
