# Gamry Dashboard — Full Documentation

## Table of Contents

1. [What the App Does](#1-what-the-app-does)
2. [Tech Stack and Why We Chose It](#2-tech-stack-and-why-we-chose-it)
3. [Project Structure](#3-project-structure)
4. [Backend](#4-backend)
5. [Frontend](#5-frontend)
6. [Data Flow: From File Upload to Plot](#6-data-flow-from-file-upload-to-plot)
7. [Experiment Types and What They Show](#7-experiment-types-and-what-they-show)
8. [Analysis: The Science Behind the Numbers](#8-analysis-the-science-behind-the-numbers)
9. [Key Design Decisions](#9-key-design-decisions)
10. [State Management Architecture](#10-state-management-architecture)
11. [Context System](#11-context-system)
12. [Export System](#12-export-system)
13. [Style System](#13-style-system)
14. [Persistence: localStorage](#14-persistence-localstorage)
15. [Feature Reference](#15-feature-reference)

---

## 1. What the App Does

Gamry Dashboard is a browser-based tool for visualising and analysing electrochemical measurements recorded by Gamry potentiostats. Gamry instruments save data in `.dta` files — a plain-text format with a structured header and tabular measurement data. This app reads those files, plots the data, and computes useful quantities that would otherwise require MATLAB or Origin.

**The core workflow:**

1. Drag-and-drop one or more `.dta` files (or click "Load sample data" to try it without files).
2. Each file appears as its own panel on a resizable grid dashboard.
3. The panel type matches the experiment (cyclic voltammetry, EIS, galvanostatic cycling, etc.).
4. Controls in each panel let you adjust the view, run analysis, and export.
5. The Sidebar lets you overlay multiple files in a comparison panel, run deeper analysis, style the plots, and export everything.

**Why it exists:**

Gamry's own software (Echem Analyst) is Windows-only, expensive, and clunky. Researchers who want to do quick checks on a Mac, share interactive results, or batch-export publication figures had no good option. This app fills that gap.

---

## 2. Tech Stack and Why We Chose It

### Backend: Python + FastAPI

- **Python** is the natural choice for electrochemical data science. Libraries like `scipy`, `numpy`, and `pandas` already implement the math we need.
- **FastAPI** was chosen over Flask because it generates automatic OpenAPI docs, has native async support, validates request/response bodies with Pydantic, and is significantly faster.
- **gamry_parser** is a third-party library that handles the binary/text parsing of `.dta` files. We use it to load files and detect the experiment type, then extract the data arrays ourselves (the library's own data extraction is more limited than what we need).
- **slowapi** provides rate limiting (request throttling) to prevent abuse when the app is deployed publicly.
- **scipy.optimize.least_squares** handles nonlinear curve fitting for the Randles EIS circuit.

### Frontend: React + TypeScript + Vite

- **React** was chosen because the UI is highly stateful — multiple panels, each with their own controls, all updating independently. React's component model makes this manageable.
- **TypeScript** catches bugs at compile time. With complex nested data structures (curves, EIS arrays, analysis results) flowing between components, type errors would be very common without it.
- **Vite** is dramatically faster to build and hot-reload than Create React App or Webpack. Important during development when you're iterating on plot controls.
- **TanStack Query (react-query)** manages server state — fetching analysis results, curve data on demand. It handles caching, background refetching, loading states, and deduplication automatically.
- **react-plotly.js** renders all plots. Plotly is the only JavaScript charting library that handles scientific plots well — log axes, equal-aspect-ratio Nyquist plots, dual y-axes, hover data, zoom/pan. D3-based alternatives require far more code to match this.
- **react-grid-layout** powers the draggable, resizable panel grid.
- **Tailwind CSS** is used for all styling. It avoids writing CSS files, keeps styles co-located with markup, and makes the dark forest-green theme consistent via a custom color palette.
- **lucide-react** provides the icon set (feather-style, consistent weight).

---

## 3. Project Structure

```
gamry-dashboard/
├── backend/
│   ├── main.py                  # FastAPI app — CORS, rate limiting, router wiring
│   ├── limiter.py               # slowapi rate limiter singleton
│   ├── requirements.txt
│   ├── routers/
│   │   ├── files.py             # Upload, sample data, curve/cycle fetch endpoints
│   │   └── analysis.py          # CV, Tafel, EIS, GCD analysis endpoints
│   └── gamry_plotter/
│       ├── analysis.py          # Pure analysis functions (no web, no Plotly)
│       ├── data.py              # DTA parsing helpers
│       └── demo.py              # Synthetic sample data generator
│
└── frontend/
    ├── src/
    │   ├── main.tsx             # React entry point
    │   ├── App.tsx              # Root state: files, comparisons, analyses, persistence
    │   ├── types/index.ts       # All TypeScript interfaces
    │   ├── api/client.ts        # All fetch calls to the backend
    │   ├── components/
    │   │   ├── LandingPage.tsx      # Shown when no files loaded yet
    │   │   ├── Sidebar.tsx          # Upload, file list, compare/analyse, style, theme
    │   │   ├── Dashboard.tsx        # react-grid-layout grid of panels
    │   │   ├── PlotPanel.tsx        # Panel wrapper (header + CV/EIS/GCD/Seesaw dispatch)
    │   │   ├── ComparisonPanel.tsx  # Panel wrapper for overlay comparisons
    │   │   ├── AnalysisPanel.tsx    # Panel wrapper for analysis sessions
    │   │   ├── FullscreenOverlay.tsx # React portal for fullscreen mode
    │   │   ├── InfoModal.tsx        # Sliding drawer with formula explanations
    │   │   ├── AxisInput.tsx        # Controlled axis range input with validation
    │   │   └── panels/
    │   │       ├── CVPanel.tsx           # Cyclic voltammetry / LSV
    │   │       ├── EISPanel.tsx          # Impedance spectroscopy
    │   │       ├── GCDPanel.tsx          # Galvanostatic cycling
    │   │       ├── CVComparePanel.tsx    # CV/LSV overlay comparison
    │   │       ├── EISComparePanel.tsx   # EIS overlay comparison
    │   │       ├── GCDComparePanel.tsx   # GCD overlay comparison
    │   │       ├── CVAnalysisPanel.tsx   # Deep CV analysis (Randles-Ševčík, scan rate study)
    │   │       ├── EISAnalysisPanel.tsx  # Deep EIS analysis
    │   │       ├── GCDAnalysisPanel.tsx  # Deep GCD analysis
    │   │       └── ScanRateAnalysis.tsx  # Scan rate dependence panel
    │   ├── context/
    │   │   ├── ExportContext.tsx    # Export registry (PNG/SVG/CSV for all panels)
    │   │   ├── FileLabelContext.tsx # Custom display names for files
    │   │   ├── StyleContext.tsx     # Global + per-panel plot style overrides
    │   │   └── ThemeContext.tsx     # UI theme (forest/dark/light)
    │   ├── hooks/
    │   │   ├── useLocalStorage.ts   # Typed localStorage hook
    │   │   ├── useZoom.ts           # Track Plotly zoom state and legend position
    │   │   └── useContainerSize.ts  # ResizeObserver for responsive legend font
    │   ├── utils/
    │   │   ├── plotUtils.ts         # LAYOUT_BASE, axisOverride, interpolateLinear, shortName
    │   │   ├── applyStyle.ts        # Apply StyleSettings to Plotly data/layout
    │   │   ├── buildFigure.ts       # Assemble Plotly figure for export
    │   │   ├── exportUtils.ts       # PNG/SVG/CSV download, ZIP builder
    │   │   └── referenceElectrodes.ts # Electrode potential offsets
    │   └── styles/
    │       └── styleTypes.ts        # StyleSettings interface, PALETTES, FRAMEWORKS
    └── index.html
```

---

## 4. Backend

### `main.py` — The FastAPI Application

The app is a thin wrapper. It:
- Sets up CORS so the browser (running on port 5173 during development) can talk to the API (port 8000). The `ALLOWED_ORIGINS` environment variable overrides this for production.
- Attaches the `slowapi` rate limiter so each endpoint can set its own limit.
- Hides internal exception details from responses (full tracebacks go to server logs, not the browser) to avoid leaking implementation details.
- Mounts two routers under `/api`.

### `routers/files.py` — Upload and Data Retrieval

**`POST /api/upload`** — Accepts one or more `.dta` files. For each file:
1. Saves it to a temporary directory.
2. Tries to load it with `gamry_parser` to detect the experiment type.
3. If that fails, falls back to `manual_detect_type` which scans the file text for type keywords.
4. Extracts the relevant data arrays (curves for CV/LSV, impedance arrays for EIS, capacity data for GCD).
5. Returns a JSON representation of the file.

Special handling for large CV files: if a CV file has more than 30 cycles, the curves are stored in an in-memory server-side store (`_cv_store`) keyed by file ID, and only the count is sent to the browser. The browser fetches ranges on demand via `GET /api/files/{id}/curves`.

Special handling for SEESAW files: when multiple files named like `charge_#1.dta`, `discharge_#1.dta`, etc. are uploaded together, they are recognised as a cycle group and assembled into a single SEESAW entry. The raw time/voltage data is stored in `_seesaw_store` and fetched on demand via `GET /api/files/{id}/cycles`.

Both stores use `OrderedDict` with a maximum size (20 entries) and evict the oldest entry when full — a simple LRU-style cache without any external dependency.

**`GET /api/sample`** — Returns synthetic sample data for CV, LSV, EIS, and GCD experiments. Generated by `gamry_plotter/demo.py` — useful when no real `.dta` files are available.

### `routers/analysis.py` — Analysis Endpoints

Four endpoints, one per experiment type:

| Endpoint | Input | Output |
|----------|-------|--------|
| `POST /api/analyze/cv` | Curve arrays + scan rate + options | Capacitances, peak voltages |
| `POST /api/analyze/tafel` | LSV curve + area | Tafel slope, j₀, R², fit line |
| `POST /api/analyze/eis` | EIS arrays | ESR, τ₀, C_max, complex capacitance, Randles fit |
| `POST /api/analyze/gcd` | Cycle/capacity arrays | mAh per cycle, coulombic efficiency, fade % |

All endpoints have per-field length validation (max 20,000 points per array) to prevent memory exhaustion from malformed or adversarial inputs.

### `gamry_plotter/analysis.py` — Pure Analysis Functions

All analysis math lives here. No web framework, no plotting, no side effects — just functions that take DataFrames and return results. This makes the code easy to test and reuse.

Key functions:

**`cv_capacitance`** — Computes `C = ∮ I dV / (2 × ΔV × ν)` for each CV cycle using `numpy.trapezoid` (trapezoidal integration). The `2 ×` in the denominator accounts for the full cycle (forward + return sweep). Optional `v_lo`/`v_hi` restrict the integration window.

**`tafel_analysis`** — Fits `log₁₀|j|` vs. `E` linearly in a user-defined potential window. The Tafel slope `b = 1000/slope` (mV/decade) and exchange current density `j₀ = 10^intercept` are extracted. Requires at least 5 data points with `|j| > 0`.

**`eis_esr`** — Returns `Z'` at the highest measured frequency. ESR (equivalent series resistance) is the ohmic resistance of the electrolyte and contacts.

**`eis_complex_capacitance`** — Converts impedance to complex capacitance via `C*(f) = 1 / (j·2πf·Z*(f))`. The real part `C'(f)` corresponds to stored energy; the imaginary part `C''(f)` to dissipated energy. The peak of `C''(f)` gives the relaxation frequency.

**`eis_relaxation_time`** — Returns `τ₀ = 1 / (2πf₀)` where `f₀` is the frequency at max `C''(f)`. This is the minimum time to discharge the device with ≥ 50% efficiency.

**`eis_randles_fit`** — Fits the Randles circuit model `Z(ω) = R_s + R_ct / (1 + jω·R_ct·C_dl)` to the Nyquist data using `scipy.optimize.least_squares`. The initial guess for `R_s` is `Z'` at the highest frequency, and for `R_ct` is `max(Z') - R_s`. Bounds prevent negative values. Returns `R_s`, `R_ct`, `C_dl_uF`, RMSE, and the fitted impedance curve for display.

---

## 5. Frontend

### `App.tsx` — Root State and Session Orchestration

`App` holds the three core state arrays:
- `files: ParsedFile[]` — all uploaded files
- `comparisons: ComparisonSession[]` — all comparison panels
- `analyses: AnalysisSession[]` — all analysis panels

It is responsible for:
- **Session persistence**: on mount, restores state from `localStorage["gamry-session-v1"]`. On every change, writes state back. If the quota is exceeded (many large CV files), strips curve arrays from files with > 10 curves and marks them `partial: true`.
- **Lazy curve fetching**: CV/LSV files with `total_curves` but no `curves` array are fetched eagerly on mount (so comparison panels work without re-upload).
- **Cascade removal**: removing a file also removes comparisons and analyses that reference it, and removes references to it from other comparisons.

### `Sidebar.tsx` — Control Panel

The sidebar has five sections:

1. **Dropzone** — react-dropzone accepts `.dta` files. Calls `POST /api/upload`. Shows a loading spinner while uploading.

2. **File list** — shows all loaded files with a colored dot (green for CV/LSV, teal for EIS, dark green for GCD, amber for SEESAW). Files with errors show a warning triangle. Each file can be removed individually. "Clear all" removes everything.

3. **Compare** — appears when ≥ 2 files of the same type are loaded. Groups files by type (CV + LSV share a group; PWR800 joins CHRONOP). Opens a checklist to select which files to compare and (for CV) which cycle number per file. Creates a `ComparisonSession`.

4. **Analyse** — appears for any analysable file. Creates an `AnalysisSession` for deeper multi-metric analysis.

5. **Graph Style** — a full style editor: color palette, line width/style, marker shape/size, axis appearance, grid, font sizes, legend positioning. Changes apply globally to all panels unless a specific panel is "selected" (via the palette icon in its header), in which case changes apply only to that panel.

6. **Theme** (footer) — three dot buttons switch the UI theme (forest green / dark / light).

### `Dashboard.tsx` — The Grid

`react-grid-layout` renders a grid of panels. Key logic:

- **Column count**: 12 columns (a standard grid system).
- **Panel width**: adapts by count — 1 panel is full-width (12 cols), 2 panels are half-width (6 cols each), 3+ panels use 4 or 6 columns.
- **Row height**: calculated dynamically from the container height so panels always fill the screen for ≤ 6 panels. For 7+ panels, the first two rows fill the viewport and the rest scroll.
- **`useLayoutEffect` for layout rebuilds**: fires synchronously before the browser paints to avoid a flash when panels are added or removed. Uses a joined ID string (`allIdsKey`) so it fires even when the count stays the same but a panel is swapped.
- **Collapse state**: `collapsedIds: Set<string>` tracks which panels have their content hidden. Toggled by a Minus/Plus button in each panel header.

### `PlotPanel.tsx` — Panel Wrapper

Wraps every file-based panel. Contains:
- `PanelHeader` — the drag handle bar with the file name (double-click to rename), type badge, style picker, export dropdown, collapse toggle, fullscreen toggle, and close button.
- Dispatch logic: checks `file.etype` and renders `CVPanel`, `EISPanel`, `GCDPanel`, or `SeesawPanel`.
- Error display: if `file.error` is set, shows the error string instead of a plot.
- `SeesawPanel` — an internal function component (not a separate file) for SEESAW/GCD cycle data. Contains the dQ/dV feature (see below).
- Fullscreen mode: `useState(false)` for a fullscreen flag; when true, renders a `FullscreenOverlay` portal around the same inner content.

`PlotPanel` is wrapped in `React.memo` with a custom comparator that only re-renders when `file` or `isCollapsed` changes, preventing unnecessary re-renders when Dashboard state updates.

### The Panel Components (`panels/`)

Each panel component follows the same structure:
1. **Controls bar** — a light-grey bar at the top with inline controls.
2. **Metrics bar** — shows computed quantities in small chips (only after analysis results arrive).
3. **Info modal** — a "?" button opens a `InfoModal` drawer explaining the formulas.
4. **Plot** — a `react-plotly.js` `<Plot>` component with `useResizeHandler` so it fills the container.

All panels use:
- `useLocalStorage` for controls that should survive page refresh (scan rate, reference electrode, view mode).
- `useQuery` (TanStack Query) for analysis requests — results are cached per file ID.
- `useStyle(file.id)` to get the effective style (panel override or global).
- `useZoom` to preserve the user's zoom and legend position across re-renders.
- The export context to register themselves for "export all" operations.

---

## 6. Data Flow: From File Upload to Plot

Here is what happens when you upload a file:

```
User drops file.dta
  → Sidebar onDrop → uploadMut.mutate(files)
  → POST /api/upload (FastAPI)
    → gamry_parser loads file, detects etype
    → extract_cv_curves (or extract_eis_df, get_gcd_master_data)
    → if CV with >30 curves: store in _cv_store, return total_curves only
    → else: return curves inline
  → response: ParsedFile JSON
  → App.addFiles(incoming)
  → files state updated
  → Dashboard re-renders, adds new grid panel
  → PlotPanel rendered for new file
    → CVPanel mounts, reads file.curves
    → if total_curves set but curves absent: shows loading spinner
    → App.useEffect sees lazy file, calls fetchCVCurves
    → patchFile(id, { curves }) fills in the data
    → CVPanel re-renders with actual data, builds plotData
    → Plotly renders the cyclic voltammogram
```

For analysis:
```
User clicks "Calculate" in CVPanel
  → setCapKey(k + 1) triggers useQuery
  → POST /api/analyze/cv with curve arrays + scan rate
  → analysis.py: cv_capacitance() runs numpy.trapezoid
  → returns capacitances_mf
  → cvQ.data updates
  → capacitance chips appear in the metrics row
```

---

## 7. Experiment Types and What They Show

### CV (Cyclic Voltammetry)

**What it is**: The potential is swept back and forth between two limits at a constant rate (mV/s). The current response reveals redox reactions, capacitive charging, and chemical reversibility.

**What the panel shows**:
- Each cycle as a current (mA) vs. potential (V) curve. Multiple cycles are plotted with different colors.
- Optional peak detection: annotates oxidation and reduction peaks with star markers.
- Capacitance calculation over a user-defined potential window.
- Background subtraction: select another CV file as background; it's interpolated and subtracted point-by-point.

**Controls**: cycle range, scan rate (auto-detected from metadata or manual), reference electrode conversion, current normalisation (by area in cm² or mass in mg), background file dropdown.

### LSV (Linear Sweep Voltammetry)

**What it is**: A single potential sweep in one direction. Used for characterising electrocatalytic activity.

**What the panel shows**:
- A Tafel plot: `log₁₀|j|` (current density) vs. potential. Plotly shows the raw data and an auto-fitted Tafel line.
- Tafel slope (mV/decade), exchange current density j₀, and R² of the fit.

### EIS (Electrochemical Impedance Spectroscopy)

**What it is**: A small AC voltage perturbation is applied across a range of frequencies. The frequency-dependent impedance reveals the equivalent circuit of the electrode.

**What the panel shows** (three view tabs):

1. **Nyquist** — real vs. imaginary impedance (−Z'' vs. Z'). The semicircle shape comes from the RC parallel element. A dashed Randles fit line is overlaid when the fit succeeds.

2. **Bode** — frequency vs. |Z| and phase angle on dual y-axes. Shows how impedance changes with frequency.

3. **Complex C** — C'(f) and C''(f) vs. frequency. The peak of C''(f) gives the relaxation frequency.

**Metrics**: ESR, τ₀, C_max, and if the Randles fit succeeds: R_s, R_ct, C_dl (displayed in blue chips to distinguish them from the general metrics).

### GCD (Galvanostatic Charge/Discharge)

**What it is**: A constant current is applied, and the voltage is recorded. The capacity (charge stored) per cycle is the key metric.

**What the panel shows**:
- Discharge capacity (mAh) vs. cycle number.
- Coulombic efficiency (%) — ratio of discharge to charge capacity per cycle.
- Total capacity fade (%) from first to last cycle.

### SEESAW (Gamry Cycle Folder)

**What it is**: When Gamry records each charge/discharge step as separate files (`charge_#1.dta`, `discharge_#1.dta`, etc.), those files can be uploaded together and are assembled into a single SEESAW entry.

**What the panel shows** (two view tabs):

1. **V–t** — voltage vs. cumulative time for the selected cycle range. Shows the charge/discharge profiles.

2. **dQ/dV** — differential capacity vs. voltage. dQ/dV peaks correspond to phase transitions and redox events. The user provides the applied current (mA), and smoothing is applied via a boxcar average.

---

## 8. Analysis: The Science Behind the Numbers

### Reference Electrode Conversion

Electrochemical potentials are always measured relative to a reference electrode. Different labs use different references (SCE, Ag/AgCl, Hg/HgO, RHE). To compare results across literature, all potentials need to be on the same scale.

The conversion is a simple offset: `E_display = E_measured + E_from_vs_SHE − E_to_vs_SHE`. The reference potentials vs. SHE are stored in `referenceElectrodes.ts`. RHE additionally depends on pH: `E_RHE_vs_SHE = 0.0592 × pH`.

### Capacitance Calculation

`C = ∮ I dV / (2 × ΔV × ν)`

- `∮ I dV` is the area enclosed by the CV loop (numerically, `numpy.trapezoid` on the I vs. V arrays).
- `ΔV` is the potential window width.
- `ν` is the scan rate in V/s.
- The `2 ×` denominator converts from the full-loop area to the capacitance (the loop area equals `2 × C × ΔV × ν` for a purely capacitive response).

Result in Farads, displayed as millifarads.

### Tafel Analysis

For electrocatalysis, the Butler-Volmer equation simplifies in the high-overpotential (Tafel) region to `log|j| = E/b + log|j₀|`. A linear fit in log|j| vs. E space gives:
- Tafel slope `b = 1000 / slope_linregress` (mV/decade) — lower is better, as it means a faster reaction at lower overpotential.
- Exchange current density `j₀ = 10^intercept` — the current density at zero overpotential.

### EIS Randles Fitting

The Randles circuit `Z(ω) = R_s + R_ct / (1 + jω·R_ct·C_dl)` represents:
- `R_s` — solution/contact resistance (the high-frequency intercept of the Nyquist semicircle on the real axis).
- `R_ct` — charge-transfer resistance (the diameter of the Nyquist semicircle).
- `C_dl` — double-layer capacitance (determines the frequency at the top of the semicircle).

The fit minimises the sum of squared residuals over both the real and imaginary parts simultaneously using `scipy.optimize.least_squares`. Bounds ensure all three parameters are non-negative. The initial guess is derived directly from the data (R_s from the high-frequency Z', R_ct from the Z' range).

### dQ/dV Analysis

For galvanostatic data with constant current `I`, the charge increment `dQ = I·dt`. Dividing by the voltage step `dV` gives `dQ/dV = I·dt/dV`.

Peaks in `dQ/dV` vs. V correspond to voltages where a lot of charge is stored for a small change in voltage — the signature of phase transitions (in battery materials) or redox reactions. Calculated client-side from the raw V–t data.

Points where |dV| < 0.5 mV are skipped to avoid division-by-zero noise. A boxcar (moving average) smoother of adjustable window size reduces noise.

---

## 9. Key Design Decisions

### Why the backend does parsing; the frontend only plots

The `.dta` format requires `gamry_parser` (a Python library) to decode correctly. Implementing that in JavaScript would require reimplementing a complex parser. Offloading parsing to the backend means the frontend receives clean JSON arrays — simple to plot with Plotly.

### Why analysis is done server-side, not in the browser

`scipy`, `numpy`, and the Randles curve-fitting algorithm don't run in JavaScript. More importantly, keeping analysis server-side means we can upgrade the math without touching the frontend, and the frontend stays a pure presentation layer.

### Why TanStack Query for analysis requests

Analysis results depend on the current state of multiple controls (scan rate, voltage window, number of curves). TanStack Query's `queryKey` array captures exactly which parameters were used for a cached result. When a control changes, the query re-fires automatically with the new key. This eliminates a large class of bugs (stale analysis shown after parameter change) and provides loading states for free.

### Why lazy loading for large CV files

A CV file with 500 cycles contains 500 voltage/current arrays, potentially millions of data points. Sending all of that in the upload response would make the browser tab slow and the initial load feel sluggish. Sending only the count and fetching ranges on demand keeps the upload fast. The panel only fetches the cycles the user is actually looking at.

### Why `useLayoutEffect` for grid layout rebuilds

`useEffect` fires after the browser has painted. When panels are added or removed, using `useEffect` for layout recalculation would cause a visible flash — the layout would be wrong for one frame. `useLayoutEffect` fires synchronously before paint, so the layout is always correct on the first render.

### Why `React.memo` on PlotPanel

The dashboard re-renders every time any file changes (because `files` is a new array reference). Without `React.memo`, every panel would re-render on every change, even if its own file hadn't changed. The custom comparator checks only `file` reference equality and `isCollapsed`, so a panel only re-renders when its own data or collapse state changes.

### Why a `FileLabelContext` instead of storing labels in ParsedFile

`ParsedFile` comes from the backend. Storing user-defined display names in it would mean serialising them alongside the file data. Keeping labels separate (in their own localStorage key) means the label system works independently of the file system — labels survive a "clear all" + re-upload if the files have the same IDs. (The IDs are UUIDs from the server, so this only works with sample data, which has fixed IDs.)

### Why background subtraction is done client-side

The background file's curves are already in the browser's memory. There's no need to send them to the server and back. The interpolation (`interpolateLinear` in `plotUtils.ts`) is simple binary search + linear interpolation, fast enough to run synchronously in a `useMemo`.

### Why the SEESAW store uses `OrderedDict` with manual eviction rather than a real cache

A production deployment would use Redis or a similar persistent cache. For a local development tool, an in-memory `OrderedDict` is sufficient. The eviction logic (pop the oldest entry when over capacity) mirrors LRU behaviour without a dedicated library.

---

## 10. State Management Architecture

There is no Redux or Zustand. State is managed at three levels:

**1. App-level state (`App.tsx`)**
- `files`, `comparisons`, `analyses` — the core session data.
- These are the "source of truth" for everything. Passed down as props.
- Mutated only through explicit handler functions (`addFiles`, `removeFile`, `patchFile`, `patchComparison`, etc.).

**2. Panel-local state**
- Each panel manages its own controls (cycle range, view mode, axis ranges, zoom state) independently.
- Controls that should persist across page refresh use `useLocalStorage(key, default)` with a unique key (typically `${file.id}.controlName`).
- Controls that reset on page refresh (expand/collapse of sub-sections, temporary hover states) use `useState`.

**3. Context state**
- `StyleContext` — which panel is "selected" (for per-panel style editing), global style, per-panel style overrides.
- `FileLabelContext` — custom display names, `getLabel(id, fallback)`.
- `ExportContext` — a registry where each panel registers export/collect callbacks; allows Sidebar to trigger exports across all panels.
- `ThemeContext` — UI theme (forest/dark/light), applied via CSS custom properties.

---

## 11. Context System

### `ExportContext`

Each panel calls `register(fileId, exportFn, collectFn)` in a `useEffect` on mount and `unregister(fileId)` on unmount. The two functions are stored in a `useRef`-backed map (not component state) so they don't trigger re-renders.

`exportAll(fmt)` iterates the registry and calls each panel's export function. `collectAll()` calls each panel's collect function to get `{ filename, csv, plotData, layout }` and then `buildZip` assembles a ZIP file in the browser using `JSZip`.

### `StyleContext`

Two layers: `globalStyle` (one `StyleSettings` object) and `panelStyles` (a `Record<string, StyleSettings>`). `useStyle(id)` returns `panelStyles[id] ?? globalStyle`. When `selectedId` is set in the Sidebar, style changes go to `panelStyles[selectedId]`; otherwise they go to `globalStyle`. A "Reset to global style" button deletes the panel override.

`applyStyleToData` and `applyStyleToLayout` in `applyStyle.ts` map the flat `StyleSettings` object to Plotly's nested data/layout structure. This keeps the mapping logic in one place.

### `FileLabelContext`

Stores `Record<string, string>` in `localStorage["gamry-labels"]` via `useLocalStorage`. `getLabel(id, fallback)` returns the custom label or `shortName(fallback)` (which strips the `.dta` extension). Setting an empty string clears the label (falls back to filename).

### `ThemeContext`

Stores the current `UITheme` in `localStorage["gamry-theme"]`. Applies it by setting a `data-theme` attribute on `document.documentElement`, which triggers Tailwind CSS custom property overrides defined in `index.css` for `--sidebar-bg`, `--sidebar-text`, etc.

---

## 12. Export System

### Single panel export

From the panel header's export dropdown: select PNG, SVG, CSV (or multiple). If one format is selected, the file downloads directly. If multiple formats are selected, a ZIP is built in the browser.

`exportPlotImage(data, layout, filename, fmt)` in `exportUtils.ts` uses Plotly's static image export API. `downloadCsv(content, filename)` creates a temporary `<a>` element and triggers a click.

### "Export all" from Sidebar

The Sidebar calls `exportAll(fmt)` or `collectAll()` which iterates the ExportContext registry. Every mounted panel has registered its own export and collect functions. If a panel isn't mounted (e.g., it has been collapsed or the component hasn't rendered yet), it simply won't be in the registry — the export silently skips it.

### CSV format

Each panel generates its own CSV with:
- Metadata comments at the top (lines starting with `#`), extracted from the `.dta` header.
- A header row (column names) and a units row.
- Data rows.

For CV: columns are `Pot_N, Cur_N` (one pair per cycle), plus normalised columns if normalisation is active.
For EIS: `Freq, Zreal, Zimag, Zmod, Zphz, C_prime, C_dbl` (complex capacitance columns added when analysis is available).

---

## 13. Style System

`StyleSettings` (defined in `styles/styleTypes.ts`) covers:

| Setting | Options |
|---------|---------|
| `colorScheme` | Forest, Tableau, Pastel, Monochrome, and others |
| `lineWidth` | 0.5 – 6 |
| `lineDash` | solid, dash, dot, dashdot |
| `showMarkers` | boolean |
| `markerSize` | 2 – 18 |
| `markerShape` | circle, square, diamond, triangle, cross, x |
| `mirrorAxes` | boolean |
| `tickDirection` | outside, inside |
| `axisLineColor` | hex color |
| `axisLineWidth` | 0.5 – 4 |
| `plotBgColor` | hex color |
| `showBorder` | boolean |
| `showXGrid`, `showYGrid` | boolean |
| `gridColor` | hex color |
| `gridLineStyle` | solid, dash, dot, dashdot |
| `gridLineWidth` | 0.5 – 3 |
| `fontFamily` | Inter, Arial, Courier New, Times New Roman, Helvetica |
| `fontSizeBody` | 8 – 20 |
| `fontSizeTitle` | 8 – 28 |
| `axisLabelFontSize` | 8 – 24 |
| `showLegend` | boolean |
| `legendX`, `legendY` | −0.5 – 1.5 |
| `legendOrientation` | v, h |
| `legendFontSize` | 8 – 18 |
| `framework` | Default, Nature, Science, ACS, Custom |

**Frameworks** are preset style combinations that match journal figure standards (e.g., "ACS" uses a white background, specific fonts, and a color scheme that prints in grayscale).

---

## 14. Persistence: localStorage

Three independent localStorage keys:

| Key | Content | When written |
|-----|---------|--------------|
| `gamry-session-v1` | `{ files, comparisons, analyses }` | On every state change |
| `gamry-labels` | `Record<fileId, customLabel>` | When a label is set or cleared |
| `app.style` | `StyleSettings` (global) | When any style control changes |

Panel-specific settings are stored with per-file keys like `${file.id}.scanRate`, `${file.id}.refFrom`, `${file.id}.eisView`, etc. These are written by `useLocalStorage` inside each panel component.

**Quota handling**: If the `gamry-session-v1` write fails with a quota error (typically 5–10 MB across all keys), the code retries after stripping curve arrays from CV files with more than 10 cycles. Those files are marked `partial: true`. CVPanel detects this flag and shows a "Re-upload to restore" message instead of a loading spinner.

---

## 15. Feature Reference

| Feature | Where implemented |
|---------|-------------------|
| File upload + parsing | `Sidebar.tsx`, `routers/files.py`, `gamry_plotter/data.py` |
| Sample data | `Sidebar.tsx`, `routers/files.py`, `gamry_plotter/demo.py` |
| CV/LSV plot | `panels/CVPanel.tsx` |
| EIS plot (Nyquist/Bode/Complex C) | `panels/EISPanel.tsx` |
| GCD plot | `panels/GCDPanel.tsx` |
| SEESAW / V–t / dQ/dV | `PlotPanel.tsx` (SeesawPanel function) |
| CV capacitance | `routers/analysis.py`, `gamry_plotter/analysis.py` |
| CV peak detection | `routers/analysis.py`, `gamry_plotter/data.py` |
| Tafel slope (LSV) | `routers/analysis.py`, `gamry_plotter/analysis.py` |
| EIS metrics (ESR, τ₀, C_max) | `routers/analysis.py`, `gamry_plotter/analysis.py` |
| EIS Randles fit | `routers/analysis.py`, `gamry_plotter/analysis.py`, `panels/EISPanel.tsx` |
| GCD capacity + coulombic efficiency | `routers/analysis.py` |
| Reference electrode conversion | `utils/referenceElectrodes.ts`, `panels/CVPanel.tsx` |
| Current normalisation (area/mass) | `panels/CVPanel.tsx` |
| CV background subtraction | `panels/CVPanel.tsx`, `utils/plotUtils.ts` |
| Comparison panels (overlay) | `ComparisonPanel.tsx`, `panels/CV/EIS/GCDComparePanel.tsx` |
| Per-trace visibility toggle | `panels/CVComparePanel.tsx`, etc. |
| Deep analysis sessions | `AnalysisPanel.tsx`, `panels/CV/EIS/GCDAnalysisPanel.tsx` |
| Scan rate analysis | `panels/ScanRateAnalysis.tsx` |
| Inline panel title editing | `PlotPanel.tsx` (PanelHeader), `ComparisonPanel.tsx`, `AnalysisPanel.tsx` |
| File label renaming | `context/FileLabelContext.tsx` |
| Collapsible panels | `Dashboard.tsx`, `PlotPanel.tsx`, `ComparisonPanel.tsx`, `AnalysisPanel.tsx` |
| Fullscreen panel mode | `components/FullscreenOverlay.tsx`, `PlotPanel.tsx` |
| Plot style editor | `Sidebar.tsx`, `context/StyleContext.tsx`, `utils/applyStyle.ts` |
| Per-panel style overrides | `context/StyleContext.tsx` |
| Export (PNG/SVG/CSV/ZIP) | `context/ExportContext.tsx`, `utils/exportUtils.ts` |
| Export all panels | `Sidebar.tsx`, `context/ExportContext.tsx` |
| Session persistence | `App.tsx` |
| Error file handling | `routers/files.py`, `PlotPanel.tsx`, `Sidebar.tsx` |
| Axis range + log scale + labels | All panel components, `utils/plotUtils.ts` |
| Zoom state preservation | `hooks/useZoom.ts` |
| Responsive legend font | `hooks/useContainerSize.ts` |
| Drag-to-reorder grid | `Dashboard.tsx` (react-grid-layout) |
| Resize panels | `Dashboard.tsx` (react-grid-layout) |
| UI theme switching | `context/ThemeContext.tsx`, `index.css` |
| Rate limiting | `limiter.py`, `routers/*.py` |
| Info modals (formula explanations) | `components/InfoModal.tsx`, each panel |
