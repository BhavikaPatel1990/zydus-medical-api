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

// Parse fishbone data from structured rca_data or raw text fallback
const parseFishboneData = (incident) => {
  let problem = '';
  let categories = {
    staff: [],
    procedures: [],
    equipment: [],
    environment: [],
    communication: [],
    patient: [],
  };

  const rcaData = incident.rca_data;
  if (rcaData && typeof rcaData === 'object' && rcaData.method === 'FISHBONE') {
    problem = rcaData.problem || '';
    if (rcaData.categories) {
      Object.keys(categories).forEach((key) => {
        if (Array.isArray(rcaData.categories[key])) {
          categories[key] = [...rcaData.categories[key]];
        }
      });
    }
  }

  // Fallback to text parsing from factors_which_contributed_to_the_event
  const rawText = incident.factors_which_contributed_to_the_event || '';
  if (!problem && rawText.includes('[RCA Method: Fishbone Diagram (Ishikawa)]')) {
    const probMatch = rawText.match(/(?:Problem \/ Effect|Problem Statement):\s*(.*)/i);
    if (probMatch && probMatch[1]) problem = probMatch[1].trim();

    const lines = rawText.split('\n');
    let currentCat = null;
    lines.forEach((line) => {
      const trimmed = line.trim();
      if (/^[•*-]\s*(Staff|People):/i.test(trimmed)) currentCat = 'staff';
      else if (/^[•*-]\s*(Procedures|Process|Management):/i.test(trimmed)) currentCat = 'procedures';
      else if (/^[•*-]\s*(Equipment|Materials):/i.test(trimmed)) currentCat = 'equipment';
      else if (/^[•*-]\s*(Environment):/i.test(trimmed)) currentCat = 'environment';
      else if (/^[•*-]\s*(Communication):/i.test(trimmed)) currentCat = 'communication';
      else if (/^[•*-]\s*(Patient):/i.test(trimmed)) currentCat = 'patient';
      else if (currentCat && /^[•*-]\s+(.+)/.test(trimmed)) {
        const item = trimmed.replace(/^[•*-]\s+/, '').trim();
        if (item && !categories[currentCat].includes(item)) {
          categories[currentCat].push(item);
        }
      }
    });
  }

  return { problem, categories };
};

// Parse 5 whys data from structured rca_data or raw text fallback
const parse5WhysData = (incident) => {
  let problem = '';
  let whys = ['', '', '', '', ''];
  let rootCause = '';

  const rcaData = incident.rca_data;
  if (rcaData && typeof rcaData === 'object' && rcaData.method === '5_WHYS') {
    problem = rcaData.problem || '';
    if (Array.isArray(rcaData.whys)) {
      whys = rcaData.whys.map((w) => (typeof w === 'string' ? w : w.answer || w.text || ''));
      while (whys.length < 5) whys.push('');
    } else {
      whys = [
        rcaData.why1 || '',
        rcaData.why2 || '',
        rcaData.why3 || '',
        rcaData.why4 || '',
        rcaData.why5 || '',
      ];
    }
    rootCause = rcaData.root_cause || rcaData.final_root_cause || '';
  }

  const rawText = incident.factors_which_contributed_to_the_event || '';
  if (!problem && rawText.includes('[RCA Method: 5 Whys]')) {
    const probMatch = rawText.match(/(?:Define the incident \/ Problem statement|Problem Statement):\s*(.*)/i);
    if (probMatch && probMatch[1]) problem = probMatch[1].trim();

    const rootMatch = rawText.match(/Final Root Cause Identified:\s*(.*)/i);
    if (rootMatch && rootMatch[1]) rootCause = rootMatch[1].trim();

    const lines = rawText.split('\n');
    lines.forEach((l) => {
      const match = l.match(/(?:Why did (?:this|that) happen\?\s*–\s*(\d+)|\b(\d+)\.\s*Why):\s*(.*)/i);
      if (match) {
        const idx = parseInt(match[1] || match[2], 10) - 1;
        const val = (match[3] || '').replace(/\(Root Cause\)$/i, '').trim();
        if (idx >= 0 && idx < 5) whys[idx] = val;
      }
    });
  }

  return { problem, whys, rootCause };
};

