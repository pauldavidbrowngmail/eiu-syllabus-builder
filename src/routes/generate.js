'use strict';
const express  = require('express');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, BorderStyle, WidthType, ShadingType,
  PageNumber, Header, Footer, LevelFormat, PageBreak
} = require('docx');
const { execSync } = require('child_process');
const fs   = require('fs');
const path = require('path');
const os   = require('os');
const router = express.Router();

// ── Colours ──────────────────────────────────────────────────────────────────
const EIU_BLUE = '002D5A';
const EIU_GOLD = 'C8962C';
const LIGHT_BG = 'E8F0F7';

// ── Helpers ──────────────────────────────────────────────────────────────────
const cellBorder = (color = 'CCCCCC') => ({
  top:    { style: BorderStyle.SINGLE, size: 1, color },
  bottom: { style: BorderStyle.SINGLE, size: 1, color },
  left:   { style: BorderStyle.SINGLE, size: 1, color },
  right:  { style: BorderStyle.SINGLE, size: 1, color },
});

function rule() {
  return new Paragraph({
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: EIU_BLUE, space: 1 } },
    spacing: { after: 160 }
  });
}

function sectionHeading(text) {
  return new Paragraph({
    children: [new TextRun({ text, bold: true, size: 26, color: EIU_BLUE, font: 'Arial' })],
    spacing: { before: 300, after: 80 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: EIU_GOLD, space: 1 } }
  });
}

function body(text, extra = {}) {
  return new Paragraph({
    children: [new TextRun({ text: text || '', size: 22, font: 'Arial', ...extra })],
    spacing: { after: 100 }
  });
}

function subHeading(text) {
  return new Paragraph({
    children: [new TextRun({ text, bold: true, size: 22, font: 'Arial' })],
    spacing: { before: 140, after: 60 }
  });
}

function bulletItem(text) {
  return new Paragraph({
    numbering: { reference: 'bullets', level: 0 },
    children: [new TextRun({ text: text || '', size: 22, font: 'Arial' })],
    spacing: { after: 60 }
  });
}

function infoRow(label, value) {
  const borders = cellBorder();
  return new TableRow({
    children: [
      new TableCell({
        borders, width: { size: 2200, type: WidthType.DXA },
        shading: { fill: LIGHT_BG, type: ShadingType.CLEAR },
        margins: { top: 80, bottom: 80, left: 120, right: 120 },
        children: [new Paragraph({ children: [new TextRun({ text: label, bold: true, size: 20, font: 'Arial', color: EIU_BLUE })] })]
      }),
      new TableCell({
        borders, width: { size: 7160, type: WidthType.DXA },
        margins: { top: 80, bottom: 80, left: 120, right: 120 },
        children: [new Paragraph({ children: [new TextRun({ text: value || '—', size: 20, font: 'Arial' })] })]
      })
    ]
  });
}

function infoTable(rows) {
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [2200, 7160],
    rows: rows.map(([l, v]) => infoRow(l, v))
  });
}

function gradingTable(weights) {
  const borders = cellBorder();
  const headerShade = { fill: EIU_BLUE, type: ShadingType.CLEAR };
  const widths = [3500, 1800, 4060];
  const headers = ['Component', 'Weight', 'Notes'];

  const headerRow = new TableRow({
    tableHeader: true,
    children: headers.map((h, i) => new TableCell({
      borders, shading: headerShade,
      width: { size: widths[i], type: WidthType.DXA },
      margins: { top: 80, bottom: 80, left: 120, right: 120 },
      children: [new Paragraph({ children: [new TextRun({ text: h, bold: true, size: 20, font: 'Arial', color: 'FFFFFF' })] })]
    }))
  });

  const dataRows = (weights || []).map(w => new TableRow({
    children: [
      new TableCell({ borders, width: { size: 3500, type: WidthType.DXA }, margins: { top: 60, bottom: 60, left: 120, right: 120 }, children: [new Paragraph({ children: [new TextRun({ text: w.component || '', size: 20, font: 'Arial' })] })] }),
      new TableCell({ borders, width: { size: 1800, type: WidthType.DXA }, margins: { top: 60, bottom: 60, left: 120, right: 120 }, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: w.weight || '', size: 20, font: 'Arial' })] })] }),
      new TableCell({ borders, width: { size: 4060, type: WidthType.DXA }, margins: { top: 60, bottom: 60, left: 120, right: 120 }, children: [new Paragraph({ children: [new TextRun({ text: w.notes || '', size: 20, font: 'Arial' })] })] }),
    ]
  }));

  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [3500, 1800, 4060],
    rows: [headerRow, ...dataRows]
  });
}

