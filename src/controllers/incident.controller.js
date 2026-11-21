import path from 'path';
import fs from 'fs';
import * as incidentService from '../services/incident.service.js';
import { generateIncidentPdf } from '../utils/pdfGenerator.js';
import { sendIncidentEmail } from '../utils/email.js';
import prisma from '../config/db.js';
import response from '../utils/response.js';
import { isUserSuperAdmin } from '../middleware/checkPermission.js';
import { INCIDENT_UPLOADS_DIR } from '../middleware/upload.js';
import { getApiBasePath } from '../config/apiBasePath.js';
import { getDepartmentMap } from '../services/department.service.js';

export const create = async (req, res) => {
  try {
    const incident = await incidentService.createIncident(req.body, req.user);
    return response.success(res, 'Incident report created successfully', incident, 201);
  } catch (err) {
    if (err.status === 403) return response.forbidden(res, err.message);
    if (err.status === 400) return response.badRequest(res, err.message);
    return response.serverError(res, 'Failed to create incident report', err);
  }
};

export const getForReporterEdit = async (req, res) => {
  try {
    const incident = await incidentService.getIncidentForReporterEdit(req.params.id, req.user);
    if (!incident) return response.notFound(res, 'Incident not found');
    return response.success(res, 'Incident loaded for editing', incident);
  } catch (err) {
    if (err.statusCode === 403) return response.forbidden(res, err.message);
    if (err.statusCode === 400) return response.badRequest(res, err.message);
    return response.serverError(res, 'Failed to load incident for editing', err);
  }
};

export const updateReporterIncident = async (req, res) => {
  try {
    const incident = await incidentService.updateReporterIncident(req.params.id, req.body, req.user);
    if (!incident) return response.notFound(res, 'Incident not found');
    return response.success(res, 'Incident report updated successfully', incident);
  } catch (err) {
    if (err.statusCode === 403) return response.forbidden(res, err.message);
    if (err.statusCode === 400) return response.badRequest(res, err.message);
    return response.serverError(res, 'Failed to update incident report', err);
  }
};

export const list = async (req, res) => {
  try {
    const {
      filter = 'ALL',
      status = '',
      search = '',
      from_date = '',
      to_date = '',
      date_type = 'incident_date',
      page = 1,
      limit = 10,
      site_id,
    } = req.query;

    const data = await incidentService.listIncidents({
      filter,
      status,
      search,
      from_date,
      to_date,
      date_type,
      page,
      limit,
      site_id: site_id ? Number(site_id) : (req.user?.siteId ? Number(req.user.siteId) : null),
      user: req.user,
    });
    return response.success(res, 'Incidents retrieved successfully', data);
  } catch (err) {
    return response.serverError(res, 'Failed to retrieve incidents', err);
  }
};

const formatDateOnly = (val) => {
  if (!val) return '';
  const d = new Date(val);
  if (isNaN(d.getTime())) return String(val);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
};

const formatDateTime = (val) => {
  if (!val) return '';
  const d = new Date(val);
  if (isNaN(d.getTime())) return String(val);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${day}/${month}/${year} ${hours}:${minutes}`;
};

const combineDateTime = (dateVal, timeVal) => {
  const dStr = formatDateOnly(dateVal);
  const tStr = typeof timeVal === 'string' ? timeVal.trim() : '';
  if (dStr && tStr) return `${dStr} ${tStr}`;
  if (dStr) return `${dStr} 00:00`;
  return tStr;
};

const formatArrayOrText = (val) => {
  if (val === null || val === undefined) return '';
  if (Array.isArray(val)) {
    return val.filter(Boolean).map((v) => String(v).trim()).join(', ');
  }
  return String(val).trim();
};

const escapeCsvCell = (value) => {
  if (value === null || value === undefined) return '""';
  let text = String(value).trim();
  if (/^[\s]*[=+@-]/.test(text)) {
    text = `'${text}`;
  }
  return `"${text.replace(/"/g, '""')}"`;
};

