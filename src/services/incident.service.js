import prisma from '../config/db.js';
import authPool from '../config/authDb.js';
import { getEmployeeByEmpId } from './employee.service.js';
import { getDepartmentMap, resolveDepartmentName } from './department.service.js';
import { isUserSuperAdmin } from '../middleware/checkPermission.js';
import { getAllowedIncidentCategories, INCIDENT_CATEGORY_FIELDS } from './incidentCategoryAccess.service.js';

/**
 * Generate next sequential incident number by Year and Month (e.g. INC-2026-11-0001)
 * Sequence resets to 0001 at the beginning of each month.
 */
export const generateIncidentNumber = async () => {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = String(now.getMonth() + 1).padStart(2, '0');
  const prefix = `INC-${currentYear}-${currentMonth}-`;

  const lastIncident = await prisma.incidentReport.findFirst({
    where: {
      incident_no: { startsWith: prefix },
    },
    orderBy: { incident_no: 'desc' },
    select: { incident_no: true },
  });

  if (!lastIncident || !lastIncident.incident_no) {
    return `${prefix}0001`;
  }

  const parts = lastIncident.incident_no.split('-');
  const seqStr = parts[parts.length - 1];
  const seq = parseInt(seqStr, 10);
  const nextSeq = isNaN(seq) ? 1 : seq + 1;
  return `${prefix}${String(nextSeq).padStart(4, '0')}`;
};

/**
 * Validate that for RCA framework (5 Whys or Fishbone), mandatory criteria are met:
 * - 5 Whys: first 3 Whys are required
 * - Fishbone: at least 3 of the 6 categories (Staff, Procedures, Equipment, Environment, Communication, Patient) must have options selected
 */
export const validateRca5Whys = (data) => {
  const method = data.rca_method || data.rca_data?.method;

  if (method === 'FISHBONE') {
    const rcaData = typeof data.rca_data === 'object' && data.rca_data !== null ? data.rca_data : {};
    const categories = typeof rcaData.categories === 'object' && rcaData.categories !== null ? rcaData.categories : {};
    const domainKeys = ['staff', 'procedures', 'equipment', 'environment', 'communication', 'patient'];
    let filledCount = domainKeys.filter((k) => Array.isArray(categories[k]) && categories[k].length > 0).length;
    let totalOptionsCount = domainKeys.reduce((sum, k) => sum + (Array.isArray(categories[k]) ? categories[k].length : 0), 0);

    // Check common aliases
    if (filledCount < 3) {
      const merged = { ...categories };
      if (Array.isArray(categories.people) && categories.people.length > 0 && (!merged.staff || merged.staff.length === 0)) {
        merged.staff = categories.people;
      }
      if (Array.isArray(categories.process) && categories.process.length > 0 && (!merged.procedures || merged.procedures.length === 0)) {
        merged.procedures = categories.process;
      }
      if (Array.isArray(categories.materials) && categories.materials.length > 0 && (!merged.equipment || merged.equipment.length === 0)) {
        merged.equipment = categories.materials;
      }
      filledCount = domainKeys.filter((k) => Array.isArray(merged[k]) && merged[k].length > 0).length;
      totalOptionsCount = domainKeys.reduce((sum, k) => sum + (Array.isArray(merged[k]) ? merged[k].length : 0), 0);
    }

    // Fallback: check text in factors_which_contributed_to_the_event if raw text was passed
    if (filledCount < 3 && typeof data.factors_which_contributed_to_the_event === 'string') {
      const rawText = data.factors_which_contributed_to_the_event;
      if (rawText.includes('[RCA Method: Fishbone') || rawText.includes('Ishikawa')) {
        const labels = ['Staff:', 'Procedures:', 'Equipment:', 'Environment:', 'Communication:', 'Patient:'];
        const matchedLabels = labels.filter((lbl) => rawText.includes(lbl));
        if (matchedLabels.length > filledCount) {
          filledCount = matchedLabels.length;
          totalOptionsCount = Math.max(totalOptionsCount, filledCount);
        }
      }
    }

    if (totalOptionsCount < 3 || filledCount < 3) {
      const error = new Error('In RCA Method: Fishbone, minimum 3 options must be selected across at least 3 DIFFERENT categories (Staff, Procedures, Equipment, Environment, Communication, Patient). Selecting 3 options from a single category is not valid.');
      error.status = 400;
      error.statusCode = 400;
      throw error;
    }
    return;
  }

  const is5Whys = method === '5_WHYS' || !method;
  if (!is5Whys) return;

  const rcaData = typeof data.rca_data === 'object' && data.rca_data !== null ? data.rca_data : {};
  const whys = Array.isArray(rcaData.whys) ? rcaData.whys : [];

  const getWhyVal = (index, key) => {
    if (typeof rcaData[key] === 'string' && rcaData[key].trim()) {
      return rcaData[key].trim();
    }
    if (whys[index]) {
      const item = whys[index];
      const val = typeof item === 'string' ? item : (item?.answer || item?.text || '');
      if (typeof val === 'string' && val.trim()) return val.trim();
    }
    return '';
  };

  let why1 = getWhyVal(0, 'why1');
  let why2 = getWhyVal(1, 'why2');
  let why3 = getWhyVal(2, 'why3');

  // Fallback to text parsing in factors_which_contributed_to_the_event if raw text was passed
  if ((!why1 || !why2 || !why3) && typeof data.factors_which_contributed_to_the_event === 'string') {
    const rawText = data.factors_which_contributed_to_the_event;
    if (rawText.includes('[RCA Method: 5 Whys]')) {
      const parsedWhys = [];
      const lines = rawText.split('\n');
      lines.forEach((l) => {
        const match = l.match(/(?:Why did (?:this|that) happen\?\s*–\s*(\d+)|\b(\d+)\.\s*Why):\s*(.*)/i);
        if (match) {
          const idx = parseInt(match[1] || match[2], 10) - 1;
          const val = (match[3] || '').replace(/\(Root Cause\)$/i, '').trim();
          if (idx >= 0 && idx < 5) parsedWhys[idx] = val;
        }
      });
      if (!why1 && parsedWhys[0]) why1 = parsedWhys[0];
      if (!why2 && parsedWhys[1]) why2 = parsedWhys[1];
      if (!why3 && parsedWhys[2]) why3 = parsedWhys[2];
    }
  }

  const missing = [];
  if (!why1) missing.push('Why did this happen? – 1');
  if (!why2) missing.push('Why did that happen? – 2');
  if (!why3) missing.push('Why did that happen? – 3');

  if (missing.length > 0) {
    const error = new Error(`In RCA Method: 5 Whys, the first 3 Whys are mandatory (${missing.join(', ')}).`);
    error.status = 400;
    error.statusCode = 400;
    throw error;
  }
};

