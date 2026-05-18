'use strict';
const express    = require('express');
const cors       = require('cors');
const helmet     = require('helmet');
const rateLimit  = require('express-rate-limit');
const path       = require('path');

const bannerRoute   = require('./routes/banner');
const trsRoute      = require('./routes/trs');
const generateRoute = require('./routes/generate');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Security & middleware ────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));   // CSP off — we serve our own HTML
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Rate-limit the data-fetch endpoints to prevent abuse
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,   // 1 minute
  max: 60,               // 60 requests per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests — please wait a moment.' }
});
app.use('/api/', apiLimiter);

// ── API routes ───────────────────────────────────────────────────────────────
app.use('/api/banner',   bannerRoute);
app.use('/api/trs',      trsRoute);
app.use('/api/generate', generateRoute);

// ── Health check (used by Railway) ──────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

// ── Serve frontend ───────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('*', (_req, res) =>
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'))
);

app.listen(PORT, () =>
  console.log(`EIU Syllabus Builder running on http://localhost:${PORT}`)
);