export const exportIncidents = async (req, res) => {
  try {
    const {
      filter = 'ALL',
      status = '',
      search = '',
      from_date = '',
      to_date = '',
      date_type = 'incident_date',
      site_id,
    } = req.query;

    const { items } = await incidentService.listIncidents({
      filter,
      status,
      search,
      from_date,
      to_date,
      date_type,
      exportAll: true,
      site_id: site_id ? Number(site_id) : (req.user?.siteId ? Number(req.user.siteId) : null),
      user: req.user,
    });

    if (!items.length) {
      return response.notFound(res, 'No incidents match the selected filters');
    }

    const deptMap = await getDepartmentMap();
    const resolveDept = (val) => {
      if (!val) return '';
      const s = String(val).trim();
      return deptMap.get(s.toLowerCase()) || deptMap.get(s) || s;
    };

    const transformed = items.map((item) => ({
      'Created Date': formatDateTime(item.created_at || item.date_of_reporting),
      'Incident No': item.incident_no || '',
      'Status': String(item.status || '').replace(/_/g, ' '),
      'Type of Incident': formatArrayOrText(item.type_of_incident),
      'Sub Type of Incident': formatArrayOrText(item.sub_type_of_incident),
      'Patient / Person Name': item.name || '',
      'MR No / CR No': item.cr_no || '',
      'Date & Time of Incident': combineDateTime(item.date_of_incident, item.time_of_incident),
      'Date & Time of Reporting': combineDateTime(item.date_of_reporting, item.time_of_reporting),
      'Emp ID': item.emp_id || '',
      'Procedure / Surgery Done': item.procedure_surgery_done || '',
      'Location / Ward': item.location || '',
      'Responsible Person': item.responsible_person || '',
      'Assigned Lead Emp ID': item.assign_incident_report || '',
      'Assigned Lead Name': item.assigned_hod_name || '',
      'Assigned Lead Email': item.assigned_hod_email || '',
      'Assigned Lead Department': resolveDept(item.assigned_hod_dept),
      'Assigned Leads (All)': formatArrayOrText(item.assigned_hod_names),
      'Treating Consultant': item.name_of_treating_counsultant || '',
      'Severity of Injury': formatArrayOrText(item.severity_of_injury),
      'Management Notification': formatArrayOrText(item.management_notification),
      'Person Notified': formatArrayOrText(item.person_notified),
      'Other Remark': item.other_remark || '',
      'Patient Related': formatArrayOrText(item.patient_related),
      'ICU Related': formatArrayOrText(item.icu_related),
      'Medication Error': formatArrayOrText(item.medication_error),
      'Health Care Associated Infection': formatArrayOrText(item.health_care_associated_infection),
      'Anesthesia Related': formatArrayOrText(item.anesthesia_related),
      'Laboratory Related': formatArrayOrText(item.laboratory_related),
      'Radiology Related': formatArrayOrText(item.radiology_related),
      'Adverse Surgical Event': formatArrayOrText(item.adverse_surgical_event),
      'Supply Chain Related': formatArrayOrText(item.supply_chain_related),
      'Spillage / Exposure / Break Down': formatArrayOrText(item.spillage_exposure_break_down),
      'Employee Related': formatArrayOrText(item.employee_related),
      'Infusion Related': formatArrayOrText(item.infusion_related),
      'Details of Incident': item.details_of_incident || '',
      'Complication or Adverse Effect': item.complication_or_adverse_effect || '',
      'Treatment': item.treatment || '',
      'Root Cause Analysis (Factors Which Contributed to Event)': item.factors_which_contributed_to_the_event || '',
      'How Could Event Have Been Prevented': item.how_could_the_event_have_been_prevented || '',
      'Corrective Action': item.corrective_action || '',
      'Preventive Action': item.preventive_action || '',
      'Reporter Emp ID': item.reporter_emp_id || '',
      'Reporter Name': item.reporter_name || '',
      'Reporter Email': item.reporter_email || '',
      'Reporter Department': resolveDept(item.reporter_dept),
      'Investigation Submitted Date': formatDateTime(item.hod_submitted_at),
      'Submitted By Lead Emp ID': item.hod_submitted_by_emp_id || '',
      'Submitted By Lead Name': item.hod_submitted_by_name || '',
      'Lead Closing Remarks': item.hod_remarks || '',
      'Final Approver Emp ID': item.final_approver_emp_id || '',
      'Final Approver Name': item.final_approver_name || '',
      'Final Approval Date': formatDateTime(item.final_approval_date),
      'Quality Approver Remarks': item.final_remarks || '',
    }));

    const headers = Object.keys(transformed[0]);
    const csv = [
      headers.map(escapeCsvCell).join(','),
      ...transformed.map((row) => headers.map((header) => escapeCsvCell(row[header])).join(',')),
    ].join('\r\n');

    const filename = `incidents_${new Date().toISOString().slice(0, 10)}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.status(200).send(`\uFEFF${csv}`);
  } catch (err) {
    return response.serverError(res, 'Failed to export incidents', err);
  }
};

export const getStatuses = async (req, res) => {
  try {
    const statuses = await incidentService.getIncidentStatuses();
    return response.success(res, 'Incident statuses fetched dynamically from database', statuses);
  } catch (err) {
    return response.serverError(res, 'Failed to fetch incident statuses', err);
  }
};

export const getById = async (req, res) => {
  try {
    const { id } = req.params;
    const incident = await incidentService.getIncidentById(id, req.user);
    if (!incident) {
      return response.notFound(res, 'Incident not found');
    }
    return response.success(res, 'Incident retrieved successfully', incident);
  } catch (err) {
    if (err.statusCode === 403) {
      return response.forbidden(res, err.message);
    }
    return response.serverError(res, 'Failed to retrieve incident', err);
  }
};

export const submitHod = async (req, res) => {
  try {
    const { id } = req.params;
    const updated = await incidentService.submitHodReview(id, req.body, req.user);
    return response.success(res, 'HOD investigation submitted successfully', updated);
  } catch (err) {
    if (err.statusCode === 400) {
      return response.badRequest(res, err.message);
    }
    return response.serverError(res, 'Failed to submit HOD investigation', err);
  }
};

export const finalApprove = async (req, res) => {
  try {
    const { id } = req.params;
    const updated = await incidentService.finalApproveIncident(id, req.body, req.user);
    return response.success(res, 'Incident approval status updated', updated);
  } catch (err) {
    if (err.statusCode === 400) {
      return response.badRequest(res, err.message);
    }
    return response.serverError(res, 'Failed to approve incident', err);
  }
};

export const downloadPdf = async (req, res) => {
  try {
    const { id } = req.params;
    const incident = await incidentService.getIncidentById(id);
    if (!incident) {
      return response.notFound(res, 'Incident not found');
    }

    // Permission enforcement: Strictly permitted ONLY after final approval!
    if (incident.status !== 'FINAL_APPROVED') {
      return response.forbidden(
        res,
        'PDF generation is only permitted after the incident report has received Final Approval.'
      );
    }

    // Fetch Site Name from Master DB
    let siteName = 'ZYDUS HOSPITALS';
    try {
      const targetSiteId = incident.site_id || incident.mst_site_id;
      if (targetSiteId) {
        const siteRes = await authPool.query(
          'SELECT site_name FROM public.mst_site WHERE id = $1 LIMIT 1',
          [Number(targetSiteId)]
        );
        if (siteRes.rows.length > 0 && siteRes.rows[0].site_name) {
          siteName = siteRes.rows[0].site_name.trim();
        }
      }
    } catch (e) {
      console.error('Error fetching site name for PDF:', e);
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Incident_Report_${incident.incident_no}.pdf"`);

    const { generateIncidentPdf: freshPdfGenerator } = await import(`../utils/pdfGenerator.js?t=${Date.now()}`);
    freshPdfGenerator(incident, res, siteName);
  } catch (err) {
    return response.serverError(res, 'Failed generating PDF', err);
  }
};

