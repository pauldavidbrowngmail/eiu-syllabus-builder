'use strict';
const express = require('express');
const axios   = require('axios');
const router  = express.Router();

const BASE = 'https://banner.eiu.edu/StudentRegistrationSsb/ssb';

// ── Helper: parse meeting times out of Banner's meetingsFaculty array ────────
function parseMeetings(data) {
  // Banner SSB can wrap results under data.data or data.sections
  const list = Array.isArray(data?.data) ? data.data
             : Array.isArray(data?.sections) ? data.sections
             : [];
  const section = list[0];
  if (!section) {
    console.error('[Banner] parseMeetings: no section in response. Keys:', Object.keys(data || {}));
    return null;
  }
  console.log('[Banner] section keys:', Object.keys(section).join(', '));

  const meetings = section.meetingsFaculty || section.meetings || [];

  const DAY_MAP = { monday:'M', tuesday:'T', wednesday:'W', thursday:'R', friday:'F', saturday:'S', sunday:'U' };
  const fmt = t => {
    if (!t) return '';
    const h = parseInt(t.slice(0,2)), m2 = t.slice(2,4);
    const ampm = h >= 12 ? 'PM' : 'AM';
    return `${h > 12 ? h - 12 : h || 12}:${m2} ${ampm}`;
  };
  const times = meetings.map(m => {
    const mt = m.meetingTime || {};
    const days = Object.keys(DAY_MAP).filter(d => mt[d]).map(d => DAY_MAP[d]).join('');
    return `${days} ${fmt(mt.beginTime)}${mt.endTime ? ' – ' + fmt(mt.endTime) : ''}`.trim();
  }).filter(Boolean).join(', ');

  // Building: prefer description over code
  const mt0 = meetings[0]?.meetingTime || {};
  const building = mt0.buildingDescription || mt0.building || '';
  const room     = mt0.room || '';
  const location = [building, room].filter(Boolean).join(' ');

  // Faculty: try section.faculty first, then inside meetingsFaculty entries
  let facultyList = section.faculty || [];
  if (!facultyList.length) {
    facultyList = meetings.flatMap(m => m.faculty || []);
  }
  const instructor = facultyList
    .map(f => f.displayName || f.instructorDisplayName || f.name || '')
    .filter(Boolean).join(', ');

  const subject = section.subject || section.subjectCode || '';
  const courseNum = section.courseNumber || section.number || '';

  return {
    courseId:    `${subject} ${courseNum}`.trim(),
    courseTitle: section.courseTitle || section.title || section.sectionTitle || '',
    credits:     `${section.creditHours ?? section.creditHourLow ?? 3} Credit Hours`,
    crn:         String(section.courseReferenceNumber || section.crn || ''),
    section:     section.sequenceNumber || section.section || '',
    term:        section.termDesc || '',
    termCode:    section.term || '',
    meetTime:    times || 'See schedule',
    room:        location || 'TBA',
    instructor:  instructor || 'TBA',
    courseCode:  `${subject}${courseNum}`.replace(/\s/g,''),
  };
}

// Collect all Set-Cookie values from an axios response into a single cookie string
function extractCookies(response) {
  const raw = response.headers['set-cookie'] || [];
  return raw.map(c => c.split(';')[0]).join('; ');
}