// ── Boilerplate blocks ────────────────────────────────────────────────────────
const BOILERPLATE = [
  {
    title: 'Academic Integrity',
    text: 'Eastern Illinois University is committed to academic integrity and expects all students to demonstrate honesty in their academic work. Students who engage in academic dishonesty — including cheating, plagiarism, fabrication, or facilitating dishonesty — may receive a failing grade on the assignment or in the course and may be referred to the Office of Student Standards. See the EIU Student Handbook for complete definitions and procedures.'
  },
  {
    title: 'Americans with Disabilities Act (ADA) / Accessibility',
    text: 'Eastern Illinois University is committed to providing equal educational opportunity for all students. Students with disabilities who require accommodations should contact Student Accessibility Services (SAS), 1620 Old Main, (217) 581-6583, and provide documentation to the instructor at the beginning of the semester. For more information, visit eiu.edu/accessibilitysupport.'
  },
  {
    title: 'Non-Discrimination and Anti-Harassment',
    text: 'EIU prohibits discrimination and harassment based on race, color, religion, sex, national origin, age, disability, genetic information, veteran status, sexual orientation, or gender identity. Concerns may be directed to the Office of Civil Rights and Diversity, 1204 Old Main, (217) 581-5020.'
  },
  {
    title: 'Title IX / Sexual Misconduct',
    text: 'EIU does not tolerate sexual harassment, sexual assault, domestic violence, dating violence, or stalking. Students who experience or witness these behaviors are encouraged to report to the Title IX Coordinator in 1204 Old Main or visit eiu.edu/titleix. Confidential support is available through Health and Counseling Services.'
  },
  {
    title: 'D2L Brightspace',
    text: 'Course materials, announcements, grades, and supplemental resources are maintained in D2L Brightspace (eiu.edu/d2l). Students are responsible for checking D2L regularly. Technical support is available through ITS at (217) 581-4357 or its.eiu.edu.'
  },
  {
    title: 'Emergency Preparedness',
    text: 'In the event of an emergency, follow the instructions of university personnel. Emergency notification information is available at eiu.edu/alerteiu. The university uses the ALERTEIU system to communicate urgent campus information via email, text, and phone.'
  }
];