export const sendEmail = async (req, res) => {
  try {
    const { id } = req.params;
    const { recipients = [], cc = [], subject, message } = req.body;

    const incident = await incidentService.getIncidentById(id);
    if (!incident) {
      return response.notFound(res, 'Incident not found');
    }

    // Permission enforcement: Strictly permitted ONLY after final approval!
    if (incident.status !== 'FINAL_APPROVED') {
      return response.forbidden(
        res,
        'Email dispatch is only permitted after the incident report has received Final Approval.'
      );
    }

    // Fetch Site Name from Master DB
    let siteName = 'ZYDUS HOSPITALS';
    try {
      const targetSiteId = incident.site_id || incident.mst_site_id;
      if (targetSiteId) {
        const siteRes = await authPool.query(
          'SELECT site_name FROM public.mst_site WHERE id = $1 LIMIT 1',
          [Number(targetSiteId)]
        );
        if (siteRes.rows.length > 0 && siteRes.rows[0].site_name) {
          siteName = siteRes.rows[0].site_name.trim();
        }
      }
    } catch (e) {
      console.error('Error fetching site name for Email PDF:', e);
    }

    // Ensure reporter's master email address is automatically added to CC
    const ccList = (Array.isArray(cc) ? [...cc] : [cc]).filter(e => typeof e === 'string' && e.includes('@'));
    if (incident.reporter_email && !ccList.includes(incident.reporter_email)) {
      ccList.push(incident.reporter_email);
    }

    const emailResult = await sendIncidentEmail({
      to: recipients,
      cc: ccList,
      subject: subject || `Incident Report ${incident.incident_no} - ${siteName}`,
      htmlContent: message ? `<p>${message.replace(/\n/g, '<br/>')}</p>` : null,
      incident,
      siteName,
    });

    // Log the email attempt in DB
    await prisma.incidentEmailLog.create({
      data: {
        incident_id: incident.id,
        sent_by_emp_id: req.user.empId,
        sent_by_name: req.user.fullName || req.user.username,
        recipients,
        cc_recipients: ccList,
        subject: subject || `Incident Report ${incident.incident_no}`,
        status: emailResult.success ? 'SENT' : 'FAILED',
        message_id: emailResult.messageId || null,
        error_message: emailResult.error || null,
      },
    });

    if (!emailResult.success) {
      return response.badRequest(res, `Failed sending email: ${emailResult.error}`);
    }

    return response.success(res, 'Incident Report and PDF dispatched via email successfully', {
      recipients,
      cc: ccList,
      messageId: emailResult.messageId,
    });
  } catch (err) {
    return response.serverError(res, 'Error processing email dispatch', err);
  }
};