// GET /api/banner?crn=90933&term=202630
router.get('/', async (req, res) => {
  const { crn, term } = req.query;
  if (!crn || !term) {
    return res.status(400).json({ error: 'crn and term are required' });
  }

  const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    'Accept': 'application/json, text/html, */*',
    'Referer': `${BASE}/classSearch/classSearch`,
    'X-Requested-With': 'XMLHttpRequest',
  };

  try {
    // ── Step 1: hit the classSearch page to establish a JSESSIONID ───────────
    const initRes = await axios.get(`${BASE}/classSearch/classSearch`, {
      headers: { ...HEADERS, Accept: 'text/html,*/*' },
      maxRedirects: 5,
    });
    let cookies = extractCookies(initRes);

    // ── Step 2: POST to set the active term ───────────────────────────────────
    const termPostRes = await axios.post(
      `${BASE}/term/search`,
      `term=${term}&studyPath=&studyPathText=&startDatepicker=&endDatepicker=`,
      {
        params: { mode: 'search' },
        headers: { ...HEADERS, 'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': cookies },
        maxRedirects: 5,
      }
    );
    const newCookies = extractCookies(termPostRes);
    if (newCookies) cookies = [cookies, newCookies].filter(Boolean).join('; ');

    // ── Step 3: search by CRN, forwarding cookies ────────────────────────────
    const searchRes = await axios.get(`${BASE}/searchResults/searchResults`, {
      params: {
        txt_term: term,
        txt_crn: crn,
        pageOffset: 0,
        pageMaxSize: 1,
        sortColumn: 'subjectDescription',
        sortDirection: 'asc',
      },
      headers: { ...HEADERS, 'Cookie': cookies },
    });

    if (!searchRes.data?.success || !searchRes.data?.data?.length) {
      return res.status(404).json({
        error: `CRN ${crn} not found for term ${term}. Check the CRN and selected term.`
      });
    }

    const parsed = parseMeetings(searchRes.data);

    // ── Step 4: fetch catalog description ────────────────────────────────────
    try {
      const descRes = await axios.get(`${BASE}/searchResults/getCourseDescription`, {
        params: { term, courseReferenceNumber: crn },
        headers: { ...HEADERS, 'Cookie': cookies },
      });
      const raw = descRes.data || '';
      parsed.description = raw.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    } catch {
      parsed.description = '';
    }

    // ── Step 5: fetch prerequisites ──────────────────────────────────────────
    try {
      const prereqRes = await axios.get(`${BASE}/searchResults/getSectionPrerequisites`, {
        params: { term, courseReferenceNumber: crn },
        headers: { ...HEADERS, 'Cookie': cookies },
      });
      const html = prereqRes.data || '';
      const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      parsed.prereq = text || 'None';
    } catch {
      parsed.prereq = 'None';
    }

    res.set('Cache-Control', 'no-store');
    res.json({ success: true, data: parsed });

  } catch (err) {
    console.error('Banner error:', err.message);
    res.status(502).json({
      error: 'Could not reach Banner SSB. Please try again.',
      detail: err.message
    });
  }
});

// GET /api/banner/debug?crn=99008&term=202690  — returns raw Banner JSON for diagnosis
router.get('/debug', async (req, res) => {
  const { crn, term } = req.query;
  if (!crn || !term) return res.status(400).json({ error: 'crn and term required' });

  const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'application/json, text/html, */*',
    'Referer': `${BASE}/classSearch/classSearch`,
    'X-Requested-With': 'XMLHttpRequest',
  };
  try {
    const initRes = await axios.get(`${BASE}/classSearch/classSearch`, { headers: { ...HEADERS, Accept: 'text/html,*/*' }, maxRedirects: 5 });
    let cookies = extractCookies(initRes);
    const termPostRes = await axios.post(`${BASE}/term/search`, `term=${term}&studyPath=&studyPathText=&startDatepicker=&endDatepicker=`, {
      params: { mode: 'search' },
      headers: { ...HEADERS, 'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': cookies },
      maxRedirects: 5,
    });
    const nc = extractCookies(termPostRes);
    if (nc) cookies = [cookies, nc].filter(Boolean).join('; ');
    const searchRes = await axios.get(`${BASE}/searchResults/searchResults`, {
      params: { txt_term: term, txt_crn: crn, pageOffset: 0, pageMaxSize: 1, sortColumn: 'subjectDescription', sortDirection: 'asc' },
      headers: { ...HEADERS, 'Cookie': cookies },
    });
    res.set('Cache-Control', 'no-store');
    res.json({ raw: searchRes.data, cookies: cookies.slice(0, 200) });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

module.exports = router;
