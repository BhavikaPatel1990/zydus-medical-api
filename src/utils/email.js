import axios from 'axios';
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import { PassThrough } from 'stream';
import { generateIncidentPdf } from './pdfGenerator.js';

dotenv.config();

const TENANT_ID = process.env.TENANT_ID || '';
const CLIENT_ID = process.env.CLIENT_ID || '';
const CLIENT_SECRET = process.env.CLIENT_SECRET || '';
const FROM_USER = process.env.SMTP_FROM || process.env.MAIL_USER || '';

let cachedToken = null;
let tokenExpiresAt = 0;

/**
 * Get Microsoft Graph API OAuth2 Token with in-memory caching
 */
const getGraphAccessToken = async () => {
  if (cachedToken && Date.now() < tokenExpiresAt) {
    return cachedToken;
  }

  const tokenUrl = `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`;
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });

  const res = await axios.post(tokenUrl, params);
  const token = res.data?.access_token;
  if (!token) throw new Error('Failed to retrieve Microsoft Graph Access Token');

  cachedToken = token;
  tokenExpiresAt = Date.now() + ((res.data.expires_in || 3600) - 120) * 1000;
  return token;
};

export const createPdfBuffer = async (incident, siteName = 'ZYDUS HOSPITALS') => {
  const { generateIncidentPdf } = await import(`./pdfGenerator.js?t=${Date.now()}`);
  return new Promise((resolve, reject) => {
    const pass = new PassThrough();
    const buffers = [];
    pass.on('data', chunk => buffers.push(chunk));
    pass.on('end', () => resolve(Buffer.concat(buffers)));
    pass.on('error', reject);

    generateIncidentPdf(incident, pass, siteName);
  });
};

/**
 * Send Incident Notification Email via Microsoft Graph API (with SMTP fallback)
 */
