/**
 * The one stylesheet of `report.html`, inlined in its `<style>` and allowed by its hash in the page's content
 * security policy (src/html-report.ts). The colours are the project page's (`site/site.css`): the night banner,
 * the gold, the violet accent, light and dark by `prefers-color-scheme`. No web font, no image, no `url()`.
 * Nothing in it comes from a scan: a colour pair's swatches are SVG `fill` attributes, not styles.
 */
export const REPORT_CSS = `
:root {
  --bg: #f7f4fc;
  --text: #1d1533;
  --muted: #4a4163;
  --panel: #ffffff;
  --quote: #f1edf9;
  --line: rgba(29, 21, 51, 0.16);
  --accent: #5a2ea6;
  --night: linear-gradient(160deg, #33245f 0%, #21174a 55%, #150e2e 100%);
  --on-night: #f3effb;
  --on-night-muted: #d2c9ea;
  --gold: #f0c35a;
  --critical-bg: #fde2e1;
  --critical-text: #8a1116;
  --serious-bg: #fde9d4;
  --serious-text: #7a3a00;
  --moderate-bg: #fbf1c7;
  --moderate-text: #5e4700;
  --minor-bg: #e6e9f2;
  --minor-text: #33405c;
  --mono: "Cascadia Code", "Fira Code", Menlo, Consolas, ui-monospace, monospace;
  color-scheme: light dark;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #110c20;
    --text: #ece8f7;
    --muted: #bcb3d6;
    --panel: #1b1432;
    --quote: #140f27;
    --line: rgba(236, 232, 247, 0.18);
    --accent: #cdb8ff;
    --critical-bg: #4a1517;
    --critical-text: #ffc9c6;
    --serious-bg: #4a2a0d;
    --serious-text: #ffd5a8;
    --moderate-bg: #3f3410;
    --moderate-text: #f6df8a;
    --minor-bg: #262c3d;
    --minor-text: #cdd5ea;
  }
}
html,
body {
  margin: 0;
  padding: 0;
  background: var(--bg);
  color: var(--text);
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  line-height: 1.55;
}
.skip {
  position: absolute;
  top: 8px;
  left: 8px;
  z-index: 1;
  padding: 10px 16px;
  border-radius: 6px;
  background: var(--panel);
  color: var(--accent);
  font-weight: 600;
  transform: translateY(-200%);
}
.skip:focus {
  transform: none;
}
:focus-visible {
  outline: 3px solid var(--accent);
  outline-offset: 2px;
}
main:focus {
  outline: none;
}
.page {
  box-sizing: border-box;
  max-width: 980px;
  margin: 0 auto;
  padding: 0 16px 24px;
}
@media (min-width: 600px) {
  .page {
    padding: 0 24px 32px;
  }
}
a {
  color: var(--accent);
  text-underline-offset: 0.2em;
}
code,
pre {
  font-family: var(--mono);
  font-size: 0.9em;
}
code {
  overflow-wrap: anywhere;
}
.banner {
  margin-top: 16px;
  padding: 20px;
  border-radius: 16px;
  background: var(--night);
  color: var(--on-night);
  --accent: var(--gold);
}
.banner h1 {
  margin: 0 0 8px;
  font-size: 1.75rem;
  line-height: 1.2;
}
.banner .brand {
  margin: 0;
  color: var(--gold);
  font-weight: 700;
  letter-spacing: 0.04em;
}
.banner p {
  margin: 8px 0 0;
  color: var(--on-night-muted);
}
.banner code {
  color: var(--on-night);
}
nav {
  margin: 16px 0 0;
}
nav ul {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 16px;
  margin: 0;
  padding: 0;
  list-style: none;
}
nav a {
  display: inline-block;
  padding: 4px 0;
}
h2 {
  margin: 40px 0 12px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--line);
  font-size: 1.4rem;
  line-height: 1.25;
}
h3 {
  margin: 0 0 12px;
  font-size: 1.15rem;
  line-height: 1.35;
}
.card {
  margin: 16px 0;
  padding: 16px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--panel);
}
.summary {
  border-collapse: collapse;
  min-width: 14rem;
}
.summary caption {
  padding-bottom: 4px;
  text-align: left;
}
.summary th,
.summary td {
  padding: 6px 12px;
  border-bottom: 1px solid var(--line);
  text-align: left;
}
.summary td {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.chip {
  display: inline-block;
  padding: 1px 8px;
  border-radius: 999px;
  border: 1px solid currentColor;
  font-size: 0.85rem;
  font-weight: 700;
  vertical-align: 0.1em;
}
.impact-critical {
  background: var(--critical-bg);
  color: var(--critical-text);
}
.impact-serious {
  background: var(--serious-bg);
  color: var(--serious-text);
}
.impact-moderate {
  background: var(--moderate-bg);
  color: var(--moderate-text);
}
.impact-minor {
  background: var(--minor-bg);
  color: var(--minor-text);
}
/* A new finding is filled; one still open is outlined and dashed; a fixed one is plain. The words say which. */
.status-new {
  border-color: var(--accent);
  background: var(--accent);
  color: var(--bg);
}
.status-still {
  border-style: dashed;
  background: transparent;
  color: var(--muted);
}
.status-fixed {
  background: transparent;
  color: var(--text);
}
.facts {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 2px 16px;
  margin: 0;
}
@media (min-width: 600px) {
  .facts {
    grid-template-columns: 9rem minmax(0, 1fr);
  }
}
.facts dt {
  color: var(--muted);
  font-weight: 600;
}
.facts dd {
  margin: 0 0 8px;
}
.facts ul {
  margin: 0;
  padding-left: 1.2em;
}
.fix {
  font-weight: 600;
}
.banner .meta {
  font-size: 0.9rem;
}
.total {
  margin: 0 0 8px;
  font-weight: 600;
}
.note {
  margin: 16px 0 0;
  color: var(--muted);
  font-size: 0.9rem;
}
details {
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid var(--line);
}
summary {
  width: fit-content;
  color: var(--accent);
  font-weight: 600;
  cursor: pointer;
}
details[open] > summary {
  margin-bottom: 12px;
}
.fixed p {
  margin: 0;
}
.elements {
  margin: 16px 0 0;
  padding: 0;
  list-style: none;
}
.elements > li {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--line);
}
.elements p {
  margin: 0 0 6px;
}
.label {
  color: var(--muted);
  font-size: 0.9rem;
}
pre {
  box-sizing: border-box;
  max-width: 100%;
  margin: 0 0 10px;
  padding: 10px 12px;
  border-left: 3px solid var(--line);
  border-radius: 6px;
  background: var(--quote);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.pair {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 16px;
  margin: 0 0 10px;
}
.swatch {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.swatch svg {
  flex: none;
  border: 1px solid var(--muted);
  border-radius: 4px;
}
.fixed {
  padding-left: 1.2em;
}
.fixed li {
  margin-bottom: 8px;
}
footer {
  margin-top: 40px;
  padding-top: 12px;
  border-top: 1px solid var(--line);
  color: var(--muted);
  font-size: 0.9rem;
}
@media print {
  .skip,
  nav {
    display: none;
  }
}
`;