/**
 * Create a new Incident with all CodeIgniter conforming fields
 */
export const createIncident = async (data, user) => {
  validateRca5Whys(data);
  if (!data.name_of_treating_counsultant || !String(data.name_of_treating_counsultant).trim()) {
    const error = new Error('Name of Treating Consultant is required');
    error.status = 400;
    error.statusCode = 400;
    throw error;
  }
  const allowedCategoryFields = isUserSuperAdmin(user)
    ? INCIDENT_CATEGORY_FIELDS
    : await getAllowedIncidentCategories(user);
  const submittedCategoryFields = INCIDENT_CATEGORY_FIELDS.filter((field) =>
    Array.isArray(data[field]) ? data[field].length > 0 : Boolean(data[field])
  );
  const deniedCategoryFields = submittedCategoryFields.filter((field) => !allowedCategoryFields.includes(field));
  if (deniedCategoryFields.length) {
    const error = new Error(`You are not allowed to submit these incident categories: ${deniedCategoryFields.join(', ')}`);
    error.status = 403;
    throw error;
  }
  if (!submittedCategoryFields.length) {
    const error = new Error('Select at least one incident category you are authorized to use');
    error.status = 400;
    throw error;
  }

  const incident_no = await generateIncidentNumber();

  // Lookup reporter email
  let reporterEmail = data.reporter_email || user.email;
  let reporterDept = data.reporter_department || user.department;
  const reporterEmp = await getEmployeeByEmpId(user.empId, user.siteId);
  if (reporterEmp) {
    if (!reporterEmail) reporterEmail = reporterEmp.email;
    if (!reporterDept) reporterDept = reporterEmp.department;
  }

  // Lookup assigned HOD details (supports multiple assigned HODs)
  const assignedHods = Array.isArray(data.assigned_hods) ? data.assigned_hods : [];
  const primaryHod = data.assigned_hod || assignedHods[0] || null;
  const hodEmpId = primaryHod?.empId || data.assign_incident_report || data.assigned_hod_emp_id;

  let assignedHodName = primaryHod?.name || data.assigned_hod_name;
  let assignedHodEmail = primaryHod?.email || data.assigned_hod_email;
  let assignedHodDept = primaryHod?.department || data.assigned_hod_dept;

  if (hodEmpId && (!assignedHodName || !assignedHodEmail)) {
    const hodEmp = await getEmployeeByEmpId(hodEmpId, user.siteId);
    if (hodEmp) {
      assignedHodName = hodEmp.name;
      assignedHodEmail = hodEmp.email;
      assignedHodDept = hodEmp.department;
    }
  }

  reporterDept = await resolveDepartmentName(reporterDept);
  assignedHodDept = await resolveDepartmentName(assignedHodDept);

  const hodIds = assignedHods.map((h) => String(h.empId)).filter(Boolean);
  if (hodEmpId && !hodIds.includes(String(hodEmpId))) {
    hodIds.push(String(hodEmpId));
  }
  const hodNames = assignedHods.map((h) => h.name).filter(Boolean);
  if (assignedHodName && !hodNames.includes(assignedHodName)) {
    hodNames.push(assignedHodName);
  }

  const ensureArray = (val) => {
    if (!val) return [];
    if (Array.isArray(val)) return val;
    return [val];
  };

  const responsiblePersons = Array.isArray(data.responsible_persons)
    ? data.responsible_persons
    : (data.responsible_person ? String(data.responsible_person).split(',').map((s) => s.trim()).filter(Boolean) : []);

  const responsiblePersonNames = responsiblePersons
    .map((p) => (typeof p === 'object' && p !== null ? p.name : p))
    .filter(Boolean);

  const responsiblePersonIds = Array.isArray(data.responsible_person_ids) && data.responsible_person_ids.length > 0
    ? data.responsible_person_ids.map(String).filter(Boolean)
    : responsiblePersons
        .map((p) => (typeof p === 'object' && p !== null && p.empId ? String(p.empId) : null))
        .filter(Boolean);

  const responsiblePersonString = responsiblePersonNames.length > 0
    ? responsiblePersonNames.join(', ')
    : (typeof data.responsible_person === 'string' ? data.responsible_person.trim() : '');

  const incident = await prisma.incidentReport.create({
    data: {
      incident_no,
      site_id: Number(data.site_id || user.siteId || 1),
      mst_site_id: Number(data.mst_site_id || user.siteId || 1),

      // Tab 1: Basic Details
      type_of_incident: ensureArray(data.type_of_incident),
      sub_type_of_incident: ensureArray(data.sub_type_of_incident),
      name: data.name || '',
      date_of_incident: data.date_of_incident ? new Date(data.date_of_incident) : null,
      time_of_incident: data.time_of_incident || '',
      cr_no: data.cr_no || '',
      date_of_reporting: data.date_of_reporting ? new Date(data.date_of_reporting) : new Date(),
      time_of_reporting: data.time_of_reporting || '',
      emp_id: data.emp_id || '',
      procedure_surgery_done: data.procedure_surgery_done || '',
      location: data.location || '',
      responsible_person: responsiblePersonString,
      responsible_persons: responsiblePersonNames,
      responsible_person_ids: responsiblePersonIds,
      assign_incident_report: String(hodEmpId || ''),
      assigned_hod_name: assignedHodName || data.assigned_hod_name || '',
      assigned_hod_email: assignedHodEmail || '',
      assigned_hod_dept: assignedHodDept || '',
      assigned_hod_ids: hodIds,
      assigned_hod_names: hodNames,
      name_of_treating_counsultant: data.name_of_treating_counsultant || '',
      images: ensureArray(data.images),

      // Tab 2: Details
      severity_of_injury: ensureArray(data.severity_of_injury),
      management_notification: ensureArray(data.management_notification),
      person_notified: ensureArray(data.person_notified),
      other_remark: data.other_remark || '',

      // Tab 3: Incidents (Categories)
      patient_related: ensureArray(data.patient_related),
      icu_related: ensureArray(data.icu_related),
      medication_error: ensureArray(data.medication_error),
      medication_error_category: data.medication_error_category || null,
      health_care_associated_infection: ensureArray(data.health_care_associated_infection),
      anesthesia_related: ensureArray(data.anesthesia_related),
      laboratory_related: ensureArray(data.laboratory_related),
      radiology_related: ensureArray(data.radiology_related),
      adverse_surgical_event: ensureArray(data.adverse_surgical_event),
      supply_chain_related: ensureArray(data.supply_chain_related),
      spillage_exposure_break_down: ensureArray(data.spillage_exposure_break_down),
      employee_related: ensureArray(data.employee_related),
      infusion_related: ensureArray(data.infusion_related),

      // Tab 4: Finish (Narrative & Initial Treatment)
      details_of_incident: data.details_of_incident || '',
      complication_or_adverse_effect: data.complication_or_adverse_effect || '',
      treatment: data.treatment || '',
      factors_which_contributed_to_the_event: data.factors_which_contributed_to_the_event || '',
      rca_method: data.rca_method || null,
      rca_data: data.rca_data !== undefined ? data.rca_data : null,
      how_could_the_event_have_been_prevented: data.how_could_the_event_have_been_prevented || '',
      corrective_action: data.corrective_action || '',
      preventive_action: data.preventive_action || '',

      // Reporter
      reporter_emp_id: String(user.empId),
      reporter_name: user.fullName || user.username,
      reporter_email: reporterEmail,
      reporter_dept: reporterDept,

      status: 'ASSIGNED_TO_HOD',
      created_by: user.empId,
    },
  });

  return incident;
};

