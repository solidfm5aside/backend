/**
 * Utility to generate high-impact HTML email templates for SolidFM
 */

interface BaseTemplateOptions {
  title: string;
  previewText?: string;
  content: string;
  footer?: string;
}

const getBaseTemplate = ({ title, previewText, content, footer }: BaseTemplateOptions) => {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      background-color: #050505;
      color: #ffffff;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
      line-height: 1.6;
    }
    .wrapper {
      width: 100%;
      table-layout: fixed;
      background-color: #050505;
      padding-bottom: 40px;
    }
    .main {
      background-color: #0f0f0f;
      margin: 0 auto;
      width: 100%;
      max-width: 600px;
      border-spacing: 0;
      border: 1px solid rgba(255, 255, 255, 0.05);
      border-radius: 24px;
      overflow: hidden;
      margin-top: 40px;
    }
    .header {
      padding: 40px 0;
      text-align: center;
      background: linear-gradient(180deg, rgba(37, 99, 235, 0.1) 0%, rgba(15, 15, 15, 0) 100%);
    }
    .logo {
      display: inline-block;
      height: 50px;
      width: 50px;
      line-height: 50px;
      background-color: #2563eb;
      color: #ffffff;
      font-weight: 900;
      font-size: 20px;
      border-radius: 14px;
      text-decoration: none;
      margin-bottom: 15px;
      box-shadow: 0 10px 20px rgba(37, 99, 235, 0.2);
    }
    .content {
      padding: 0 40px 40px;
      text-align: center;
    }
    h1 {
      font-size: 24px;
      font-weight: 800;
      letter-spacing: -0.02em;
      margin-bottom: 10px;
      text-transform: uppercase;
      font-style: italic;
    }
    p {
      color: #a3a3a3;
      font-size: 16px;
      margin-bottom: 30px;
    }
    .button {
      display: inline-block;
      padding: 18px 36px;
      background-color: #2563eb;
      color: #ffffff !important;
      text-decoration: none;
      font-weight: 700;
      border-radius: 16px;
      font-size: 16px;
      transition: all 0.3s ease;
      box-shadow: 0 10px 20px rgba(37, 99, 235, 0.15);
    }
    .footer {
      padding: 30px 40px;
      text-align: center;
      font-size: 11px;
      color: #525252;
      text-transform: uppercase;
      letter-spacing: 0.2em;
      font-weight: 700;
    }
    .divider {
      height: 1px;
      background-color: rgba(255, 255, 255, 0.05);
      margin: 0 40px;
    }
    @media screen and (max-width: 600px) {
      .main {
        border-radius: 0;
        margin-top: 0;
      }
      .content {
        padding: 0 20px 30px;
      }
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <table class="main">
      <tr>
        <td class="header">
          <div class="logo">SFM</div>
          <div style="font-size: 10px; font-weight: 900; letter-spacing: 0.3em; color: #525252; text-transform: uppercase; margin-top: 10px;">
            Elite Tournament System
          </div>
        </td>
      </tr>
      <tr>
        <td class="content">
          ${content}
        </td>
      </tr>
      <tr>
        <td>
          <div class="divider"></div>
        </td>
      </tr>
      <tr>
        <td class="footer">
          ${footer || 'AUTHORIZED PERSONNEL ONLY • ALL ACCESS LOGGED • SOLIDFM 5-ASIDE FOOTBALL'}
        </td>
      </tr>
    </table>
  </div>
</body>
</html>
  `;
};

/**
 * Reset Password Template
 */
export const getPasswordResetTemplate = (name: string, resetUrl: string) => {
  return getBaseTemplate({
    title: 'Reset Your Password - SolidFM',
    content: `
      <h1>Password <span style="color: #2563eb; font-style: normal;">Reset Request</span></h1>
      <p>
        Hi ${name},<br>
        We received a request to reset your admin portal password. 
        Click the button below to secure your account. 
        This link expires in 1 hour.
      </p>
      <a href="${resetUrl}" class="button">Reset Password Now</a>
      <p style="margin-top: 30px; font-size: 12px; color: #525252;">
        If you didn't request this, you can safely ignore this email.
      </p>
    `,
  });
};

/**
 * Broadcast Update Template
 */
export const getBroadcastTemplate = (subject: string, message: string) => {
  return getBaseTemplate({
    title: subject,
    content: `
      <h1 font-style: normal;">Tournament <span style="color: #2563eb; font-style: normal;">Broadcast</span></h1>
      <div style="text-align: left; background: rgba(255,255,255,0.02); padding: 25px; border-radius: 16px; border: 1px solid rgba(255,255,255,0.05);">
        <p style="color: #ffffff; margin-bottom: 0; white-space: pre-wrap;">${message}</p>
      </div>
      <p style="margin-top: 30px; font-size: 12px; color: #525252;">
        You are receiving this as a team contact for the SolidFM 5-Aside Tournament.
      </p>
    `,
  });
};
