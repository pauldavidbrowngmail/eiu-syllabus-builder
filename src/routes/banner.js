'use strict';
const express = require('express');
const axios   = require('axios');
const router  = express.Router();

const BASE = 'https://banner.eiu.edu/StudentRegistrationSsb/ssb';

// ── Helper: parse meeting times out of Banner's meetingsFaculty array ────────
function parseMeetings(data) {
  const section = data?.data?.[0];
  if (!section) return null;

  const meetings = section.meetingsFaculty || [];
  const times = meetings.map(m => {
    const mt = m.meetingTime || {};
    const days = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday']
      .filter(d => mt[d])
      .map(d => d.slice(0,2).replace('mo','M').replace('tu','T').replace('we','W')
                             .replace('th','R').replace('fr','F').replace('sa','S').replace('su','U'))
      .join('');
    const fmt = t => {
      if (!t) return '';
      const h = parseInt(t.slice(0,2)), m2 = t.slice(2,4);
      const ampm = h >= 12 ? 'PM' : 'AM';
      return `${h > 12 ? h - 12 : h || 12}:${m2} ${ampm}`;
    };
    return `${days} ${fmt(mt.beginTime)}${mt.endTime ? ' – ' + fmt(mt.endTime) : ''}`.trim();
  }).filter(Boolean).join(', ');

  const building = meetings[0]?.meetingTime?.building || '';
  const room     = meetings[0]?.meetingTime?.room     || '';
  const location = [building, room].filter(Boolean).join(' ');

  const faculty  = section.faculty || [];
  const instructor = faculty.map(f => f.displayName).filter(Boolean).join(', ');

  return {
    courseId:    `${section.subject} ${section.courseNumber}`,
    courseTitle: section.courseTitle,
    credits:     `${section.creditHours || 3} Credit Hours`,
    crn:         String(section.courseReferenceNumber),
    section:     section.sequenceNumber,
    term:        section.termDesc,
    termCode:    section.term,
    meetTime:    times || 'See schedule',
    room:        location || 'TBA',
    instructor:  instructor || 'TBA',
    courseCode:  `${section.subject}${section.courseNumber}`.replace(/\s/g,''),
    // description and prereq come from the separate getCourseDescription call
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

module.exports = router;