const assertReporterMayEditIncident = (incident, user) => {
  const empId = String(user?.empId || user?.emp_id || '');
  const ownsIncident = empId && (
    String(incident.reporter_emp_id || '') === empId || String(incident.created_by || '') === empId
  );
  if (!ownsIncident) {
    const error = new Error('Only the employee who reported this incident can edit it');
    error.statusCode = 403;
    throw error;
  }
  if (incident.status !== 'ASSIGNED_TO_HOD') {
    const error = new Error('This incident can only be edited before the Lead submits it');
    error.statusCode = 400;
    throw error;
  }
};

export const getIncidentForReporterEdit = async (id, user) => {
  const incident = await prisma.incidentReport.findUnique({ where: { id } });
  if (!incident) return null;
  assertReporterMayEditIncident(incident, user);
  return incident;
};

export const updateReporterIncident = async (id, data, user) => {
  const incident = await prisma.incidentReport.findUnique({ where: { id } });
  if (!incident) return null;
  assertReporterMayEditIncident(incident, user);
  validateRca5Whys(data);
  if (data.name_of_treating_counsultant !== undefined && !String(data.name_of_treating_counsultant).trim()) {
    const error = new Error('Name of Treating Consultant is required');
    error.status = 400;
    error.statusCode = 400;
    throw error;
  }

  const allowedCategoryFields = isUserSuperAdmin(user)
    ? INCIDENT_CATEGORY_FIELDS
    : await getAllowedIncidentCategories(user);
  const ensureArray = (value) => !value ? [] : (Array.isArray(value) ? value : [value]);
  const categoryValues = {};
  for (const field of INCIDENT_CATEGORY_FIELDS) {
    if (allowedCategoryFields.includes(field)) {
      categoryValues[field] = ensureArray(data[field]);
      continue;
    }
    if (data[field] !== undefined) {
      const oldValues = [...(incident[field] || [])].sort();
      const newValues = ensureArray(data[field]).sort();
      if (JSON.stringify(oldValues) !== JSON.stringify(newValues)) {
        const error = new Error(`You are not allowed to change the ${field} category`);
        error.statusCode = 403;
        throw error;
      }
    }
  }
  if (!INCIDENT_CATEGORY_FIELDS.some((field) =>
    allowedCategoryFields.includes(field) && categoryValues[field]?.length
  )) {
    const error = new Error('Select at least one incident category you are authorized to use');
    error.statusCode = 400;
    throw error;
  }

  const assignedHods = Array.isArray(data.assigned_hods) ? data.assigned_hods : [];
  const primaryHod = data.assigned_hod || assignedHods[0] || null;
  const hodEmpId = String(primaryHod?.empId || data.assign_incident_report || incident.assign_incident_report || '');
  const primaryEmployee = primaryHod?.empId ? null : await getEmployeeByEmpId(hodEmpId, user.siteId);
  const assignedHodIds = [...new Set([
    ...assignedHods.map((hod) => String(hod.empId || '')).filter(Boolean),
    ...(hodEmpId ? [hodEmpId] : []),
  ])];
  const assignedHodNames = [...new Set([
    ...assignedHods.map((hod) => hod.name).filter(Boolean),
    ...(primaryHod?.name || data.assigned_hod_name ? [primaryHod?.name || data.assigned_hod_name] : []),
  ])];

  const responsiblePersons = Array.isArray(data.responsible_persons)
    ? data.responsible_persons
    : (data.responsible_person ? String(data.responsible_person).split(',').map((s) => s.trim()).filter(Boolean) : []);

  const responsiblePersonNames = responsiblePersons
    .map((p) => (typeof p === 'object' && p !== null ? p.name : p))
    .filter(Boolean);

  const responsiblePersonIds = Array.isArray(data.responsible_person_ids) && data.responsible_person_ids.length > 0
    ? data.responsible_person_ids.map(String).filter(Boolean)
    : responsiblePersons
        .map((p) => (typeof p === 'object' && p !== null && p.empId ? String(p.empId) : null))
        .filter(Boolean);

  const responsiblePersonString = responsiblePersonNames.length > 0
    ? responsiblePersonNames.join(', ')
    : (typeof data.responsible_person === 'string' ? data.responsible_person.trim() : incident.responsible_person || '');

  return prisma.incidentReport.update({
    where: { id },
    data: {
      type_of_incident: ensureArray(data.type_of_incident),
      sub_type_of_incident: ensureArray(data.sub_type_of_incident),
      name: data.name || '',
      date_of_incident: data.date_of_incident ? new Date(data.date_of_incident) : null,
      time_of_incident: data.time_of_incident || '',
      cr_no: data.cr_no || '',
      date_of_reporting: data.date_of_reporting ? new Date(data.date_of_reporting) : incident.date_of_reporting,
      time_of_reporting: data.time_of_reporting || '',
      emp_id: data.emp_id || '',
      procedure_surgery_done: data.procedure_surgery_done || '',
      location: data.location || '',
      responsible_person: responsiblePersonString,
      responsible_persons: responsiblePersonNames,
      responsible_person_ids: responsiblePersonIds,
      assign_incident_report: hodEmpId,
      assigned_hod_name: primaryHod?.name || data.assigned_hod_name || primaryEmployee?.name || incident.assigned_hod_name || '',
      assigned_hod_email: primaryHod?.email || data.assigned_hod_email || primaryEmployee?.email || incident.assigned_hod_email || '',
      assigned_hod_dept: await resolveDepartmentName(
        primaryHod?.department || data.assigned_hod_dept || primaryEmployee?.department || incident.assigned_hod_dept || ''
      ),
      assigned_hod_ids: assignedHodIds,
      assigned_hod_names: assignedHodNames,
      name_of_treating_counsultant: data.name_of_treating_counsultant || '',
      images: ensureArray(data.images),
      severity_of_injury: ensureArray(data.severity_of_injury),
      management_notification: ensureArray(data.management_notification),
      person_notified: ensureArray(data.person_notified),
      other_remark: data.other_remark || '',
      ...categoryValues,
      medication_error_category: data.medication_error_category !== undefined ? (data.medication_error_category || null) : incident.medication_error_category,
      details_of_incident: data.details_of_incident || '',
      complication_or_adverse_effect: data.complication_or_adverse_effect || '',
      treatment: data.treatment || '',
      factors_which_contributed_to_the_event: data.factors_which_contributed_to_the_event || '',
      rca_method: data.rca_method || null,
      rca_data: data.rca_data !== undefined ? data.rca_data : null,
      how_could_the_event_have_been_prevented: data.how_could_the_event_have_been_prevented || '',
      corrective_action: data.corrective_action || '',
      preventive_action: data.preventive_action || '',
      updated_by: String(user.empId || user.emp_id || ''),
    },
  });
};

