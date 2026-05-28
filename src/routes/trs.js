'use strict';
const express    = require('express');
const puppeteer  = require('puppeteer');
const router     = express.Router();

const TRS_URL = 'https://www.eiu.edu/textbook/inventory.php';

// Puppeteer is expensive — cache results for 1 hour per course code
const cache = new Map();
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

async function scrapeBooks(courseCode) {
  const codeSpaced = courseCode.replace(/^([A-Z]+)(\d)/, '$1 $2');
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (compatible; EIU-Syllabus-Builder/1.0)');
    await page.goto(TRS_URL, { waitUntil: 'networkidle2', timeout: 30000 });

    async function doSearch(val) {
      await page.$eval('input[type="text"]', el => { el.value = ''; });
      await page.type('input[type="text"]', val);
      await Promise.all([
        page.click('input[type="submit"], button[type="submit"], input[value="Search"]'),
        page.waitForResponse(r => r.url().includes('eiu.edu'), { timeout: 15000 }).catch(() => {}),
      ]);
      await new Promise(r => setTimeout(r, 3000));
    }

    async function extractBooks() {
      return page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll('table tr'));
        // Detect column positions from header row
        let authorCol = -1, titleCol = -1;
        for (const row of rows) {
          const cells = Array.from(row.querySelectorAll('th, td'));
          const texts = cells.map(el => el.textContent.trim().toLowerCase());
          const ai = texts.findIndex(t => t === 'author' || t.includes('author'));
          const ti = texts.findIndex(t => t === 'title' || t.includes('title'));
          if (ai !== -1 && ti !== -1) { authorCol = ai; titleCol = ti; break; }
        }
        if (authorCol === -1) { authorCol = 2; titleCol = 3; } // fallback

        const results = [];
        rows.forEach(row => {
          const cells = Array.from(row.querySelectorAll('td')).map(el => el.textContent.trim());
          if (cells.length <= Math.max(authorCol, titleCol)) return;
          const author = cells[authorCol] || '';
          const title  = cells[titleCol]  || '';
          if (author && title && author.toLowerCase() !== 'author') {
            results.push({ author, title });
          }
        });
        // Also expose raw table HTML for debug
        const tbl = document.querySelector('table');
        return { results, tableHtml: tbl ? tbl.outerHTML.slice(0, 2000) : '' };
      });
    }

    await doSearch(codeSpaced);
    let { results, tableHtml } = await extractBooks();

    if (results.length === 0 && codeSpaced !== courseCode) {
      await doSearch(courseCode);
      ({ results, tableHtml } = await extractBooks());
    }

    console.log(`[TRS] ${courseCode}: ${results.length} book(s). Table snippet: ${tableHtml.slice(0,300)}`);
    await browser.close();
    return results;
  } catch (err) {
    if (browser) await browser.close().catch(() => {});
    throw err;
  }
}

// GET /api/trs?courseCode=BUS2750
router.get('/', async (req, res) => {
  const { courseCode } = req.query;
  if (!courseCode) {
    return res.status(400).json({ error: 'courseCode is required (e.g. BUS2750)' });
  }

  const code = courseCode.toUpperCase().replace(/\s/g, '');

  const cached = cache.get(code);
  if (cached && (Date.now() - cached.ts) < CACHE_TTL) {
    return res.json({ success: true, source: 'cache', data: cached.data });
  }

  try {
    const books = await scrapeBooks(code);
    cache.set(code, { ts: Date.now(), data: books });
    res.json({ success: true, source: 'live', data: books });
  } catch (err) {
    console.error('TRS scrape error:', err.message);
    res.json({ success: true, source: 'error', data: [], warning: 'TRS lookup unavailable — enter textbook manually.', detail: err.message });
  }
});

module.exports = router;
