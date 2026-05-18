# EIU Syllabus Builder

Syllabus generator for EIU Lumpkin College faculty. Pulls course data live from Banner SSB and the TRS textbook inventory, then exports a formatted `.docx` and PDF.

---

## Local setup (run on your machine)

### Prerequisites
- Node.js 18+ — https://nodejs.org
- LibreOffice (for PDF export) — https://libreoffice.org
  - macOS: `brew install libreoffice`
  - Windows: download installer from libreoffice.org
  - Ubuntu/Debian: `sudo apt install libreoffice`

### Steps

```bash
# 1. Clone or unzip this project
cd eiu-syllabus-app

# 2. Install dependencies (~2 min, Puppeteer downloads Chromium)
npm install

# 3. Start the server
npm run dev        # development (auto-restarts on file changes)
# or
npm start          # production

# 4. Open in your browser
# http://localhost:3000
```

The app is now running locally. Enter any EIU CRN + term and click "Fetch from Banner" to pull live data.

---

## Deploy to Railway (free hosting, ~5 min)

Railway gives you a public URL that any EIU faculty member can access.

### Steps

1. Create a free account at https://railway.app (sign in with GitHub)

2. Push this project to a GitHub repository:
   ```bash
   git init
   git add .
   git commit -m "EIU Syllabus Builder v1"
   # Create a new repo on github.com, then:
   git remote add origin https://github.com/YOUR_USERNAME/eiu-syllabus-builder.git
   git push -u origin main
   ```

3. In Railway: click **New Project → Deploy from GitHub repo** → select your repo

4. Railway detects `nixpacks.toml` and automatically installs Node.js, LibreOffice, and Chromium (for Puppeteer). No manual configuration needed.

5. Once deployed, Railway gives you a URL like:
   `https://eiu-syllabus-builder-production.up.railway.app`

   Share this URL with any EIU faculty member — no login required.

### Cost
Railway's free Hobby plan includes $5/month of compute credits. This app uses very little CPU at idle. For light faculty use (a few dozen syllabi per semester), the free tier is sufficient.

---

## Project structure

```
eiu-syllabus-app/
├── src/
│   ├── server.js           Main Express server
│   └── routes/
│       ├── banner.js       Banner SSB proxy (two-step CRN lookup)
│       ├── trs.js          TRS inventory scraper (Puppeteer)
│       └── generate.js     docx + PDF generation
├── public/
│   └── index.html          8-step syllabus form (complete frontend)
├── package.json
├── railway.toml            Railway deployment config
├── nixpacks.toml           LibreOffice + Chromium install
└── .gitignore
```

---

## API endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `GET /api/banner?crn=90933&term=202680` | GET | Returns Banner SSB course data |
| `GET /api/trs?courseCode=BUS2750` | GET | Returns TRS textbook inventory |
| `POST /api/generate?format=docx` | POST | Returns `.docx` file download |
| `POST /api/generate?format=pdf` | POST | Returns PDF file download |
| `GET /health` | GET | Health check |

### Banner term codes
| Term | Code |
|------|------|
| Spring 2026 | 202610 |
| Fall 2026 | 202680 |
| Spring 2027 | 202710 |

To add future terms, update the `<select>` in `public/index.html`.

---

## Troubleshooting

**Banner returns no results:** Confirm the CRN exists in the selected term. CRNs are term-specific — a Fall CRN won't return results if Spring is selected.

**TRS lookup times out:** Puppeteer launches a headless browser to scrape the TRS page. On first run this can take 10–15 seconds. Results are cached for 1 hour. If it fails, the form still works — just enter the textbook manually.

**PDF download returns a .docx instead:** LibreOffice is not installed or not in your PATH. Install it per the prerequisites above. On Railway, `nixpacks.toml` handles this automatically.

**Puppeteer fails on Linux/Railway:** The `nixpacks.toml` includes all required Chromium system libraries. If you're deploying elsewhere, ensure `chromium`, `nss`, `nspr`, `at-spi2-atk`, `libdrm`, and `libxkbcommon` are available.