/**
 * Retrieve Incident Statuses dynamically from PostgreSQL pg_enum (no static hardcoded values)
 */
export const getIncidentStatuses = async () => {
  try {
    const rows = await prisma.$queryRaw`
      SELECT e.enumlabel AS value, e.enumsortorder
      FROM pg_enum e
      JOIN pg_type t ON e.enumtypid = t.oid
      WHERE t.typname = 'IncidentStatus'
      ORDER BY e.enumsortorder ASC
    `;

    const formatLabel = (val) => {
      if (!val) return '';
      if (val === 'ASSIGNED_TO_HOD') return 'Assigned To Lead';
      if (val === 'HOD_SUBMITTED') return 'Lead Submitted';
      return val
        .split('_')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(' ');
    };

    return rows.map((r) => ({
      value: r.value,
      label: formatLabel(r.value),
      sortOrder: r.enumsortorder,
    }));
  } catch (err) {
    console.error('Failed to query IncidentStatus enum from DB:', err);
    return [
      { value: 'DRAFT', label: 'Draft' },
      { value: 'ASSIGNED_TO_HOD', label: 'Assigned To Lead' },
      { value: 'HOD_SUBMITTED', label: 'Lead Submitted' },
      { value: 'FINAL_APPROVED', label: 'Final Approved' },
      { value: 'REJECTED', label: 'Rejected' },
    ];
  }
};