/**
 * Handle image file upload for incident reports (dedicated incidents folder)
 */
export const uploadImages = async (req, res) => {
  try {
    const rawFiles = req.files || (req.file ? [req.file] : []);
    if (!rawFiles || rawFiles.length === 0) {
    return response.badRequest(res, 'No attachments provided for upload');
    }

    const apiBasePath = getApiBasePath();
    const files = rawFiles.map((file) => ({
      filename: file.filename,
      originalname: file.originalname,
      size: file.size,
      mimetype: file.mimetype,
      path: `${apiBasePath}/uploads/incidents/${file.filename}`,
      url: `${apiBasePath}/uploads/incidents/${file.filename}`,
    }));

    return response.success(res, 'Incident evidence attachments uploaded successfully', {
      files,
      paths: files.map((f) => f.path),
    });
  } catch (err) {
    return response.serverError(res, 'Failed to upload incident attachments', err);
  }
};

/**
 * Stream incident image directly
 */
export const getImage = async (req, res) => {
  try {
    const { filename } = req.params;
    const sanitizedFilename = path.basename(filename);
    const filePath = path.join(INCIDENT_UPLOADS_DIR, sanitizedFilename);

    if (!fs.existsSync(filePath)) {
      return response.notFound(res, 'Attachment not found');
    }

    if (req.query.download === '1' || req.query.download === 'true') {
      return res.download(filePath, sanitizedFilename);
    }

    return res.sendFile(filePath);
  } catch (err) {
    return response.serverError(res, 'Failed to retrieve attachment', err);
  }
};
