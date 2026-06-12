# Gamry Dashboard — Claude Instructions

This file is loaded automatically at the start of every Claude Code session.
Follow these rules exactly. They exist because of hard-won decisions made during development.

---

## Running the project

Two terminals are required:

```bash
# Terminal 1 — Backend (http://localhost:8000)
cd backend
uvicorn main:app --reload

# Terminal 2 — Frontend (http://localhost:5173)
cd frontend
npm run dev
```

---

## Color system — CRITICAL, do not deviate

The entire UI uses a custom `forest` Tailwind scale. **Never introduce `slate-*`, `violet-*`, `zinc-*`, or arbitrary hex values into component classes.**

| Token       | Hex       | Role                              |
|-------------|-----------|-----------------------------------|
| forest-950  | #050E08   | Deepest background                |
| forest-900  | #0B1610   | App background                    |
| forest-850  | #0D1C14   | Plot background                   |
| forest-800  | #111E16   | Panel cards                       |
| forest-700  | #1B4332   | Borders, grid lines               |
| forest-600  | #2D6A4F   | Axis lines, active button bg      |
| forest-400  | #52B788   | Tick labels                       |
| forest-300  | #74C69D   | Primary text, axis titles         |
| forest-200  | #A8D5BA   | Legend text                       |

**Permitted exceptions:**
- `amber-*` — SEESAW file badge only
- `red-400` — remove (✕) button hover only

**Panel control strips and form controls** use theme-aware `panel-*` tokens, never `gray-*`:
- Strip container: `bg-panel-header border-b border-panel-border text-xs text-panel-text`
- Inputs/selects: `bg-panel-bg border border-panel-border rounded px-1 py-0.5 text-panel-text focus:outline-none focus:ring-1 focus:ring-forest-400`
- Active toggle button (Zoom/Pan/Axes): `bg-forest-600 border-forest-600 text-white`; inactive: `text-panel-muted hover:text-panel-text`

These tokens resolve per theme (forest/dark/light) via CSS variables in `frontend/src/index.css`, so controls stay legible in every theme. Do not reintroduce `bg-gray-100`/`text-gray-900` controls bars.

Plotly figures use hardcoded hex values from this palette — that is intentional and correct.

---

## Panel architecture

Every analysis panel lives in `frontend/src/components/panels/`.

`PlotPanel.tsx` is the **router only** — it reads `file.etype` and renders the correct panel. Do not add analysis logic or state to `PlotPanel.tsx`.

Each panel component:
- Receives `{ file: ParsedFile }` as its only prop
- Owns all its own local state (controls, view toggles)
- Calls analysis endpoints via TanStack Query
- Builds its Plotly figure inline
- Uses this exact structure for the plot container (required for Plotly height to work):

```tsx
<div className="relative flex-1 min-h-0">
  <div className="absolute inset-0">
    <Plot ... style={{ width: "100%", height: "100%" }} useResizeHandler />
  </div>
</div>
```

### Metrics row pattern

Every panel with computed metrics follows this pattern:
- Dark metrics row: `bg-forest-900/50 border-b border-forest-700/30`
- Metric chips: `text-[10px] text-forest-300 bg-forest-800 rounded px-2 py-0.5`
- A `?` button at `ml-auto` opens an `InfoModal` with formula explanations

---

## Adding a new panel type — checklist

1. Add a Pydantic model + `@router.post("/xxx")` in `backend/routers/analysis.py`
2. Add `export async function analyzeXxx(body: object)` in `frontend/src/api/client.ts`
3. Create `frontend/src/components/panels/XxxPanel.tsx`
4. Add the routing condition in `PlotPanel.tsx`
5. Add the etype to `ETYPE_LABEL` and `ETYPE_COLOR` maps in `PlotPanel.tsx`

---

## Backend analysis pattern

Analysis is **stateless**: the client sends all required data with each request.
The backend never stores file data between requests (except SEESAW — see ARCHITECTURE.md).

```python
class XxxRequest(BaseModel):
    field: type = default

@router.post("/xxx")
def analyze_xxx(req: XxxRequest) -> dict:
    # compute and return plain dict
    return { "result": value }
```

---

## Edit discipline

- **Always use `Edit`, never `Write`, on existing files.** Write replaces the entire file.
- When changing CSS/colors: make targeted edits to the specific className string only.
- When fixing a bug: touch only the lines that are wrong.
- Do not add abstractions, helpers, or refactors beyond what the task requires.
- Do not add error handling for cases that cannot happen.
- Do not write comments that describe what the code does — only write them when the *why* is non-obvious.
- Do not add backwards-compatibility shims or unused variable renames.

---

## File structure reference

```
gamry-dashboard/
├── CLAUDE.md
├── README.md
├── ARCHITECTURE.md
├── LEARNING.md
├── backend/
│   ├── main.py                  # FastAPI app, CORS, router registration
│   ├── requirements.txt
│   └── routers/
│       ├── files.py             # Upload, sample, SEESAW on-demand cycles
│       └── analysis.py          # CV, Tafel, EIS, GCD endpoints
└── frontend/
    ├── tailwind.config.js       # forest color scale defined here
    ├── vite.config.ts           # nodePolyfills required for plotly.js
    └── src/
        ├── App.tsx              # Landing ↔ Dashboard switch
        ├── api/client.ts        # All fetch wrappers
        ├── types/index.ts       # ParsedFile, EISData, GCDData, EType
        └── components/
            ├── Dashboard.tsx    # react-grid-layout, ResizeObserver width
            ├── PlotPanel.tsx    # Panel router + PanelHeader + SeesawPanel
            ├── Sidebar.tsx      # File list, upload button
            ├── LandingPage.tsx  # Shown when files.length === 0
            ├── InfoModal.tsx    # Reusable calculation explanation modal
            └── panels/
                ├── CVPanel.tsx  # CV + LSV + Tafel
                ├── EISPanel.tsx # Nyquist / Bode / Complex Capacitance
                └── GCDPanel.tsx # Cycle life + CE overlay
```
