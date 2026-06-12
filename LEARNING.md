# Learning Guide — Gamry Dashboard

This document is written for you, Sebastian. It explains *why* the project is built the way it is, what concepts matter, and what to learn next if you want to get better at directing AI to build serious software.

---

## What "vibe coding" actually is

"Vibe coding" is a real skill, but it is often misunderstood. The goal is not to describe what you want and hope the AI figures it out. The goal is to be a good **technical director**: someone who understands the system well enough to make decisions, spot when something is wrong, and give precise instructions.

A good film director does not need to operate a camera. But they need to understand what a camera can and cannot do, why a certain lens choice changes the mood, and when the cinematographer is solving the wrong problem. Your role in this project is that director.

The better your technical understanding, the more precise your instructions, the better the output. This guide is about building that understanding.

---

## The mental model you need

Think of this project as three separate concerns that communicate through well-defined interfaces:

```
[ Browser (React) ]  ←→  [ API (FastAPI) ]  ←→  [ Data & Analysis (Python) ]
  "What the user sees"     "The contract"          "The science"
```

You already understand the third layer — electrochemistry, what a Tafel slope means, what ESR is. That domain knowledge is what makes you a better director than someone building a generic dashboard. Use it.

The first two layers are what this guide will help you understand.

---

## Layer 1: The browser (React)

### Components and state

React is built around two ideas:

**Components** are functions that return HTML. This entire project is made of nested components:
```
App
└── Dashboard
    └── PlotPanel (one per file)
        └── CVPanel / EISPanel / GCDPanel
            └── Plot (from Plotly)
```

**State** is data that, when it changes, causes the component to re-render (update the screen). Every time you change the scan rate in the controls bar, that's a piece of state changing, which triggers a re-render of the plot.

```typescript
const [scanRate, setScanRate] = useState(10);
//      ↑ current value   ↑ function to update it   ↑ initial value
```

This is the most fundamental pattern in React. Every control you see — every input, checkbox, select — is backed by a `useState` call.

### Why one component per panel?

In the early version, all rendering went through a single `buildFigure` function. This worked until you needed interactive controls — because controls require state, and state lives inside components. Moving to `CVPanel`, `EISPanel`, and `GCDPanel` as separate components meant each panel could have its own scan rate, its own reference electrode selection, its own normalization — completely independent from the others.

This is the principle of **component isolation**: if two things can change independently, they should be in separate components.

### Props: how components talk to their parents

A component receives data from its parent via **props** (short for properties). `CVPanel` receives `{ file: ParsedFile }` as its prop — the file data the parent already has. The parent does not need to know anything about scan rates, peaks, or Tafel analysis. That's `CVPanel`'s business.

### TypeScript: why the types matter

TypeScript adds types to JavaScript. This line:

```typescript
export interface ParsedFile {
  id: string
  name: string
  etype: EType
  curves?: CurveData[]
  eis?: EISData
  gcd?: GCDData
}
```

...means: whenever you use a `ParsedFile`, you know exactly what fields it has, and the editor will tell you if you access something that does not exist. For a scientific tool where `eis` might be undefined on a CV file, this prevents entire classes of bugs.

Think of TypeScript types as **documentation that the computer checks**. They are the single biggest productivity improvement in the JavaScript ecosystem.

---

## Layer 2: The API (FastAPI)

### Request-response

The browser cannot run Python. The browser cannot import `gamry-parser`. So whenever the browser needs analysis done, it sends an HTTP request to the backend and waits for a response.

```
Browser                           Backend
  │                                  │
  │  POST /api/analyze/cv            │
  │  { curves: [...], scan_rate: 10 }│
  │ ──────────────────────────────► │
  │                                  │  cv_capacitance(dfs, 10)
  │  { capacitances_mf: [2.4, 2.3] }│
  │ ◄──────────────────────────────  │
  │                                  │
```

This is the pattern for every analysis call in the project. The browser is the *client*, the Python server is the *server*, and the data flows between them as JSON.

### Why stateless?

The backend holds no memory of previous requests. When you change the scan rate, the browser sends the full curve data again, not just "update the scan rate." This seems wasteful but it has huge advantages:

- The server can restart at any time without breaking anything
- Any panel can be refreshed independently
- There is no "state gets out of sync" bug class

The only exception is SEESAW, where the data is too large to send back and forth efficiently. That trade-off is documented in ARCHITECTURE.md.

### Pydantic models

FastAPI uses Pydantic to validate incoming data:

```python
class CVRequest(BaseModel):
    curves:       list[Curve]
    scan_rate_mv: float = 10.0
    v_offset:     float = 0.0
```

This means: if the browser sends a request without `curves`, or with `scan_rate_mv` as a string instead of a number, the server automatically returns a clear error rather than crashing in some obscure way. It also means the API is self-documenting — visit `http://localhost:8000/docs` and you can see every endpoint and try it from the browser.

---

## How TanStack Query connects the two layers

TanStack Query is the library that manages the browser's relationship with the API. Without it, you would write code like this yourself:

```typescript
useEffect(() => {
  fetch('/api/analyze/cv', { method: 'POST', body: JSON.stringify(params) })
    .then(r => r.json())
    .then(data => setResult(data))
}, [scanRate, vOffset, ...]);
```

This works, but it has problems: if `scanRate` changes 10 times a second (slider), you fire 10 requests and get results back in random order. You also need to handle loading states, errors, and caching yourself.

TanStack Query handles all of this. You give it a **query key** (an array of all the values the result depends on) and a **query function** (the fetch call), and it manages the rest:

```typescript
useQuery({
  queryKey: ["cv", file.id, scanRate, vOffset, ...],
  queryFn:  () => analyzeCV({ curves, scan_rate_mv: scanRate, v_offset: vOffset }),
})
```