export const sendIncidentEmail = async ({ to = [], cc = [], subject, htmlContent, incident, siteName }) => {
  if (process.env.ENABLE_EMAIL !== 'true') {
    console.log(`[Email Disabled] TO: ${Array.isArray(to) ? to.join(', ') : to} | Subject: ${subject}`);
    return { success: true, messageId: 'EMAIL_DISABLED' };
  }

  const cleanEmails = (list) => {
    if (!list) return [];
    if (typeof list === 'string') {
      return list.split(/[;,]/).map(e => e.trim()).filter(e => e.includes('@'));
    }
    if (Array.isArray(list)) {
      return list.flatMap(item => cleanEmails(item));
    }
    return [];
  };

  const validTo = cleanEmails(to);
  const validCc = cleanEmails(cc);

  if (validTo.length === 0) {
    throw new Error('At least one valid recipient email is required');
  }

  // Generate attached PDF
  let pdfBuffer = null;
  if (incident) {
    try {
      pdfBuffer = await createPdfBuffer(incident, siteName);
    } catch (pdfErr) {
      console.error('[PDF Buffer Generation Error]:', pdfErr.message);
    }
  }

  const defaultHtml = `
    <div style="font-family: Arial, sans-serif; color: #1e293b; max-width: 650px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
      <div style="background-color: #0f766e; color: #ffffff; padding: 18px 24px;">
        <h2 style="margin: 0; font-size: 20px;">Zydus Hospitals - Clinical Incident Notification</h2>
        <p style="margin: 4px 0 0; font-size: 13px; opacity: 0.9;">Incident Report Reference: <strong>${incident?.incident_no || 'N/A'}</strong></p>
      </div>
      <div style="padding: 24px;">
        ${htmlContent || '<p>Please find attached the official incident report for your review and records.</p>'}
        <div style="background-color: #f8fafc; border-left: 4px solid #0f766e; padding: 14px 18px; margin: 18px 0; border-radius: 4px;">
          <p style="margin: 0; font-size: 13px;"><strong>Status:</strong> ${incident?.status?.replace(/_/g, ' ') || 'N/A'}</p>
          <p style="margin: 6px 0 0; font-size: 13px;"><strong>Reported By:</strong> ${incident?.reporter_name || 'N/A'} (${incident?.reporter_emp_id || 'N/A'})</p>
          <p style="margin: 6px 0 0; font-size: 13px;"><strong>Assigned HOD:</strong> ${incident?.assigned_hod_name || 'N/A'}</p>
          <p style="margin: 6px 0 0; font-size: 13px;"><strong>Incident Date:</strong> ${incident?.date_of_incident ? new Date(incident.date_of_incident).toLocaleDateString() : 'N/A'}</p>
        </div>
        <p style="font-size: 12px; color: #64748b; margin-top: 24px;">This is an automated notification from Zydus Medical & Clinical Incident Management System. Please do not reply directly to this email.</p>
      </div>
    </div>
  `;

  // 1. Try Microsoft Graph API First (Standard for Zydus)
  try {
    const token = await getGraphAccessToken();
    const sendMailUrl = `https://graph.microsoft.com/v1.0/users/${FROM_USER}/sendMail`;

    const attachments = [];
    if (pdfBuffer) {
      attachments.push({
        '@odata.type': '#microsoft.graph.fileAttachment',
        name: `Incident_Report_${incident.incident_no}.pdf`,
        contentType: 'application/pdf',
        contentBytes: pdfBuffer.toString('base64'),
      });
    }

    const payload = {
      message: {
        subject: subject || `Incident Report ${incident?.incident_no || ''} - Zydus Hospitals`,
        body: {
          contentType: 'HTML',
          content: defaultHtml,
        },
        toRecipients: validTo.map(email => ({ emailAddress: { address: email } })),
        ccRecipients: validCc.map(email => ({ emailAddress: { address: email } })),
        bccRecipients: [{ emailAddress: { address: 'itapps@zyduscadila.onmicrosoft.com' } }],
        attachments,
      },
    };

    const res = await axios.post(sendMailUrl, payload, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      timeout: 20000,
    });

    if (res.status === 202) {
      console.log(`[Email Dispatched via MS Graph]: TO: ${validTo.join(', ')} | CC: ${validCc.join(', ')}`);
      return { success: true, messageId: `GRAPH-${Date.now()}` };
    }
  } catch (graphError) {
    const graphErrDetails = graphError.response?.data || graphError.message;
    console.error('[MS Graph Mail Error]:', graphErrDetails);

    // Fallback to SMTP
    try {
      console.log('[Falling back to SMTP transporter]...');
      const transporter = nodemailer.createTransport({
        host: process.env.MAIL_HOST,
        port: parseInt(process.env.MAIL_PORT || '587'),
        secure: false,
        auth: {
          user: process.env.MAIL_USER,
          pass: process.env.MAIL_PASS,
        },
        tls: { rejectUnauthorized: false },
      });

      const attachments = [];
      if (pdfBuffer) {
        attachments.push({
          filename: `Incident_Report_${incident.incident_no}.pdf`,
          content: pdfBuffer,
          contentType: 'application/pdf',
        });
      }

      const mailOptions = {
        from: FROM_USER,
        to: validTo.join(', '),
        cc: validCc.length > 0 ? validCc.join(', ') : undefined,
        bcc: ['itapps@zyduscadila.onmicrosoft.com'],
        subject: subject || `Incident Report ${incident?.incident_no || ''} - Zydus Hospitals`,
        html: defaultHtml,
        attachments,
      };

      const info = await transporter.sendMail(mailOptions);
      console.log('[Email Dispatched via SMTP Fallback]:', info.messageId);
      return { success: true, messageId: info.messageId };
    } catch (smtpError) {
      console.error('[SMTP Fallback Error]:', smtpError.message);
      return {
        success: false,
        error: graphError.response?.data?.error?.message || graphError.message || smtpError.message,
      };
    }
  }
};

export default {
  sendIncidentEmail,
  createPdfBuffer,
};