/**
 * Submit HOD Review & Investigation (Step 2)
 */
export const submitHodReview = async (id, data, user) => {
  const incident = await prisma.incidentReport.findUnique({
    where: { id },
  });

  if (!incident) {
    throw new Error('Incident not found');
  }

  // Once submitted or final approved, lock down data changes
  if (incident.status === 'HOD_SUBMITTED' || incident.status === 'FINAL_APPROVED') {
    const statusText = incident.status === 'FINAL_APPROVED' ? 'Final Approved' : 'Submitted';
    const err = new Error(`Incident report is locked and cannot be modified because it is already ${statusText}.`);
    err.statusCode = 400;
    throw err;
  }

  if (data.rca_method !== undefined || data.rca_data !== undefined) {
    validateRca5Whys(data);
  }

  // Handle assigning an additional HOD if selected during review
  let assignedHodIds = incident.assigned_hod_ids || [];
  let assignedHodNames = incident.assigned_hod_names || [];

  if (data.additional_hod?.empId) {
    const addId = String(data.additional_hod.empId);
    if (!assignedHodIds.includes(addId)) {
      assignedHodIds.push(addId);
    }
    if (data.additional_hod.name && !assignedHodNames.includes(data.additional_hod.name)) {
      assignedHodNames.push(data.additional_hod.name);
    }
  }

  const updated = await prisma.incidentReport.update({
    where: { id },
    data: {
      factors_which_contributed_to_the_event: data.factors_which_contributed_to_the_event || incident.factors_which_contributed_to_the_event,
      rca_method: data.rca_method !== undefined ? data.rca_method : incident.rca_method,
      rca_data: data.rca_data !== undefined ? data.rca_data : incident.rca_data,
      how_could_the_event_have_been_prevented: data.how_could_the_event_have_been_prevented || incident.how_could_the_event_have_been_prevented,
      corrective_action: data.corrective_action || incident.corrective_action,
      preventive_action: data.preventive_action || incident.preventive_action,
      hod_remarks: data.hod_remarks || '',
      hod_submitted_at: new Date(),
      hod_submitted_by_emp_id: String(user.empId),
      hod_submitted_by_name: user.fullName || user.username,
      assigned_hod_ids: assignedHodIds,
      assigned_hod_names: assignedHodNames,
      images: Array.isArray(data.images) && data.images.length > 0 ? data.images : incident.images,
      status: 'HOD_SUBMITTED',
      updated_by: user.empId,
    },
  });

  return updated;
};

