import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import PDFDocument from 'pdfkit';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const INCIDENT_UPLOADS_DIR = path.resolve(__dirname, '../../uploads/incidents');

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
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
};

/**
 * Generate formatted Incident Report PDF into a stream or Buffer
 */
export const generateIncidentPdf = (incident, stream, siteName = 'ZYDUS HOSPITALS') => {
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 28, bottom: 28, left: 32, right: 32 },
    bufferPages: true,
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

  y += bannerHeight + 12;

  // Helper to ensure enough space on current page
  const ensurePageSpace = (neededHeight) => {
    if (y + neededHeight > 760) {
      doc.addPage();
      y = 32;
      return true;
    }
    return false;
  };

  const drawSection = (title) => {
    ensurePageSpace(45);
    doc.rect(startX, y, contentWidth, 18).fill('#f0fdfa');
    doc.rect(startX, y, 4, 18).fill('#0f766e');
    doc.fillColor('#0f766e').fontSize(8.5).font('Helvetica-Bold')
       .text(title.toUpperCase(), startX + 8, y + 4.5);
    y += 24;
  };

  const drawRow = (l1, v1, l2, v2) => {
    const val1 = (v1 === null || v1 === undefined || v1 === '') ? 'N/A' : String(v1);
    const val2 = (v2 === null || v2 === undefined || v2 === '') ? 'N/A' : String(v2);

    doc.fontSize(8).font('Helvetica');
    const col1Width = l2 ? 135 : (contentWidth - 130);
    const h1 = doc.heightOfString(val1, { width: col1Width });
    const h2 = l2 ? doc.heightOfString(val2, { width: 130 }) : 0;
    const rowHeight = Math.max(h1, h2, 12) + 5;

    ensurePageSpace(rowHeight);

    doc.fontSize(8).font('Helvetica-Bold').fillColor('#475569').text(l1, startX, y, { width: 125 });
    doc.font('Helvetica').fillColor('#0f172a').text(val1, startX + 130, y, { width: col1Width });

    if (l2) {
      doc.font('Helvetica-Bold').fillColor('#475569').text(l2, startX + 270, y, { width: 125 });
      doc.font('Helvetica').fillColor('#0f172a').text(val2, startX + 400, y, { width: 130 });
    }
    y += rowHeight;
  };

  const drawBlock = (label, text) => {
    const content = text && String(text).trim() ? String(text).trim() : 'None specified.';
    doc.fontSize(8).font('Helvetica');
    const textHeight = doc.heightOfString(content, { width: contentWidth, align: 'justify' });
    const blockHeight = 14 + textHeight + 6;

    ensurePageSpace(Math.min(blockHeight, 70));

    doc.fontSize(8).font('Helvetica-Bold').fillColor('#334155').text(label, startX, y);
    y += 12;
    doc.font('Helvetica').fillColor('#1e293b').text(content, startX, y, { width: contentWidth, align: 'justify' });
    y += textHeight + 8;
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
  ].filter((c) => c.val && c.val.length > 0);

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

  // 6. Attached Evidence / Images & Documents
  const rawImages = Array.isArray(incident.images) ? incident.images : [];
  if (rawImages.length > 0) {
    drawSection('6. Attached Incident Evidence & Files');

    const imageFiles = [];
    const documentFiles = [];

    for (const item of rawImages) {
      if (!item) continue;
      const fileName = String(item).split('/').filter(Boolean).pop();
      const ext = path.extname(fileName).toLowerCase();
      const localPath = path.join(INCIDENT_UPLOADS_DIR, fileName);

      if (['.png', '.jpg', '.jpeg'].includes(ext)) {
        imageFiles.push({ fileName, localPath, ext });
      } else {
        documentFiles.push({ fileName, localPath, ext });
      }
    }

    // Render document attachments (e.g. PDF files)
    if (documentFiles.length > 0) {
      ensurePageSpace(26 + documentFiles.length * 16);
      doc.fontSize(8).font('Helvetica-Bold').fillColor('#334155')
         .text('Attached PDF Documents / Evidence Files:', startX, y);
      y += 14;

      for (const docFile of documentFiles) {
        doc.fontSize(8).font('Helvetica-Bold').fillColor('#b91c1c').text('• [PDF DOCUMENT]', startX + 8, y, { continued: true });
        doc.font('Helvetica').fillColor('#0f172a').text(`  ${docFile.fileName}  — Available for direct download from Incident Portal`);
        y += 14;
      }
      y += 8;
    }

    // Render image attachments (PNG, JPG, JPEG embedded directly)
    if (imageFiles.length > 0) {
      ensurePageSpace(30);
      doc.fontSize(8).font('Helvetica-Bold').fillColor('#334155')
         .text(`Attached Photographic Evidence (${imageFiles.length} Image(s)):`, startX, y);
      y += 14;

      const imgWidth = (contentWidth - 16) / 2; // ~257
      const imgHeight = 160;

      for (let i = 0; i < imageFiles.length; i += 2) {
        ensurePageSpace(imgHeight + 20);

        const img1 = imageFiles[i];
        const img2 = imageFiles[i + 1];

        // Draw card 1
        const x1 = startX;
        doc.roundedRect(x1, y, imgWidth, imgHeight, 4).lineWidth(0.5).stroke('#cbd5e1');
        let rendered1 = false;
        if (fs.existsSync(img1.localPath)) {
          try {
            doc.image(img1.localPath, x1 + 4, y + 4, {
              fit: [imgWidth - 8, imgHeight - 22],
              align: 'center',
              valign: 'center',
            });
            rendered1 = true;
          } catch (e) {
            console.error('Failed to embed image in PDF:', img1.fileName, e.message);
          }
        }
        if (!rendered1) {
          doc.fontSize(8).font('Helvetica-Oblique').fillColor('#94a3b8')
             .text('Preview unavailable', x1 + 10, y + 70, { width: imgWidth - 20, align: 'center' });
        }
        doc.fontSize(7).font('Helvetica').fillColor('#475569')
           .text(img1.fileName, x1 + 4, y + imgHeight - 14, { width: imgWidth - 8, align: 'center', ellipsis: true });

        // Draw card 2 if exists
        if (img2) {
          const x2 = startX + imgWidth + 16;
          doc.roundedRect(x2, y, imgWidth, imgHeight, 4).lineWidth(0.5).stroke('#cbd5e1');
          let rendered2 = false;
          if (fs.existsSync(img2.localPath)) {
            try {
              doc.image(img2.localPath, x2 + 4, y + 4, {
                fit: [imgWidth - 8, imgHeight - 22],
                align: 'center',
                valign: 'center',
              });
              rendered2 = true;
            } catch (e) {
              console.error('Failed to embed image in PDF:', img2.fileName, e.message);
            }
          }
          if (!rendered2) {
            doc.fontSize(8).font('Helvetica-Oblique').fillColor('#94a3b8')
               .text('Preview unavailable', x2 + 10, y + 70, { width: imgWidth - 20, align: 'center' });
          }
          doc.fontSize(7).font('Helvetica').fillColor('#475569')
             .text(img2.fileName, x2 + 4, y + imgHeight - 14, { width: imgWidth - 8, align: 'center', ellipsis: true });
        }

        y += imgHeight + 12;
      }
    }
  }

  // Footer & Page Numbers (Multi-page pass)
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.rect(startX, 808, contentWidth, 0.5).fill('#e2e8f0');
    doc.fontSize(7).font('Helvetica').fillColor('#64748b')
       .text(
         `Generated automatically by Zydus Medical Incident Portal on ${formatDateTime(new Date())} | Confidential Quality Record`,
         startX,
         812,
         { width: contentWidth - 85 }
       );
    doc.fontSize(7).font('Helvetica-Bold').fillColor('#0f766e')
       .text(
         `Page ${i + 1} of ${range.count}`,
         startX + contentWidth - 80,
         812,
         { width: 80, align: 'right' }
       );
  }

  doc.end();
};
