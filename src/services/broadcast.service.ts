import Team from '@/models/team.model';
import { sendEmail } from '@/utils/mailer';
import { getBroadcastTemplate } from '@/utils/email-templates';
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
    const html = getBroadcastTemplate(subject, message);
    await sendEmail(recipientEmails, subject, message, html);

    return {
       recipientCount: recipientEmails.length,
       success: true
    };
  } catch (error) {
    logger.error('Error in Broadcast Service:', error);
    throw error;
  }
};