// ── Build docx buffer ─────────────────────────────────────────────────────────
async function buildDocx(d) {
  const doc = new Document({
    numbering: {
      config: [{
        reference: 'bullets',
        levels: [{ level: 0, format: LevelFormat.BULLET, text: '•',
          alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } } }]
      }]
    },
    styles: {
      default: { document: { run: { font: 'Arial', size: 22 } } }
    },
    sections: [{
      properties: {
        page: {
          size: { width: 12240, height: 15840 },
          margin: { top: 1080, right: 1260, bottom: 1080, left: 1260 }
        }
      },
      headers: {
        default: new Header({
          children: [new Paragraph({
            children: [new TextRun({
              text: `${d.courseId} ${d.courseTitle}  |  ${d.term}`,
              size: 18, font: 'Arial', color: 'FFFFFF'
            })],
            shading: { fill: EIU_BLUE, type: ShadingType.CLEAR },
            spacing: { before: 80, after: 80 },
            indent: { left: 120, right: 120 }
          })]
        })
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({ text: 'Eastern Illinois University  |  Lumpkin College of Business & Technology  |  Page ', size: 16, font: 'Arial', color: '888888' }),
              new TextRun({ children: [PageNumber.CURRENT], size: 16, font: 'Arial', color: '888888' }),
              new TextRun({ text: ' of ', size: 16, font: 'Arial', color: '888888' }),
              new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 16, font: 'Arial', color: '888888' }),
            ]
          })]
        })
      },
      children: [
        // Title block
        new Paragraph({ children: [new TextRun({ text: 'Course Syllabus', bold: true, size: 48, font: 'Arial', color: EIU_BLUE })], alignment: AlignmentType.CENTER, spacing: { after: 60 } }),
        new Paragraph({ children: [new TextRun({ text: `${d.courseId}: ${d.courseTitle}`, bold: true, size: 36, font: 'Arial', color: '333333' })], alignment: AlignmentType.CENTER, spacing: { after: 40 } }),
        new Paragraph({ children: [new TextRun({ text: `${d.term}  ·  ${d.credits}`, size: 24, font: 'Arial', color: EIU_GOLD })], alignment: AlignmentType.CENTER, spacing: { after: 20 } }),
        new Paragraph({ children: [new TextRun({ text: 'Lumpkin College of Business & Technology  |  Eastern Illinois University', size: 20, font: 'Arial', color: '666666' })], alignment: AlignmentType.CENTER, spacing: { after: 240 } }),
        rule(),

        // Course info
        sectionHeading('Course Information'),
        infoTable([
          ['CRN', d.crn], ['Section', d.section], ['Meeting Days & Times', d.meetTime],
          ['Location', d.room], ['Term Dates', d.termDates], ['Credit Hours', d.credits]
        ]),
        new Paragraph({ spacing: { after: 240 } }),

        // Instructor info
        sectionHeading('Instructor Information'),
        infoTable([
          ['Instructor', d.instructor], ['Email', d.email],
          ['Office', d.office], ['Office Hours', d.officeHours]
        ]),
        new Paragraph({ spacing: { after: 240 } }),

        // Description
        sectionHeading('Course Description'),
        body(d.description),
        new Paragraph({ spacing: { after: 80 } }),
        new Paragraph({ children: [new TextRun({ text: 'Prerequisites: ', bold: true, size: 22, font: 'Arial' }), new TextRun({ text: d.prereq || 'None', size: 22, font: 'Arial' })], spacing: { after: 200 } }),

        // Textbooks
        sectionHeading('Required Textbook(s)'),
        ...(d.textbooks?.length
          ? d.textbooks.map(tb => new Paragraph({ children: [new TextRun({ text: tb.title, bold: true, size: 22, font: 'Arial' }), new TextRun({ text: `  —  ${tb.author}`, size: 22, font: 'Arial' })], spacing: { after: 80 } }))
          : [body('No textbook required. Materials will be provided in D2L Brightspace.')]
        ),
        new Paragraph({ children: [new TextRun({ text: 'Note: Textbooks are available through EIU Textbook Rental Service (975 Edgar Drive) at no additional cost.', size: 20, font: 'Arial', color: '555555', italics: true })], spacing: { after: 200 } }),

        // Learning objectives
        sectionHeading('Course Learning Objectives'),
        body('Upon successful completion of this course, students will be able to:'),
        ...(d.courseObjectives || []).map(bulletItem),
        new Paragraph({ spacing: { after: 200 } }),

        // Grading
        sectionHeading('Grading'),
        gradingTable(d.gradingWeights),
        new Paragraph({ spacing: { after: 120 } }),
        sectionHeading('Grading Scale'),
        body(d.gradingScale || 'A: 93–100  |  A–: 90–92  |  B+: 87–89  |  B: 83–86  |  B–: 80–82  |  C: 70–76  |  D: 60–69  |  F: below 60'),
        new Paragraph({ spacing: { after: 200 } }),

        // Policies
        sectionHeading('Course Policies'),
        subHeading('Attendance'),
        body(d.attendancePolicy || 'Regular attendance is expected.'),
        subHeading('Late / Missed Work'),
        body(d.latePolicy || 'Late assignments will be penalized 10% per calendar day.'),
        subHeading('Artificial Intelligence (AI) Use'),
        body(d.aiPolicy || 'Use of AI writing tools is permitted for brainstorming and editing only.'),
        new Paragraph({ spacing: { after: 200 } }),

        // Topics
        sectionHeading('Course Topics / Tentative Schedule'),
        body('The instructor reserves the right to adjust topics as needed. Changes will be posted to D2L Brightspace.'),
        ...(d.courseTopics || []).map(bulletItem),
        new Paragraph({ spacing: { after: 240 } }),

        // Institutional boilerplate
        new Paragraph({ children: [new TextRun({ text: 'University Policies', bold: true, size: 30, font: 'Arial', color: EIU_BLUE })], spacing: { before: 300, after: 160 }, border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: EIU_GOLD, space: 1 } } }),
        ...BOILERPLATE.flatMap(bp => [
          new Paragraph({ children: [new TextRun({ text: bp.title, bold: true, size: 22, font: 'Arial', color: EIU_BLUE })], spacing: { before: 160, after: 60 } }),
          body(bp.text)
        ]),
        new Paragraph({ spacing: { after: 240 } }),

        // Disclaimer
        new Paragraph({
          children: [new TextRun({ text: 'This syllabus is subject to change. Any modifications will be announced in class and updated in D2L Brightspace. It is the student\'s responsibility to stay informed of any changes.', size: 18, font: 'Arial', color: '777777', italics: true })],
          alignment: AlignmentType.CENTER,
          border: { top: { style: BorderStyle.SINGLE, size: 2, color: 'CCCCCC', space: 1 } },
          spacing: { before: 120, after: 0 }
        }),
      ]
    }]
  });

  return Packer.toBuffer(doc);
}