When `scanRate` changes, the key changes, a new fetch fires. When the user scrolls back to the previous scan rate, the cached result is returned instantly. This is what makes the controls feel responsive.

---

## What to learn next — in priority order

### 1. HTML & CSS fundamentals (1–2 weeks)
Before going deeper into React, make sure you understand the basics of HTML (what elements are, how nesting works) and CSS (the box model, flexbox, what `position: relative/absolute` does). Tailwind is just CSS — if you understand CSS, you can read and write Tailwind confidently.

**Resource:** [The Odin Project — Foundations](https://www.theodinproject.com/paths/foundations)
Focus on the HTML and CSS sections. You do not need to do the JavaScript part yet.

**Why this matters for this project:** The Plotly height fix (the `relative/flex-1/min-h-0/absolute inset-0` pattern) only makes sense if you understand `position: relative` and `position: absolute`. Right now you're using it because it works — after learning this, you'll know *why* it works.

### 2. JavaScript basics (2–3 weeks)
TypeScript is JavaScript with types added on top. You need to understand JavaScript first:
- Variables (`const`, `let`)
- Functions (arrow functions: `(x) => x * 2`)
- Arrays and their methods (`.map()`, `.filter()`, `.reduce()`)
- Objects and destructuring
- `async/await` and `fetch`
- Modules (`import`/`export`)

**Resource:** [javascript.info](https://javascript.info/) — The best JavaScript reference. Read Part 1 (The JavaScript Language).

**Why this matters:** Almost every line of TypeScript code in this project uses `.map()` to transform arrays (convert raw current values to mA, filter invalid data points, etc.). Understanding this is the difference between reading code and understanding it.

### 3. React fundamentals (2 weeks)
Once you understand JavaScript, React is not that complex. The core ideas are:
- Components as functions
- JSX (the HTML-like syntax inside JavaScript files)
- `useState` for local state
- `useEffect` for side effects
- Props for passing data down

**Resource:** [React official docs — Learn React](https://react.dev/learn). Read the entire "Learn" section. It is well-written and directly applicable to this project.

**Why this matters:** Right now when the AI writes a `useEffect` or adds a `useState`, you don't fully know what it does. After this, you will — and you'll be able to spot when the AI is adding unnecessary state or creating a re-render problem.

### 4. TypeScript (1 week)
After JavaScript, TypeScript is a short step. The main concepts to learn:
- Primitive types (`string`, `number`, `boolean`)
- Interfaces and types (you've already seen `ParsedFile`)
- Union types (`"none" | "area" | "mass"`)
- Generics (the `<T>` syntax)
- Optional properties (`curves?: CurveData[]` — the `?` means it might not exist)

**Resource:** [TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/intro.html) — read the first 5 sections.

### 5. HTTP and REST APIs (half a day)
Understand what GET, POST, and JSON actually are. You don't need to be able to build a server from scratch — you need to understand the vocabulary.

**Resource:** [MDN — HTTP overview](https://developer.mozilla.org/en-US/docs/Web/HTTP/Overview)

### 6. Python: FastAPI and Pydantic (1 week)
You already know Python (you wrote the Streamlit app and the analysis functions). The FastAPI-specific parts to learn:
- `@router.post("/path")` decorators
- Pydantic `BaseModel` and how validation works
- How to return a dict (FastAPI serialises it to JSON automatically)

**Resource:** [FastAPI official tutorial](https://fastapi.tiangolo.com/tutorial/) — just the first 10 sections.

---

## How to be a better AI director

These are the habits that make the most difference:

### Be specific about *what* not just *what you want*
Bad: "Make the graphs look better."
Good: "The y-axis label on the CV panel is too close to the axis. Increase the left margin from 56px to 72px."

The more specific you are, the less the AI has to guess. Guessing is where things go wrong.

### Learn to read error messages
Error messages are not cryptic — they are very precise. "Cannot read properties of undefined (reading 'map')" means: you called `.map()` on something that was `undefined`. That tells you exactly where to look.

When you share an error with the AI, always share the full message and the stack trace (the list of file names and line numbers below the message).

### Know which file to point at
If something looks wrong on screen, ask yourself: "Is this a frontend problem or a backend problem?" Frontend = wrong data being displayed, wrong layout, wrong colors. Backend = wrong values computed, wrong data returned.

Pointing the AI at the right file immediately saves multiple back-and-forth messages.

### Question full file rewrites
If the AI tries to use the `Write` tool (not `Edit`) on an existing file, ask why. A full rewrite can silently remove things that were working. Targeted edits are always safer.

### Ask "why" as much as "what"
The best use of an AI for learning is to ask it to explain the choice it just made. "Why `min-h-0` and not just `height: 100%`?" The answer teaches you something you can use next time without asking.

### Build a mental map of what changes what
After each session, ask yourself: "Which files were touched, and what layer do they belong to?" If you changed the scan rate input and the color of a chip, that's one file (CVPanel.tsx). If you also changed the formula for capacitance, that's two files (CVPanel.tsx + analysis.py). Keeping this map in your head is what separates directing from guessing.

---

## A note on this project specifically

You started with a scientific tool that already worked — the Streamlit app — and rebuilt it in a more capable framework because you had a clear vision of what it should become. That is an unusually good starting position. Most learners build toy projects with no real purpose. You have a real purpose, real data, and real domain knowledge. That is a significant advantage.

The next features on the list (export, drag-to-merge panels, per-file curve comparison) are all achievable. Each one will teach you something new — exports will teach you about file generation in the browser, drag-to-merge will teach you about complex React state. Build them one at a time and read the code the AI produces. That is the fastest path forward.
