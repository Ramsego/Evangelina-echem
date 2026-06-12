# Product Release Summary

This document summarizes the product and technical direction discussed for Gamry Dashboard / EChem Studio.

## Current Direction

The app started as a portfolio project and local research tool, but it is useful enough to justify a hosted version. The goal is not to build a full SaaS product yet. The near-term target is a hosted, recruiter-friendly, researcher-usable MVP with real uploads, sample data, and clear privacy limits.

The strongest positioning is:

> A domain-specific scientific analysis dashboard for Gamry electrochemistry data, built with React and FastAPI, then audited, documented, tested, hardened, and deployed.

It is acceptable and honest to say AI tools accelerated development, as long as the architecture, tradeoffs, security model, and domain calculations can be explained clearly.

## Hosting Decision

We decided that asking non-technical researchers to clone the repo and run two terminals would reduce the product's usefulness too much. The app should be hosted.

Hosted uploads mean user data touches the server, so the app should not claim that data stays entirely local. Instead, the privacy model should be:

- files are processed temporarily for analysis;
- raw uploads are not stored permanently;
- temporary files are deleted after parsing;
- parsed in-memory data expires automatically;
- users can clear/delete uploaded data;
- no account system or permanent database is needed for MVP.

The product should include a plain privacy note near upload:

> Files are processed temporarily for analysis and are not stored permanently. Data expires automatically.

## Hosted Release Blockers

Before releasing real hosted uploads, implement these:

1. Sanitize uploaded filenames before writing them to disk.
2. Add TTL expiration for cached CV, GCD, and SEESAW parsed data.
3. Add a `DELETE /api/files/{file_id}` endpoint to purge cached server data.
4. Call that delete endpoint from the frontend when users remove files or clear all files.
5. Move upload limits, cache TTL, and uploads enabled/disabled into environment variables.
6. Add an `UPLOADS_ENABLED=false` kill switch so sample data still works if uploads must be disabled.
7. Require exact production CORS origins via `ALLOWED_ORIGINS`.
8. Avoid logging file contents and avoid sensitive filename logging in production.
9. Improve frontend error messages for uploads disabled, file too large, rate limited, and cache expired.
10. Make the production frontend build reproducible. The current normal build can hit Node heap limits, so either set a larger heap in the build script or reduce the Plotly bundle size.

## Cost Control

The hosted version should be designed to avoid surprise costs.

Recommended controls:

- no permanent file storage;
- no database for MVP;
- strict file size and total upload limits;
- rate limits on upload and analysis endpoints;
- fixed-size backend instance, no autoscaling at first;
- provider spending alerts or hard caps where available;
- upload kill switch;
- sample-data demo always available.

## Product Gaps For Researcher Usefulness

The current app is already a strong viewer/analyzer. To become something researchers genuinely use, it needs to become a repeatable analysis workspace.

Important missing product features:

1. Project/session organization: project name, sample labels, groups, saved sessions.
2. Editable metadata: material, electrolyte, electrode area, active mass, reference electrode, pH, voltage window, notes.
3. Analysis provenance: every export should record settings, formulas, file names, and app/analysis version.
4. Trustworthy fitting: visible fit windows, manual window controls, warnings, R2/RMSE, and confidence intervals where reasonable.
5. Stronger comparison workflow: compare by sample group, cycle, scan-rate series, treatment, and saved comparison panels.
6. Batch analysis: analyze all CV/GCD/EIS files and export one summary table.
7. Publication exports: figure presets, export bundle, CSV, TXT summaries, and later report generation.
8. Data cleaning: crop ranges, exclude bad cycles, smoothing, baseline correction, background subtraction, iR correction, and spike/artifact handling.
9. Guided onboarding: sample walkthrough, clear empty state, better tooltips, and clearer control labels.
10. Validation against known tools such as Gamry Echem Analyst, Origin, or hand calculations.

## Researcher-Useful V1

A practical v1 for real researchers should include:

1. Upload `.dta` files.
2. Assign and edit sample metadata.
3. Compare selected files cleanly.
4. Run batch analysis.
5. Export publication-ready figures.
6. Export one summary table.
7. Export analysis settings and provenance.
8. Show reliability warnings when calculations may be weak.

## Portfolio Value

For job searching, the hosted app should demonstrate more than visuals. It should show product judgment and engineering ownership:

- live demo link;
- sample data;
- screenshots or demo GIF;
- architecture diagram;
- security and privacy model;
- tests for scientific calculations;
- deployment notes;
- clear roadmap;
- honest AI-assisted development note.

The best interview story is not "I wrote every line alone." It is:

> I used AI to accelerate a domain-specific product, then learned the codebase, audited the architecture, hardened the security model, added tests and documentation, and deployed it responsibly.
