import fs from 'fs';
import path from 'path';
import PDFDocument from 'pdfkit';

const formatDate = (value) => {
  if (!value) return 'N/A';
  const dateOnly = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (dateOnly) return `${dateOnly[3]}/${dateOnly[2]}/${dateOnly[1]}`;
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value)
    : new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
};

const formatDateTime = (value) => {
  if (!value) return 'N/A';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(date);
};

/**
 * Generate formatted Incident Report PDF into a stream or Buffer
 */
export const generateIncidentPdf = (incident, stream, siteName = 'ZYDUS HOSPITALS') => {
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 28, bottom: 28, left: 32, right: 32 },
  });

  doc.pipe(stream);

  const pageWidth = 595.28;
  const contentWidth = pageWidth - 64; // 531.28
  const startX = 32;
  let y = 28;

  // Header Banner with Logo + Dynamic Site Name
  const bannerHeight = 58;
  doc.rect(startX, y, contentWidth, bannerHeight).fill('#0f766e'); // Teal 700

  // Check for Logo
  const possibleLogoPaths = [
    'D:\\node\\zydus-backend\\public\\images\\logo\\logo.png',
    path.resolve(process.cwd(), '../zydus-backend/public/images/logo/logo.png'),
    'C:\\node\\zydus-backend\\public\\images\\logo\\logo.png',
  ];
  const validLogoPath = possibleLogoPaths.find((p) => {
    try {
      return fs.existsSync(p);
    } catch {
      return false;
    }
  });

  let textStartX = startX + 12;
  if (validLogoPath) {
    try {
      // Draw white background pill for logo
      doc.roundedRect(startX + 8, y + 8, 86, 42, 4).fill('#ffffff');
      doc.image(validLogoPath, startX + 12, y + 11, { fit: [78, 36], align: 'center', valign: 'center' });
      textStartX = startX + 104;
    } catch (e) {
      console.error('Failed to draw logo in PDF:', e.message);
    }
  }

  // Header Titles
  const displaySite = String(siteName || 'ZYDUS HOSPITALS').toUpperCase();
  doc.fillColor('#ffffff').fontSize(13).font('Helvetica-Bold')
     .text(displaySite, textStartX, y + 11, { width: contentWidth - (textStartX - startX) - 130 });
  doc.fontSize(8.5).font('Helvetica-Bold').fillColor('#ccfbf1')
     .text('INCIDENTS OCCURRENCE REPORTING SYSTEM', textStartX, y + 29);

  // Reference and Status Badges on right side of banner
  doc.fontSize(9.5).font('Helvetica-Bold').fillColor('#ffffff')
     .text(`REF: ${incident.incident_no}`, startX + contentWidth - 145, y + 12, { align: 'right', width: 135 });
  const statusText = (incident.status || 'FINAL_APPROVED').replace(/_/g, ' ');
  doc.fontSize(8.5).font('Helvetica-Bold').fillColor('#fef08a')
     .text(`STATUS: ${statusText}`, startX + contentWidth - 145, y + 28, { align: 'right', width: 135 });

  y += bannerHeight + 10;

  const drawSection = (title) => {
    if (y > 720) {
      doc.addPage();
      y = 32;
    }
    doc.rect(startX, y, contentWidth, 18).fill('#f0fdfa');
    doc.rect(startX, y, 4, 18).fill('#0f766e');
    doc.fillColor('#0f766e').fontSize(8.5).font('Helvetica-Bold')
       .text(title.toUpperCase(), startX + 8, y + 4.5);
    y += 24;
  };

  const drawRow = (l1, v1, l2, v2) => {
    if (y > 740) {
      doc.addPage();
      y = 32;
    }
    doc.fontSize(8).font('Helvetica-Bold').fillColor('#475569').text(l1, startX, y, { width: 125 });
    doc.font('Helvetica').fillColor('#0f172a').text(v1 || 'N/A', startX + 130, y, { width: 135 });

    if (l2) {
      doc.font('Helvetica-Bold').fillColor('#475569').text(l2, startX + 270, y, { width: 125 });
      doc.font('Helvetica').fillColor('#0f172a').text(v2 || 'N/A', startX + 400, y, { width: 130 });
    }
    y += 15;
  };

  const drawBlock = (label, text) => {
    if (y > 700) {
      doc.addPage();
      y = 32;
    }
    doc.fontSize(8).font('Helvetica-Bold').fillColor('#334155').text(label, startX, y);
    y += 11;
    doc.font('Helvetica').fillColor('#1e293b').text(text || 'None specified.', startX, y, { width: contentWidth, align: 'justify' });
    y += Math.max(doc.heightOfString(text || 'None specified.', { width: contentWidth }) + 6, 16);
  };

  // 1. Basic Details
  drawSection('1. Incident & Patient Details');
  drawRow('Type of Incident:', incident.type_of_incident?.join(', '), 'Sub Type of Incident:', incident.sub_type_of_incident?.join(', '));
  drawRow('Patient Name:', incident.name, 'MR No:', incident.cr_no);
  drawRow(
    'Date & Time of Incident:',
    `${formatDate(incident.date_of_incident)} ${incident.time_of_incident || ''}`,
    'Date & Time of Reporting:',
    `${formatDate(incident.date_of_reporting)} ${incident.time_of_reporting || ''}`
  );
  drawRow('Emp ID (If Applicable):', incident.emp_id, 'Procedure / Surgery Done:', incident.procedure_surgery_done);
  drawRow('Location / Ward:', incident.location, 'Responsible Person:', incident.responsible_person);

  const hodListDisplay = (incident.assigned_hod_names && incident.assigned_hod_names.length > 0)
    ? incident.assigned_hod_names.join(', ')
    : `${incident.assigned_hod_name || ''} (${incident.assign_incident_report || ''})`;
  drawRow('Assigned Lead(s):', hodListDisplay, 'Treating Consultant:', incident.name_of_treating_counsultant);

  // 2. Details (Severity & Notification)
  drawSection('2. Details (Severity & Notification)');
  drawRow('Severity of Injury:', incident.severity_of_injury?.join(', '), 'Management Notification:', incident.management_notification?.join(', '));
  drawRow('Person Notified:', incident.person_notified?.join(', '), 'Other Remark:', incident.other_remark || 'None');

  // 3. Incidents (Selected Categories)
  drawSection('3. Incident Categories');
  const cats = [
    { label: 'Patient Related:', val: incident.patient_related },
    { label: 'ICU Related:', val: incident.icu_related },
    { label: 'Medication Error:', val: incident.medication_error },
    { label: 'Healthcare Infection:', val: incident.health_care_associated_infection },
    { label: 'Anesthesia Related:', val: incident.anesthesia_related },
    { label: 'Laboratory Related:', val: incident.laboratory_related },
    { label: 'Radiology Related:', val: incident.radiology_related },
    { label: 'Adverse Surgical Event:', val: incident.adverse_surgical_event },
    { label: 'Supply Chain Related:', val: incident.supply_chain_related },
    { label: 'Spillage / Break Down:', val: incident.spillage_exposure_break_down },
    { label: 'Employee Related:', val: incident.employee_related },
    { label: 'Infusion Related:', val: incident.infusion_related },
  ].filter(c => c.val && c.val.length > 0);

  if (cats.length === 0) {
    drawRow('Selected Categories:', 'None selected');
  } else {
    for (let i = 0; i < cats.length; i += 2) {
      const c1 = cats[i];
      const c2 = cats[i + 1];
      drawRow(c1.label, c1.val.join(', '), c2?.label, c2?.val.join(', '));
    }
  }

  // 4. Narrative & Investigation
  drawSection('4. Narrative & Investigation');
  drawBlock('Details of Incident (Describe how incident happened):', incident.details_of_incident);
  drawBlock('Complication or Adverse Effect (if any):', incident.complication_or_adverse_effect);
  drawBlock('Treatment (If Required):', incident.treatment);
  drawBlock('Root Cause Analysis (Factors Which Contributed to The Event):', incident.factors_which_contributed_to_the_event);
  drawBlock('How Could the Event Have Been Prevented:', incident.how_could_the_event_have_been_prevented);
  drawBlock('Comment/Action Suggested (Corrective Action):', incident.corrective_action);
  drawBlock('Preventive Action:', incident.preventive_action);

  // 5. Digital Audit & Timeline (Created, Submitted, Approved)
  drawSection('5. Timeline, Review & Final Approval');
  
  // Create / Report Milestone
  const createdDateStr = incident.date_of_reporting 
    ? `${formatDate(incident.date_of_reporting)} ${incident.time_of_reporting || ''}`
    : (incident.created_at ? formatDateTime(incident.created_at) : 'N/A');
  drawRow('Incident Created Date:', createdDateStr, 'Reported By:', `${incident.reporter_name} (${incident.reporter_emp_id})`);

  // Investigation Submitted Milestone
  const hodSubmitter = incident.hod_submitted_by_name 
    ? `${incident.hod_submitted_by_name} (${incident.hod_submitted_by_emp_id || ''})`
    : (incident.hod_submitted_at ? 'Lead' : 'Pending');
  const hodSubmittedDateStr = incident.hod_submitted_at ? formatDateTime(incident.hod_submitted_at) : 'Pending Submission';
  drawRow('Investigation Submitted Date:', hodSubmittedDateStr, 'Submitted By Lead:', hodSubmitter);
  if (incident.hod_remarks) {
    drawRow('Lead Closing Remarks:', incident.hod_remarks);
  }

  // Final Approval Milestone
  const approverName = incident.final_approver_name 
    ? `${incident.final_approver_name} (${incident.final_approver_emp_id || ''})` 
    : 'Pending Approval';
  const approvalDateStr = incident.final_approval_date 
    ? formatDateTime(incident.final_approval_date)
    : (incident.status === 'FINAL_APPROVED' && incident.updated_at ? formatDateTime(incident.updated_at) : 'Pending Approval');
  drawRow('Approved Date:', approvalDateStr, 'Approved By:', approverName);
  if (incident.final_remarks) {
    drawRow('Quality Approver Remarks:', incident.final_remarks);
  }

  // Attached Photographic Evidence / Images
  if (Array.isArray(incident.images) && incident.images.length > 0) {
    drawRow('Attached Incident Evidence:', `${incident.images.length} File(s) Attached on Incident Record`);
  }

  // Footer
  doc.fontSize(7.5).font('Helvetica').fillColor('#94a3b8')
     .text(
       `Generated automatically by Zydus Medical Incident Portal on ${formatDateTime(new Date())} | Official Quality Document`,
       startX,
       792,
       { align: 'center', width: contentWidth }
     );

  doc.end();
};
