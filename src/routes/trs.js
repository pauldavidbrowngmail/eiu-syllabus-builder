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

    // Type the course code into the search box and trigger the search
    // The page has a text input and a Search button
    await page.waitForSelector('input[type="text"]', { timeout: 10000 });
    await page.type('input[type="text"]', code);

    // Click Search — the page uses JS to populate the table
    await Promise.all([
      page.click('input[type="submit"], button[type="submit"], input[value="Search"]'),
      page.waitForResponse(r => r.url().includes('eiu.edu'), { timeout: 15000 })
        .catch(() => {}),
    ]);

    // Give the AJAX table time to render
    await new Promise(r => setTimeout(r, 2500));

    // Extract table rows (skip the header row)
    const books = await page.evaluate(() => {
      const rows = document.querySelectorAll('table tr');
      const results = [];
      rows.forEach((row, i) => {
        if (i === 0) return; // skip header
        const cells = row.querySelectorAll('td');
        if (cells.length >= 3) {
          const author = cells[1]?.textContent?.trim();
          const title  = cells[2]?.textContent?.trim();
          if (author && title && author !== 'Author') {
            results.push({ author, title });
          }
        }
      });
      return results;
    });

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
