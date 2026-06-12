# Gamry Dashboard

A local web dashboard for visualising and analysing Gamry Instruments electrochemical data (`.dta` files). Drag files in, get interactive plots with built-in analysis — no scripting required.

---

## Supported experiment types

| Gamry type | Technique | Panel |
|---|---|---|
| CV | Cyclic Voltammetry | CV — curve selection, reference correction, normalisation, peak detection, capacitance |
| LSV | Linear Sweep Voltammetry | CV — Tafel slope, exchange current density j₀, R² |
| EISPOT | Electrochemical Impedance Spectroscopy | EIS — Nyquist, Bode, Complex Capacitance; ESR, τ₀, C_max |
| CHRONOP | Galvanostatic Charge/Discharge | GCD — cycle life, Coulombic Efficiency overlay, fade, avg CE |
| PWR800 | Multi-cycle GCD (Gamry PWR800) | GCD |
| SEESAW | Large multi-cycle GCD | SEESAW — on-demand cycle range loading |

---

## Installation

Requires **Python 3.10+** and **Node.js 18+**.

### Backend
```bash
cd backend
pip install -r requirements.txt
```

### Frontend
```bash
cd frontend
npm install
```

---

## Running

Open **two terminals** and leave both running:

```bash
# Terminal 1 — API server
cd backend
uvicorn main:app --reload
# → http://localhost:8000
```

```bash
# Terminal 2 — UI
cd frontend
npm run dev
# → http://localhost:5173
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

---

## Usage

1. **Drop files** onto the landing page, or click to browse. Multiple `.dta` files are accepted at once.
2. Each file opens as a **panel** in the dashboard. Panels can be **dragged** to rearrange.
3. Use the **controls bar** at the top of each panel to adjust parameters — reference electrode, scan rate, normalisation, etc. The plot and metrics update automatically.
4. Click the **?** button in the metrics row to read the full formula for every displayed value.

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend framework | React 18 + Vite + TypeScript |
| Styling | Tailwind CSS (custom `forest` green palette) |
| Charts | Plotly.js via react-plotly.js |
| Data fetching | TanStack Query v5 |
| Panel layout | react-grid-layout |
| Backend | FastAPI + uvicorn |
| Electrochemistry parsing | gamry-parser |
| Numerical analysis | NumPy, SciPy, pandas |

---

---

## Deployment

Copy `backend/.env.example` to `backend/.env` and set at minimum:

| Variable | Required | Description |
|---|---|---|
| `ALLOWED_ORIGINS` | **Yes** | Comma-separated frontend origin(s), e.g. `https://your-app.vercel.app` |
| `ENV` | Yes | Set to `production` (disables `/docs`/`/redoc`); use `development` locally |
| `TRUST_PROXY` | Yes (hosted) | `true` when behind Render/Fly/nginx — enables real-IP rate limiting via `X-Forwarded-For` |
| `UPLOADS_ENABLED` | No | `false` to disable uploads (sample data still works) |
| `MAX_FILE_MB` | No | Per-file size limit in MB (default `20`) |
| `MAX_TOTAL_MB` | No | Per-request total size limit (default `100`) |
| `CACHE_TTL_S` | No | In-memory cache expiry in seconds (default `3600` = 1 h) |

For the frontend, no env var is needed in production when the frontend and backend share an origin via a reverse proxy (the API client defaults to `/api`). If they are on different origins, set `VITE_API_BASE_URL=https://your-backend.onrender.com/api` at **build time**.

**Privacy**: files are processed temporarily for analysis and are not stored permanently. Cached data expires after `CACHE_TTL_S` seconds and is purged immediately when a user removes a file.

---

## Project documentation

| File | Contents |
|---|---|
| `CLAUDE.md` | Instructions for the AI assistant (coding rules, color system, architecture constraints) |
| `ARCHITECTURE.md` | Why the technology choices were made and how the system is designed |
| `LEARNING.md` | Conceptual guide to the project for learning purposes |