/**
 * Final Approval (Step 3)
 */
export const finalApproveIncident = async (id, data, user) => {
  const incident = await prisma.incidentReport.findUnique({
    where: { id },
  });

  if (!incident) {
    throw new Error('Incident not found');
  }

  if (incident.status === 'FINAL_APPROVED') {
    const err = new Error('Incident report has already received Final Approval and is locked.');
    err.statusCode = 400;
    throw err;
  }

  const updated = await prisma.incidentReport.update({
    where: { id },
    data: {
      final_approver_emp_id: String(user.empId),
      final_approver_name: user.fullName || user.username,
      final_approval_date: new Date(),
      final_remarks: data.final_remarks || '',
      status: data.isApproved === false ? 'REJECTED' : 'FINAL_APPROVED',
      updated_by: user.empId,
    },
  });

  return updated;
};

/**
 * Check if requesting user possesses Final Approval rights (Super Admin or FINAL_APPROVE permission)
 */
export const canUserFinalApprove = async (user) => {
  if (!user) return false;
  if (isUserSuperAdmin(user)) return true;

  if (user.permissions && typeof user.permissions === 'object') {
    if (
      user.permissions.FINAL_APPROVE === true ||
      user.permissions.final_approve === true ||
      user.permissions['FINAL APPROVE'] === true
    ) {
      return true;
    }
  }

  // Live database check against zydusapp role_permissions & user_module_permissions
  try {
    const targetUserId = user.userId || user.id;
    const targetEmpId = user.empId || user.emp_id || user.username;

    const res = await authPool.query(`
      SELECT p.permission_name
      FROM public.permissions p
      WHERE UPPER(p.permission_name) IN ('FINAL_APPROVE', 'FINAL APPROVE')
        AND p.id IN (
          SELECT rp.permission_id
          FROM public.user_roles ur
          JOIN public.role_permissions rp ON rp.role_id = ur.role_id
          JOIN public.modules m ON m.id = rp.module_id
          WHERE (ur.user_id::text = $1 OR ur.user_id IN (SELECT id FROM public.users WHERE emp_id = $2 OR username = $2))
            AND (m.module_key IN ('INCIDENT_PORTAL', 'INCIDENTS', 'INCIDENT_REPORT', 'CLINICAL_INCIDENT') OR m.url ILIKE '%medical%' OR m.url ILIKE '%incident%')

          UNION

          SELECT ump.permission_id
          FROM public.user_module_permissions ump
          JOIN public.modules m ON m.id = ump.module_id
          WHERE (ump.user_id::text = $1 OR ump.user_id IN (SELECT id FROM public.users WHERE emp_id = $2 OR username = $2))
            AND (m.module_key IN ('INCIDENT_PORTAL', 'INCIDENTS', 'INCIDENT_REPORT', 'CLINICAL_INCIDENT') OR m.url ILIKE '%medical%' OR m.url ILIKE '%incident%')
        )
      LIMIT 1
    `, [String(targetUserId || ''), String(targetEmpId || '')]);

    return res.rows.length > 0;
  } catch (err) {
    console.error('Error verifying final approve permission in incident.service:', err);
    return false;
  }
};