/**
 * Generate formatted Incident Report PDF with exact clinical layout and vector diagram
 */
export const generateIncidentPdf = (incident, stream, siteName = 'ZYDUS HOSPITALS') => {
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 26, bottom: 26, left: 32, right: 32 },
    bufferPages: true,
  });

  doc.pipe(stream);

  const pageWidth = 595.28;
  const contentWidth = pageWidth - 64; // 531.28
  const startX = 32;
  let y = 26;

  // Header Banner with Logo + Dynamic Site Name
  const bannerHeight = 54;
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
      doc.roundedRect(startX + 8, y + 7, 86, 40, 4).fill('#ffffff');
      doc.image(validLogoPath, startX + 12, y + 9, { fit: [78, 36], align: 'center', valign: 'center' });
      textStartX = startX + 104;
    } catch (e) {
      console.error('Failed to draw logo in PDF:', e.message);
    }
  }

  // Header Titles
  const displaySite = String(siteName || 'ZYDUS HOSPITALS').toUpperCase();
  doc.fillColor('#ffffff').fontSize(12).font('Helvetica-Bold')
     .text(displaySite, textStartX, y + 10, { width: contentWidth - (textStartX - startX) - 140 });
  doc.fontSize(8).font('Helvetica-Bold').fillColor('#ccfbf1')
     .text('INCIDENTS OCCURRENCE REPORTING SYSTEM', textStartX, y + 27);

  // Reference and Status Badges on right side of banner
  doc.fontSize(9.5).font('Helvetica-Bold').fillColor('#ffffff')
     .text(`REF: ${incident.incident_no}`, startX + contentWidth - 145, y + 10, { align: 'right', width: 135 });
  const statusText = (incident.status || 'FINAL_APPROVED').replace(/_/g, ' ');
  doc.fontSize(8.5).font('Helvetica-Bold').fillColor('#fef08a')
     .text(`STATUS: ${statusText}`, startX + contentWidth - 145, y + 26, { align: 'right', width: 135 });

  y += bannerHeight + 10;

  // Safe space helper preventing empty page creation
  const ensurePageSpace = (neededHeight) => {
    if (y > 35 && y + neededHeight > 780) {
      doc.addPage();
      y = 30;
      return true;
    }
    return false;
  };

  const drawSection = (title) => {
    ensurePageSpace(30);
    doc.rect(startX, y, contentWidth, 18).fill('#f0fdfa');
    doc.rect(startX, y, 4, 18).fill('#0f766e');
    doc.fillColor('#0f766e').fontSize(8.5).font('Helvetica-Bold')
       .text(title.toUpperCase(), startX + 8, y + 4.5);
    y += 22;
  };

  const drawGridRow = (l1, v1, l2, v2, isAlt = false) => {
    const val1 = (v1 === null || v1 === undefined || v1 === '') ? 'N/A' : String(v1);
    const val2 = (v2 === null || v2 === undefined || v2 === '') ? 'N/A' : String(v2);

    const col1LabelW = 120;
    const col1ValW = l2 ? 145 : (contentWidth - col1LabelW);
    const col2LabelW = 120;
    const col2ValW = 146;

    doc.fontSize(7.5).font('Helvetica');
    const h1 = doc.heightOfString(val1, { width: col1ValW - 8 });
    const h2 = l2 ? doc.heightOfString(val2, { width: col2ValW - 8 }) : 0;
    const rowHeight = Math.max(h1, h2, 12) + 5;

    ensurePageSpace(rowHeight);

    if (isAlt) {
      doc.rect(startX, y, contentWidth, rowHeight).fill('#f8fafc');
    }

    doc.fontSize(7.5).font('Helvetica-Bold').fillColor('#64748b').text(l1, startX + 4, y + 2.5, { width: col1LabelW - 6 });
    doc.font('Helvetica').fillColor('#0f172a').text(val1, startX + col1LabelW, y + 2.5, { width: col1ValW - 8 });

    if (l2) {
      const col2X = startX + col1LabelW + col1ValW;
      doc.font('Helvetica-Bold').fillColor('#64748b').text(l2, col2X + 4, y + 2.5, { width: col2LabelW - 6 });
      doc.font('Helvetica').fillColor('#0f172a').text(val2, col2X + col2LabelW, y + 2.5, { width: col2ValW - 8 });
    }

    doc.rect(startX, y + rowHeight - 0.5, contentWidth, 0.5).fill('#e2e8f0');
    y += rowHeight;
  };

  const drawCalloutBlock = (label, text, badge = null) => {
    const content = text && String(text).trim() ? String(text).trim() : 'None specified.';
    doc.fontSize(7.5).font('Helvetica');
    const textHeight = doc.heightOfString(content, { width: contentWidth - 16, align: 'left' });
    const blockHeight = 16 + textHeight + 6;

    ensurePageSpace(blockHeight);

    doc.roundedRect(startX, y, contentWidth, blockHeight, 3).fillAndStroke('#f8fafc', '#e2e8f0');
    doc.fontSize(7.5).font('Helvetica-Bold').fillColor('#334155').text(label, startX + 8, y + 4);
    if (badge) {
      doc.fontSize(7).font('Helvetica-Bold').fillColor('#0f766e').text(badge, startX + contentWidth - 120, y + 4, { width: 112, align: 'right' });
    }

    doc.font('Helvetica').fillColor('#0f172a').text(content, startX + 8, y + 16, { width: contentWidth - 16 });
    y += blockHeight + 5;
  };

  // =========================================================================
  // PAGE 1: INCIDENT & PATIENT DETAILS, CATEGORIES & NARRATIVE
  // =========================================================================
  drawSection('1. Incident & Patient Details');
  drawGridRow('Type of Incident:', incident.type_of_incident?.join(', '), 'Sub Type of Incident:', incident.sub_type_of_incident?.join(', '), false);
  drawGridRow('Patient Name:', incident.name, 'MR No:', incident.cr_no, true);
  drawGridRow(
    'Date & Time of Incident:',
    `${formatDate(incident.date_of_incident)} ${incident.time_of_incident || ''}`,
    'Date & Time of Reporting:',
    `${formatDate(incident.date_of_reporting)} ${incident.time_of_reporting || ''}`,
    false
  );
  drawGridRow('Emp ID (If Applicable):', incident.emp_id, 'Procedure / Surgery Done:', incident.procedure_surgery_done, true);
  drawGridRow('Location / Ward:', incident.location, 'Responsible Person:', incident.responsible_person, false);

  const hodListDisplay = (incident.assigned_hod_names && incident.assigned_hod_names.length > 0)
    ? incident.assigned_hod_names.join(', ')
    : `${incident.assigned_hod_name || ''} (${incident.assign_incident_report || ''})`;
  drawGridRow('Assigned Lead(s):', hodListDisplay, 'Treating Consultant:', incident.name_of_treating_counsultant, true);
  y += 4;

  drawSection('2. Details (Severity & Notification)');
  drawGridRow('Severity of Injury:', incident.severity_of_injury?.join(', '), 'Management Notification:', incident.management_notification?.join(', '), false);
  drawGridRow('Person Notified:', incident.person_notified?.join(', '), 'Other Remark:', incident.other_remark || 'None', true);
  y += 4;

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
    drawGridRow('Selected Categories:', 'None selected', null, null, false);
  } else {
    for (let i = 0; i < cats.length; i += 2) {
      const c1 = cats[i];
      const c2 = cats[i + 1];
      drawGridRow(c1.label, c1.val.join(', '), c2?.label, c2?.val.join(', '), (i / 2) % 2 === 1);
    }
  }
  y += 4;

  drawSection('4. Narrative & Clinical Investigation');
  drawCalloutBlock('Details of Incident (Describe how incident happened):', incident.details_of_incident);
  drawCalloutBlock('Complication or Adverse Effect (if any):', incident.complication_or_adverse_effect);
  drawCalloutBlock('Treatment (If Required):', incident.treatment);

  // =========================================================================
  // PAGE 2: ROOT CAUSE ANALYSIS (RCA) - DEDICATED FULL DIAGRAM & FACTORS
  // =========================================================================
  doc.addPage();
  y = 28;

  doc.rect(startX, y, contentWidth, 22).fill('#0f766e');
  doc.fillColor('#ffffff').fontSize(9).font('Helvetica-Bold')
     .text('5. ROOT CAUSE ANALYSIS (RCA) – CLINICAL INVESTIGATION FRAMEWORK', startX + 10, y + 6);
  doc.fontSize(8).font('Helvetica-Bold').fillColor('#ccfbf1')
     .text(`REF: ${incident.incident_no}`, startX + contentWidth - 145, y + 6, { align: 'right', width: 135 });
  y += 28;

  const isFishbone = incident.rca_method === 'FISHBONE' ||
    incident.rca_data?.method === 'FISHBONE' ||
    (incident.factors_which_contributed_to_the_event && incident.factors_which_contributed_to_the_event.includes('[RCA Method: Fishbone Diagram (Ishikawa)]'));

  const is5Whys = !isFishbone && (
    incident.rca_method === '5_WHYS' ||
    incident.rca_data?.method === '5_WHYS' ||
    (incident.factors_which_contributed_to_the_event && incident.factors_which_contributed_to_the_event.includes('[RCA Method: 5 Whys]'))
  );

  if (isFishbone) {
    const { problem: fbProblem, categories: fbCats } = parseFishboneData(incident);
    const effectiveProblem = fbProblem || 'Patient Safety Event';
    const totalCauses = Object.values(fbCats).reduce((acc, list) => acc + (list ? list.length : 0), 0);

    // --- FULL FISHBONE VECTOR DIAGRAM (HEIGHT 280) ---
    const diagramCardH = 280;
    const diagX = startX;
    const diagY = y;
    const diagW = contentWidth;

    // Outer card container
    doc.roundedRect(diagX, diagY, diagW, diagramCardH, 6)
       .fillAndStroke('#f8fafc', '#cbd5e1');

    // Diagram Title
    doc.fontSize(9.5).font('Helvetica-Bold').fillColor('#0f766e')
       .text('ROOT CAUSE ANALYSIS (FISHBONE DIAGRAM)', diagX, diagY + 8, { width: diagW, align: 'center' });
    doc.fontSize(7.5).font('Helvetica').fillColor('#64748b')
       .text('Patient Safety Event – Contributing Factors by Clinical Domain', diagX, diagY + 21, { width: diagW, align: 'center' });

    // Center spine coordinates
    const spineY = diagY + 145;
    const spineStartX = diagX + 14;
    const spineEndX = diagX + 372;

    // Horizontal spine line
    doc.lineWidth(2.5).strokeColor('#1e3a8a')
       .moveTo(spineStartX, spineY)
       .lineTo(spineEndX, spineY)
       .stroke();

    // Solid Arrow Head pointing right into the Fish Head
    doc.polygon(
      [spineEndX - 1, spineY - 8],
      [spineEndX + 11, spineY],
      [spineEndX - 1, spineY + 8]
    ).fill('#1e3a8a');

    // Right Fish Head Box (Problem / Effect)
    const headX = diagX + 386;
    const headY = spineY - 56;
    const headW = diagW - (headX - diagX) - 10;
    const headH = 112;

    doc.roundedRect(headX, headY, headW, headH, 6)
       .lineWidth(1.5).fillAndStroke('#eff6ff', '#1d4ed8');

    doc.roundedRect(headX + 4, headY + 5, headW - 8, 16, 3).fill('#dbeafe');
    doc.fontSize(7).font('Helvetica-Bold').fillColor('#1e40af')
       .text('INCIDENT / EFFECT', headX + 4, headY + 9.5, { width: headW - 8, align: 'center' });

    doc.fontSize(6.5).font('Helvetica-Bold').fillColor('#0f172a')
       .text(effectiveProblem, headX + 6, headY + 26, { width: headW - 12, align: 'center', height: 80, ellipsis: true });

    // --- 6 Category Boxes, Slanted Ribs & Factors on Diagram ---
    const topBoxY = diagY + 34;
    const botBoxY = diagY + diagramCardH - 34;
    const boxW = 86;
    const boxH = 18;

    const ribCols = [
      { id: 'staff', label: 'Staff', top: true, boxX: diagX + 20, ribSpineX: diagX + 118 },
      { id: 'procedures', label: 'Procedures', top: true, boxX: diagX + 142, ribSpineX: diagX + 236 },
      { id: 'equipment', label: 'Equipment', top: true, boxX: diagX + 264, ribSpineX: diagX + 346 },
      { id: 'environment', label: 'Environment', top: false, boxX: diagX + 20, ribSpineX: diagX + 118 },
      { id: 'communication', label: 'Communication', top: false, boxX: diagX + 142, ribSpineX: diagX + 236 },
      { id: 'patient', label: 'Patient', top: false, boxX: diagX + 264, ribSpineX: diagX + 346 },
    ];

    ribCols.forEach((col) => {
      const boxCenterX = col.boxX + boxW / 2;
      const bY = col.top ? topBoxY : botBoxY;

      // Draw Slanted Rib Line
      doc.lineWidth(1.8).strokeColor('#1e3a8a');
      if (col.top) {
        doc.moveTo(boxCenterX, bY + boxH).lineTo(col.ribSpineX, spineY).stroke();
      } else {
        doc.moveTo(boxCenterX, bY).lineTo(col.ribSpineX, spineY).stroke();
      }

      // Joint circle on spine
      doc.circle(col.ribSpineX, spineY, 2.5).fill('#1e3a8a');

      // Category Box
      doc.roundedRect(col.boxX, bY, boxW, boxH, 4)
         .lineWidth(1.2).fillAndStroke('#ffffff', '#1e3a8a');
      doc.fontSize(7.5).font('Helvetica-Bold').fillColor('#1e3a8a')
         .text(col.label, col.boxX, bY + 4.5, { width: boxW, align: 'center' });

      // Draw causes directly along the rib
      const causes = fbCats[col.id] || [];
      const branchFractions = [0.24, 0.52, 0.78];

      causes.slice(0, 3).forEach((cause, idx) => {
        const frac = branchFractions[idx] || (0.25 + idx * 0.25);
        let ptX, ptY;
        if (col.top) {
          ptX = boxCenterX + frac * (col.ribSpineX - boxCenterX);
          ptY = (bY + boxH) + frac * (spineY - (bY + boxH));
        } else {
          ptX = boxCenterX + frac * (col.ribSpineX - boxCenterX);
          ptY = bY - frac * (bY - spineY);
        }

        const tagW = 86;
        const tagH = 11;
        const tagX = ptX - tagW + 4;
        const tagY = col.top ? ptY - tagH + 2 : ptY - 2;

        doc.lineWidth(0.8).strokeColor('#93c5fd')
           .moveTo(tagX, ptY)
           .lineTo(ptX, ptY)
           .stroke();

        doc.roundedRect(tagX, tagY, tagW, tagH, 2)
           .lineWidth(0.5).fillAndStroke('#ffffff', '#bfdbfe');

        doc.fontSize(5.2).font('Helvetica-Bold').fillColor('#1e3a8a')
           .text(cause, tagX + 2, tagY + 2.5, { width: tagW - 4, ellipsis: true });
      });
    });

    y += diagramCardH + 10;

    // --- CONTRIBUTING CAUSES BY DOMAIN (CARD GRID) ---
    doc.fontSize(8.5).font('Helvetica-Bold').fillColor('#0f766e')
       .text(`CONTRIBUTING CAUSES BY DOMAIN (${totalCauses} Factors Active on Diagram):`, startX, y);
    y += 12;

    const domainW = (contentWidth - 16) / 3;
    const domainCols = [
      [
        { id: 'staff', label: 'Staff' },
        { id: 'environment', label: 'Environment' }
      ],
      [
        { id: 'procedures', label: 'Procedures' },
        { id: 'communication', label: 'Communication' }
      ],
      [
        { id: 'equipment', label: 'Equipment' },
        { id: 'patient', label: 'Patient' }
      ]
    ];

    let maxGridHeight = 0;
    const startGridY = y;

    for (let cIdx = 0; cIdx < 3; cIdx++) {
      let curY = startGridY;
      const cardX = startX + cIdx * (domainW + 8);

      for (const catInfo of domainCols[cIdx]) {
        const causes = fbCats[catInfo.id] || [];
        const cardH = 20 + Math.max(causes.length, 1) * 14 + 6;

        doc.roundedRect(cardX, curY, domainW, cardH, 4).fillAndStroke('#ffffff', '#cbd5e1');

        doc.rect(cardX, curY, domainW, 16).fill('#f1f5f9');
        doc.fontSize(7).font('Helvetica-Bold').fillColor('#1e293b')
           .text(catInfo.label, cardX + 6, curY + 4, { width: domainW - 40 });
        doc.fontSize(6.5).font('Helvetica-Bold').fillColor('#0f766e')
           .text(`${causes.length} causes`, cardX + domainW - 45, curY + 4, { width: 40, align: 'right' });

        let listY = curY + 20;
        if (causes.length === 0) {
          doc.fontSize(6.5).font('Helvetica-Oblique').fillColor('#94a3b8')
             .text('No causes selected', cardX + 8, listY);
        } else {
          causes.forEach((cause) => {
            doc.roundedRect(cardX + 6, listY + 1, 8, 8, 2).lineWidth(0.8).strokeColor('#10b981').stroke();
            doc.lineWidth(1).strokeColor('#10b981')
               .moveTo(cardX + 7.5, listY + 5)
               .lineTo(cardX + 9.5, listY + 7.2)
               .lineTo(cardX + 12.5, listY + 2.8)
               .stroke();

            doc.font('Helvetica').fontSize(6.5).fillColor('#1e293b')
               .text(cause, cardX + 18, listY + 1, { width: domainW - 24 });
            listY += 14;
          });
        }

        curY += cardH + 6;
      }
      if (curY - startGridY > maxGridHeight) {
        maxGridHeight = curY - startGridY;
      }
    }
    y += maxGridHeight + 10;

  } else if (is5Whys) {
    const { problem: whysProblem, whys, rootCause } = parse5WhysData(incident);
    const effectiveProblem = whysProblem || 'Patient Safety Event';

    doc.roundedRect(startX, y, contentWidth, 30, 4).fillAndStroke('#f0fdfa', '#0f766e');
    doc.fontSize(7.5).font('Helvetica-Bold').fillColor('#0f766e').text('PROBLEM STATEMENT / INCIDENT DEFINITION:', startX + 8, y + 5);
    doc.fontSize(8).font('Helvetica').fillColor('#0f172a').text(effectiveProblem, startX + 8, y + 16, { width: contentWidth - 16, ellipsis: true });
    y += 38;

    whys.forEach((answer, idx) => {
      const qText = idx === 0 ? 'Why did this happen? – 1' : `Why did that happen? – ${idx + 1}`;
      const ansText = answer && answer.trim() ? answer.trim() : 'No response entered.';

      doc.roundedRect(startX, y, contentWidth, 24, 4).fillAndStroke('#ffffff', '#cbd5e1');
      doc.fontSize(7.5).font('Helvetica-Bold').fillColor('#0f766e').text(qText, startX + 8, y + 6, { width: 140 });
      doc.fontSize(8).font('Helvetica').fillColor('#1e293b').text(ansText, startX + 150, y + 6, { width: contentWidth - 160, ellipsis: true });
      y += 28;
    });

    y += 6;
    const rcText = rootCause && rootCause.trim() ? rootCause.trim() : 'Under final determination.';
    doc.roundedRect(startX, y, contentWidth, 32, 4).fillAndStroke('#f0fdf4', '#16a34a');
    doc.fontSize(8).font('Helvetica-Bold').fillColor('#15803d').text('★ FINAL ROOT CAUSE IDENTIFIED:', startX + 8, y + 5);
    doc.fontSize(8.5).font('Helvetica-Bold').fillColor('#0f172a').text(rcText, startX + 8, y + 17, { width: contentWidth - 16, ellipsis: true });
    y += 40;

  } else {
    drawCalloutBlock('Root Cause Analysis (Factors Which Contributed to The Event):', incident.factors_which_contributed_to_the_event);
  }

  // Section 6: Corrective & Preventive Action Plan (CAPA)
  drawSection('6. Corrective & Preventive Action Plan (CAPA)');
  drawCalloutBlock('How Could the Event Have Been Prevented:', incident.how_could_the_event_have_been_prevented);
  drawCalloutBlock('Comment/Action Suggested (Corrective Action):', incident.corrective_action, 'Immediate Action');
  drawCalloutBlock('Preventive Action (Systemic / Policy):', incident.preventive_action, 'Long-term Prevention');
  y += 4;

  // Section 7: Digital Audit & Timeline (Created, Submitted, Approved)
  drawSection('7. Timeline, Review & Final Approval');
  const createdDateStr = incident.date_of_reporting
    ? `${formatDate(incident.date_of_reporting)} ${incident.time_of_reporting || ''}`
    : (incident.created_at ? formatDateTime(incident.created_at) : 'N/A');
  drawGridRow('Incident Created Date:', createdDateStr, 'Reported By:', `${incident.reporter_name} (${incident.reporter_emp_id})`, false);

  const hodSubmitter = incident.hod_submitted_by_name
    ? `${incident.hod_submitted_by_name} (${incident.hod_submitted_by_emp_id || ''})`
    : (incident.hod_submitted_at ? 'Lead' : 'Pending');
  const hodSubmittedDateStr = incident.hod_submitted_at ? formatDateTime(incident.hod_submitted_at) : 'Pending Submission';
  drawGridRow('Investigation Submitted Date:', hodSubmittedDateStr, 'Submitted By Lead:', hodSubmitter, true);
  if (incident.hod_remarks) {
    drawGridRow('Lead Closing Remarks:', incident.hod_remarks, null, null, false);
  }

  const approverName = incident.final_approver_name
    ? `${incident.final_approver_name} (${incident.final_approver_emp_id || ''})`
    : 'Pending Approval';
  const approvalDateStr = incident.final_approval_date
    ? formatDateTime(incident.final_approval_date)
    : (incident.status === 'FINAL_APPROVED' && incident.updated_at ? formatDateTime(incident.updated_at) : 'Pending Approval');
  drawGridRow('Approved Date:', approvalDateStr, 'Approved By:', approverName, false);
  if (incident.final_remarks) {
    drawGridRow('Quality Approver Remarks:', incident.final_remarks, null, null, true);
  }

  // =========================================================================
  // PAGE 3 (ONLY IF EVIDENCE FILES OR IMAGES EXIST)
  // =========================================================================
  const rawImages = Array.isArray(incident.images) ? incident.images : [];
  if (rawImages.length > 0) {
    doc.addPage();
    y = 28;

    doc.rect(startX, y, contentWidth, 22).fill('#0f766e');
    doc.fillColor('#ffffff').fontSize(9).font('Helvetica-Bold')
       .text('8. ATTACHED INCIDENT EVIDENCE & FILES', startX + 10, y + 6);
    doc.fontSize(8).font('Helvetica-Bold').fillColor('#ccfbf1')
       .text(`REF: ${incident.incident_no}`, startX + contentWidth - 145, y + 6, { align: 'right', width: 135 });
    y += 28;

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

    if (documentFiles.length > 0) {
      doc.fontSize(8.5).font('Helvetica-Bold').fillColor('#334155')
         .text('Attached PDF Documents / Evidence Files:', startX, y);
      y += 14;

      for (const docFile of documentFiles) {
        doc.fontSize(8).font('Helvetica-Bold').fillColor('#b91c1c').text('• [PDF DOCUMENT]', startX + 8, y, { continued: true });
        doc.font('Helvetica').fillColor('#0f172a').text(`  ${docFile.fileName}  — Available on Portal`);
        y += 15;
      }
      y += 8;
    }

    if (imageFiles.length > 0) {
      doc.fontSize(8.5).font('Helvetica-Bold').fillColor('#334155')
         .text(`Attached Photographic Evidence (${imageFiles.length} Image(s)):`, startX, y);
      y += 14;

      const imgWidth = (contentWidth - 16) / 2;
      const imgHeight = 160;

      for (let i = 0; i < imageFiles.length; i += 2) {
        ensurePageSpace(imgHeight + 16);

        const img1 = imageFiles[i];
        const img2 = imageFiles[i + 1];

        // Card 1
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
          doc.fontSize(7.5).font('Helvetica-Oblique').fillColor('#94a3b8')
             .text('Preview unavailable', x1 + 10, y + 65, { width: imgWidth - 20, align: 'center' });
        }
        doc.fontSize(7).font('Helvetica').fillColor('#475569')
           .text(img1.fileName, x1 + 4, y + imgHeight - 14, { width: imgWidth - 8, align: 'center', ellipsis: true });

        // Card 2
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
            doc.fontSize(7.5).font('Helvetica-Oblique').fillColor('#94a3b8')
               .text('Preview unavailable', x2 + 10, y + 65, { width: imgWidth - 20, align: 'center' });
          }
          doc.fontSize(7).font('Helvetica').fillColor('#475569')
             .text(img2.fileName, x2 + 4, y + imgHeight - 14, { width: imgWidth - 8, align: 'center', ellipsis: true });
        }

        y += imgHeight + 10;
      }
    }
  }

  // =========================================================================
  // FOOTER & EXACT PAGE NUMBERS (Multi-page pass without accidental page additions)
  // =========================================================================
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const prevBottomMargin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0; // Prevent PDFKit from adding extra blank pages during footer write

    doc.rect(startX, 816, contentWidth, 0.5).fill('#cbd5e1');
    doc.fontSize(7).font('Helvetica').fillColor('#64748b')
       .text(
         `Generated automatically by Zydus Medical Incident Portal on ${formatDateTime(new Date())} | Confidential Quality Record`,
         startX,
         820,
         { width: contentWidth - 85, lineBreak: false }
       );
    doc.fontSize(7).font('Helvetica-Bold').fillColor('#0f766e')
       .text(
         `Page ${i + 1} of ${range.count}`,
         startX + contentWidth - 80,
         820,
         { width: 80, align: 'right', lineBreak: false }
       );

    doc.page.margins.bottom = prevBottomMargin;
  }

  doc.end();
};
