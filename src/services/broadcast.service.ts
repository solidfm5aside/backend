import Team from '@/models/team.model';
import { sendEmail } from '@/utils/mailer';
import { getBroadcastTemplate } from '@/utils/email-templates';
import logger from '@/utils/logger';

/**
 * Service to handle tournament-wide broadcasts
 */
export const sendBroadcast = async (message: string, subject: string = 'Tournament Update - SolidFM 5-Aside') => {
  try {
    const teams = await Team.find(
      { isDeleted: false, registrationStatus: 'registered' },
      'contactEmail name captainName'
    );
    
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
    await sendEmail(recipientEmails, subject, message, html, { blindCopy: true });

    return {
       recipientCount: recipientEmails.length,
       success: true
    };
  } catch (error) {
    logger.error('Error in Broadcast Service:', error);
    throw error;
  }
};
