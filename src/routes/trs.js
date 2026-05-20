'use strict';
const express    = require('express');
const puppeteer  = require('puppeteer');
const router     = express.Router();

const TRS_URL = 'https://www.eiu.edu/textbook/inventory.php';

// Puppeteer is expensive — cache results for 1 hour per course code
const cache = new Map();
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

// GET /api/trs?courseCode=BUS2750
router.get('/', async (req, res) => {
  const { courseCode } = req.query;
  if (!courseCode) {
    return res.status(400).json({ error: 'courseCode is required (e.g. BUS2750)' });
  }

  const code = courseCode.toUpperCase().replace(/\s/g, '');

  // Return cached result if fresh
  const cached = cache.get(code);
  if (cached && (Date.now() - cached.ts) < CACHE_TTL) {
    return res.json({ success: true, source: 'cache', data: cached.data });
  }

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',   // required on Railway/Docker
        '--disable-gpu',
      ]
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (compatible; EIU-Syllabus-Builder/1.0)');

    // Load the inventory page
    await page.goto(TRS_URL, { waitUntil: 'networkidle2', timeout: 30000 });

    // The TRS page search box — try the combined code first, then with a space
    // e.g. "ACC4760" or "ACC 4760"
    const codeSpaced = code.replace(/^([A-Z]+)(\d)/, '$1 $2');

    await page.waitForSelector('input[type="text"]', { timeout: 10000 });

    async function trySearch(inputValue) {
      await page.$eval('input[type="text"]', el => { el.value = ''; });
      await page.type('input[type="text"]', inputValue);
      await Promise.all([
        page.click('input[type="submit"], button[type="submit"], input[value="Search"]'),
        page.waitForResponse(r => r.url().includes('eiu.edu'), { timeout: 15000 })
          .catch(() => {}),
      ]);
      await new Promise(r => setTimeout(r, 2500));
    }

    await trySearch(codeSpaced);

    // Extract all table rows; detect header by looking for th or all-caps text
    let books = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('table tr'));
      // Find the header row to determine column positions
      let authorCol = -1, titleCol = -1;
      for (const row of rows) {
        const headers = Array.from(row.querySelectorAll('th, td')).map(el => el.textContent.trim().toLowerCase());
        const ai = headers.findIndex(h => h.includes('author'));
        const ti = headers.findIndex(h => h.includes('title'));
        if (ai !== -1 && ti !== -1) { authorCol = ai; titleCol = ti; break; }
      }
      // Fall back to common positions if header not found (course, section, author, title, ...)
      if (authorCol === -1) { authorCol = 2; titleCol = 3; }

      const results = [];
      rows.forEach(row => {
        const cells = Array.from(row.querySelectorAll('td')).map(el => el.textContent.trim());
        if (cells.length <= authorCol) return;
        const author = cells[authorCol] || '';
        const title  = cells[titleCol]  || '';
        if (author && title && author.toLowerCase() !== 'author') {
          results.push({ author, title });
        }
      });
      return results;
    });

    // If nothing found with spaced code, retry with no space
    if (books.length === 0 && codeSpaced !== code) {
      await trySearch(code);
      books = await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll('table tr'));
        let authorCol = 2, titleCol = 3;
        for (const row of rows) {
          const headers = Array.from(row.querySelectorAll('th, td')).map(el => el.textContent.trim().toLowerCase());
          const ai = headers.findIndex(h => h.includes('author'));
          const ti = headers.findIndex(h => h.includes('title'));
          if (ai !== -1 && ti !== -1) { authorCol = ai; titleCol = ti; break; }
        }
        const results = [];
        rows.forEach(row => {
          const cells = Array.from(row.querySelectorAll('td')).map(el => el.textContent.trim());
          if (cells.length <= authorCol) return;
          const author = cells[authorCol] || '';
          const title  = cells[titleCol]  || '';
          if (author && title && author.toLowerCase() !== 'author') {
            results.push({ author, title });
          }
        });
        return results;
      });
    }

    await browser.close();
    browser = null;

    // Cache the result
    cache.set(code, { ts: Date.now(), data: books });

    res.json({ success: true, source: 'live', data: books });

  } catch (err) {
    if (browser) await browser.close().catch(() => {});
    console.error('TRS scrape error:', err.message);

    // Non-fatal — return empty so the form still works
    res.json({
      success: true,
      source: 'error',
      data: [],
      warning: 'TRS lookup unavailable — enter textbook manually.',
      detail: err.message
    });
  }
});

module.exports = router;