/**
 * List incidents with server-side pagination, search, status, and date range filters
 */
export const listIncidents = async ({
  filter = 'ALL',
  status = '',
  search = '',
  from_date = '',
  to_date = '',
  date_type = 'incident_date',
  page = 1,
  limit = 10,
  exportAll = false,
  site_id,
  user,
}) => {
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 10));
  const skip = (safePage - 1) * safeLimit;
  const where = {};

  if (site_id && !isNaN(Number(site_id))) {
    where.site_id = Number(site_id);
  }

  const userEmpId = String(user?.empId || user?.emp_id || '');
  const canApprove = await canUserFinalApprove(user);

  // Scoped conditions: only incidents assigned to the user or reported/created by them
  const userScopeConditions = [
    { assign_incident_report: userEmpId },
    { assigned_hod_ids: { has: userEmpId } },
    { reporter_emp_id: userEmpId },
    { created_by: userEmpId },
  ];

  if (canApprove) {
    // Users with Final Approve (Quality / Director / Super Admin) can see hospital-wide
    if (filter === 'ASSIGNED_TO_ME') {
      where.OR = [
        { assign_incident_report: userEmpId },
        { assigned_hod_ids: { has: userEmpId } },
      ];
    } else if (filter === 'MY_INCIDENTS') {
      where.OR = [
        { reporter_emp_id: userEmpId },
        { created_by: userEmpId },
      ];
    } else if (filter === 'PENDING_APPROVAL') {
      where.status = 'HOD_SUBMITTED';
    } else if (filter === 'APPROVED') {
      where.status = 'FINAL_APPROVED';
    }
  } else {
    // Non-approvers can strictly ONLY see incidents assigned to them or created/reported by them
    if (filter === 'ASSIGNED_TO_ME') {
      where.OR = [
        { assign_incident_report: userEmpId },
        { assigned_hod_ids: { has: userEmpId } },
      ];
    } else if (filter === 'MY_INCIDENTS') {
      where.OR = [
        { reporter_emp_id: userEmpId },
        { created_by: userEmpId },
      ];
    } else if (filter === 'APPROVED') {
      where.status = 'FINAL_APPROVED';
      where.AND = [{ OR: userScopeConditions }];
    } else {
      where.OR = userScopeConditions;
    }
  }

  // Specific Status Filter (Dynamic Enum)
  if (status && status !== 'ALL' && status.trim() !== '') {
    where.status = status.trim();
  }

  // Date-wise Range Filter
  if (from_date || to_date) {
    const dateQuery = {};
    if (from_date) {
      const from = new Date(from_date);
      from.setHours(0, 0, 0, 0);
      dateQuery.gte = from;
    }
    if (to_date) {
      const to = new Date(to_date);
      to.setHours(23, 59, 59, 999);
      dateQuery.lte = to;
    }

    const targetField =
      date_type === 'reporting_date'
        ? 'date_of_reporting'
        : date_type === 'created_at'
        ? 'created_at'
        : 'date_of_incident';

    where[targetField] = dateQuery;
  }

  if (search && search.trim()) {
    const searchFilter = [
      { incident_no: { contains: search.trim(), mode: 'insensitive' } },
      { name: { contains: search.trim(), mode: 'insensitive' } },
      { cr_no: { contains: search.trim(), mode: 'insensitive' } },
      { reporter_name: { contains: search.trim(), mode: 'insensitive' } },
      { assigned_hod_name: { contains: search.trim(), mode: 'insensitive' } },
      { location: { contains: search.trim(), mode: 'insensitive' } },
      { hod_submitted_by_name: { contains: search.trim(), mode: 'insensitive' } },
      { final_approver_name: { contains: search.trim(), mode: 'insensitive' } },
      { medication_error: { has: search.trim() } },
    ];

    if (!where.AND) where.AND = [];
    if (where.OR) {
      where.AND.push({ OR: where.OR });
      delete where.OR;
    }
    where.AND.push({ OR: searchFilter });
  }

  const findManyArgs = {
    where,
    orderBy: { created_at: 'desc' },
  };
  if (!exportAll) {
    findManyArgs.skip = skip;
    findManyArgs.take = safeLimit;
  }

  const deptMap = await getDepartmentMap();
  const resolveDept = (val) => {
    if (!val) return '';
    const s = String(val).trim();
    return deptMap.get(s.toLowerCase()) || deptMap.get(s) || s;
  };

  const resolveItems = (list) =>
    list.map((inc) => ({
      ...inc,
      reporter_dept: resolveDept(inc.reporter_dept),
      assigned_hod_dept: resolveDept(inc.assigned_hod_dept),
    }));

  if (exportAll) {
    const items = await prisma.incidentReport.findMany(findManyArgs);
    return { total: items.length, items: resolveItems(items) };
  }

  const [total, items] = await Promise.all([
    prisma.incidentReport.count({ where }),
    prisma.incidentReport.findMany({ ...findManyArgs, skip, take: safeLimit }),
  ]);

  return {
    total,
    page: safePage,
    limit: safeLimit,
    totalPages: Math.ceil(total / safeLimit) || 1,
    items: resolveItems(items),
  };
};

/**
 * Get incident by ID with user scope verification
 */
export const getIncidentById = async (id, user = null) => {
  const incident = await prisma.incidentReport.findUnique({
    where: { id },
    include: {
      email_logs: {
        orderBy: { sent_at: 'desc' },
      },
    },
  });

  if (!incident) {
    return null;
  }

  incident.reporter_dept = await resolveDepartmentName(incident.reporter_dept);
  incident.assigned_hod_dept = await resolveDepartmentName(incident.assigned_hod_dept);

  if (user) {
    const canApprove = await canUserFinalApprove(user);
    if (!canApprove) {
      const userEmpId = String(user.empId || user.emp_id || '');
      const isAssigned =
        incident.assign_incident_report === userEmpId ||
        (incident.assigned_hod_ids && incident.assigned_hod_ids.includes(userEmpId));
      const isReporter =
        incident.reporter_emp_id === userEmpId || incident.created_by === userEmpId;

      if (!isAssigned && !isReporter) {
        const err = new Error('Access denied: You do not have permission to view this incident.');
        err.statusCode = 403;
        throw err;
      }
    }
  }

  return incident;
};