// ── POST /api/generate ────────────────────────────────────────────────────────
// Body: full syllabus data object
// Query: ?format=docx|pdf|both (default: both)
router.post('/', async (req, res) => {
  const data   = req.body;
  const format = req.query.format || 'both';

  if (!data?.courseId || !data?.courseTitle) {
    return res.status(400).json({ error: 'courseId and courseTitle are required' });
  }

  const tmpDir  = fs.mkdtempSync(path.join(os.tmpdir(), 'syllabus-'));
  const safeName = `${(data.courseId || 'Syllabus').replace(/\s/g,'')}_${(data.term || '').replace(/\s/g,'')}`;
  const docxPath = path.join(tmpDir, `${safeName}.docx`);
  const pdfPath  = path.join(tmpDir, `${safeName}.pdf`);

  try {
    // Generate docx
    const buf = await buildDocx(data);
    fs.writeFileSync(docxPath, buf);

    if (format === 'docx') {
      res.setHeader('Content-Disposition', `attachment; filename="${safeName}.docx"`);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      return res.send(buf);
    }

    // Convert to PDF via LibreOffice
    try {
      execSync(`soffice --headless --convert-to pdf "${docxPath}" --outdir "${tmpDir}"`, {
        timeout: 30000,
        env: { ...process.env, HOME: tmpDir }  // soffice needs a writable HOME on Railway
      });
    } catch (soErr) {
      // soffice not available — return docx only with a warning header
      console.warn('LibreOffice unavailable:', soErr.message);
      res.setHeader('Content-Disposition', `attachment; filename="${safeName}.docx"`);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('X-PDF-Unavailable', 'LibreOffice not found on this server — docx returned instead');
      return res.send(buf);
    }

    if (format === 'pdf') {
      const pdfBuf = fs.readFileSync(pdfPath);
      res.setHeader('Content-Disposition', `attachment; filename="${safeName}.pdf"`);
      res.setHeader('Content-Type', 'application/pdf');
      return res.send(pdfBuf);
    }

    // format === 'both' — return a JSON response with base64-encoded files
    const docxB64 = buf.toString('base64');
    const pdfB64  = fs.readFileSync(pdfPath).toString('base64');
    res.json({
      success: true,
      files: {
        docx: { name: `${safeName}.docx`, data: docxB64, mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
        pdf:  { name: `${safeName}.pdf`,  data: pdfB64,  mime: 'application/pdf' }
      }
    });

  } catch (err) {
    console.error('Generate error:', err.message);
    res.status(500).json({ error: 'Document generation failed.', detail: err.message });
  } finally {
    // Clean up temp files
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
});

module.exports = router;
