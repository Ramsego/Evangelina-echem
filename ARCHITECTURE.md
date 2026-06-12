# Architecture

This document explains the technical decisions behind the Gamry Dashboard — not just *what* was built, but *why*.

---

## Why React + FastAPI instead of Streamlit or Dash

The project started as a Streamlit app. Streamlit is excellent for rapid scientific prototyping: you write Python, refresh, and see a UI. But Streamlit has a fundamental limitation — every user interaction triggers a full Python re-run from top to bottom. This makes it fight you on:

- **Custom interactivity** — draggable panels, stateful layouts, and dynamic UI manipulation are not Streamlit's model
- **Performance** — re-running analysis on every slider move is wasteful
- **Future features** — the planned drag-to-merge panels feature is simply not possible in Streamlit

**Dash** (Plotly's framework) avoids the re-run problem but uses a callback graph: you define inputs and outputs, and Dash wires them. This works for fixed dashboards. It becomes complex and fragile when panel *identity* is dynamic — when the user can add, remove, or merge panels at will.

**React + FastAPI** gives:
- A proper component model — each panel is an independent React component with its own state
- Full control over layout (react-grid-layout)
- A clean, stateless analysis API that any client could call
- A foundation that can support the planned drag-to-merge feature

**FastAPI over Flask**: FastAPI validates request and response types automatically via Pydantic, has built-in async support, and generates an interactive API browser at `/docs` for free.

---

## The client–server split

```
Browser (React)                        Server (FastAPI)
──────────────────────────────         ──────────────────────────────
Stores: all file data after upload     Stores: nothing (except SEESAW)
Knows: current UI state, parameters    Knows: how to compute things
Does:  renders plots, manages layout   Does:  parses .dta, runs analysis
```

When the user changes a parameter (e.g. scan rate), the browser sends the *data* plus the *new parameter* back to the server, gets a result, and updates the plot. The server never needs to remember which file belongs to which user or session.

This "stateless analysis" model has important consequences:
- The backend can be restarted at any time without losing anything visible to the user
- Parameters changing in the UI automatically trigger a fresh analysis (TanStack Query handles this)
- Caching is free — if you set the scan rate back to its previous value, the cached result is used

---

## Why SEESAW is the exception

A SEESAW experiment can contain thousands of charge/discharge cycles — potentially hundreds of megabytes of voltage/time data. Sending all of that to the browser on upload would be slow and wasteful, since the user typically only wants to view a small range of cycles at a time.

The solution: on upload, the raw cycle data is stored in `_seesaw_store` (an in-memory Python dict, keyed by the file's stable ID). The upload response returns only metadata: which cycle numbers are available.

```
Upload response for SEESAW:
  { id, name, etype: "SEESAW", all_cycles: [1, 2, ..., 2500] }
  — no data

On-demand fetch:
  GET /api/files/{id}/cycles?start=100&end=110
  → { times: [...], voltages: [...] }
```

The cost: if the backend restarts, SEESAW data is lost and the user must re-upload. This is acceptable for a local tool.

---

## Panel routing

`PlotPanel.tsx` is a thin router. Its only job is to read `file.etype` and render the correct panel component. It also renders the shared panel header (drag handle, filename, etype badge, close button).

```
PlotPanel
├── etype "SEESAW"                   → SeesawPanel  (inline — simpler than a separate file)
├── etype "CV" | "LSV"               → CVPanel
├── etype "EISPOT"                   → EISPanel
└── etype "CHRONOP" | "PWR800_*"    → GCDPanel
```

Each panel is completely self-contained. It receives one prop (`file: ParsedFile`) and manages everything else itself. This means adding a new experiment type has zero impact on any existing panel.

---

## Why TanStack Query for analysis calls

The naive approach would be to call the analysis endpoint inside a `useEffect` that runs when parameters change. This has problems:
- Rapid parameter changes (e.g. dragging a slider) would fire many simultaneous requests
- You'd need to manage loading, error, and stale states manually
- There is no caching, so going back to a previous parameter set re-fetches

TanStack Query solves all of this. Each call is identified by a **query key** — an array of values that uniquely identifies the request. When any value in the key changes, a new fetch is scheduled. Results are cached by key, and rapid changes are debounced automatically.

```typescript
useQuery({
  queryKey: ["cv", file.id, scanRate, vOffset, imDivisor, peaks, prom, lo, hi],
  queryFn:  () => analyzeCV({ ... }),
})
```

When the user changes the scan rate, `scanRate` in the key changes → new fetch → new result. When they change it back, the cached result is returned instantly.

---

## The Plotly height problem

Plotly measures its container's pixel height at render time. Inside a CSS flexbox, an element's height resolves to the height of its content by default — if the content is empty (as Plotly's placeholder is before it renders), the height is zero, and the chart vanishes.

The fix used in every panel:

```tsx
<div className="relative flex-1 min-h-0">   {/* flex child; min-h-0 allows it to shrink */}
  <div className="absolute inset-0">          {/* fills parent with real pixel dimensions */}
    <Plot style={{ width: "100%", height: "100%" }} useResizeHandler />
  </div>
</div>
```

`min-h-0` overrides the default `min-height: auto` that prevents flex children from shrinking below their intrinsic content size. With that overridden, the flex layout correctly distributes the remaining height. The `absolute inset-0` inner div then has concrete pixel dimensions that Plotly can measure.

---

## react-grid-layout and width measurement

`WidthProvider` — the standard HOC from react-grid-layout that automatically measures container width — reads `offsetWidth` synchronously when it mounts. Inside a flex container, this fires before the browser has completed layout, and the measurement returns 0.

The fix: use plain `GridLayout` (not `ResponsiveGridLayout`) and measure width explicitly with a `ResizeObserver`:

```typescript
const [width, setWidth] = useState(() => Math.max(window.innerWidth - 256, 400));

useEffect(() => {
  const ro = new ResizeObserver(([entry]) => {
    if (entry.contentRect.width > 0) setWidth(entry.contentRect.width);
  });
  ro.observe(containerRef.current);
  return () => ro.disconnect();
}, []);
```

`ResizeObserver` fires asynchronously after layout is complete, so the measurement is reliable.

---

## Panel auto-sizing

Rather than letting users manually resize panels (which caused visual issues in early versions), panel dimensions are computed automatically from the total number of loaded files:

| Files | Grid columns (of 12) | Grid rows |
|-------|----------------------|-----------|
| 1     | 12 — full width      | 9         |
| 2–4   | 6 — half width       | 7         |
| 5–6   | 4 — one third        | 6         |
| 7+    | 3 — one quarter      | 6         |

The layout is rebuilt entirely whenever the file count changes, so the grid always looks balanced. Users can still drag panels to rearrange within the grid.

---

## The forest color system

The dark green palette was matched exactly from the original Streamlit app's custom colors. It is defined as a custom Tailwind scale in `tailwind.config.js` and referenced throughout as `forest-{weight}`. All Plotly figure colors are hardcoded hex values that match this palette.

Using a named scale (rather than arbitrary hex values in classes) means: changing the entire palette requires editing one file. It also documents intent — `border-forest-700` communicates "this is a medium-weight border" rather than "this happens to be #1B4332".
