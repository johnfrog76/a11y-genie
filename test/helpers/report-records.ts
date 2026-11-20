import { checkRecord } from "../../src/compare.js";
import type { ScanRecord } from "../../src/scan-record.js";
import { readGoldenRecord } from "./goldens.js";

/**
 * A `check` record made with no browser from impact-mix's golden: the baseline lacks the heading-order finding and
 * the scan lacks the image-alt one, so the check has a finding of each status (new, still open and fixed).
 */
export function goldenCheckRecord(): ScanRecord {
  const golden = readGoldenRecord("impact-mix");
  const without = (ruleId: string): ScanRecord => ({
    ...golden,
    findings: golden.findings.filter((finding) => finding.rule.id !== ruleId),
  });
  const baseline = { ...without("heading-order"), startedAt: "1999-12-31T00:00:00Z" };
  return checkRecord(without("image-alt"), { path: "baseline/scan.json", record: baseline });
}

const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);

/** Text a hostile page, or a hostile baseline, could put anywhere the report quotes. */
export const HOSTILE = {
  script: "<script>alert(1)</script>",
  breakOut: '"><img src=x onerror=alert(1)>',
  javascriptUrl: "javascript:alert(1)",
  escapes: `${ESC}[31mRED${ESC}[0m ${ESC}]8;;https://evil.example/${BEL}click here${ESC}]8;;${BEL} ${ESC}]0;window title${BEL}done`,
  closeStyle: "</style><style>body{display:none}</style>",
  bidi: "‮evil‬",
};

/** All of `HOSTILE`, in one string. */
export const ALL_HOSTILE = Object.values(HOSTILE).join(" ");

/**
 * impact-mix's golden with hostile text in every place a page or a baseline writes: the origin and the address,
 * a selector and an excerpt, a rule's help address, axe-core's words, a colour, a state, a flow and its
 * transcript, a dialog's message, and a reason a state was not scanned.
 */
export function hostileRecord(): ScanRecord {
  const golden = readGoldenRecord("impact-mix");
  const [first, second, ...rest] = golden.findings;
  if (first === undefined || second === undefined) throw new Error("impact-mix has two findings");
  const element = first.elements[0];
  const pair = second.elements[0];
  if (element === undefined || pair?.colorPair === undefined) throw new Error("impact-mix has a colour pair");
  return {
    ...golden,
    target: { ...golden.target, origin: `http://127.0.0.1:0000${HOSTILE.closeStyle}` },
    pages: golden.pages.map((page) => ({
      ...page,
      url: HOSTILE.javascriptUrl,
      requestedUrl: `${HOSTILE.javascriptUrl}${HOSTILE.breakOut}`,
      redirects: 1,
      states: [...page.states, HOSTILE.breakOut],
      notScanned: [{ state: HOSTILE.breakOut, reason: ALL_HOSTILE }],
      stopped: [{ kind: "dialog", count: 1, examples: [ALL_HOSTILE] }],
    })),
    summary: { ...golden.summary, notScanned: 1 },
    findings: [
      {
        ...first,
        page: HOSTILE.breakOut,
        plain: ALL_HOSTILE,
        rule: { ...first.rule, helpUrl: HOSTILE.javascriptUrl, wcag: [HOSTILE.script] },
        elements: [
          {
            ...element,
            selector: HOSTILE.breakOut,
            html: `${HOSTILE.script}${HOSTILE.breakOut}${HOSTILE.escapes}`,
            failure: ALL_HOSTILE,
            states: ["default", HOSTILE.script],
          },
        ],
      },
      {
        ...second,
        rule: { ...second.rule, helpUrl: `data:text/html,${HOSTILE.script}` },
        elements: [
          {
            ...pair,
            colorPair: { ...pair.colorPair, foreground: `red"/><script>`, fontSize: HOSTILE.script },
          },
        ],
      },
      ...rest,
    ],
    workflows: [
      {
        name: HOSTILE.breakOut,
        page: HOSTILE.javascriptUrl,
        file: "narration/flow.txt",
        steps: [
          {
            key: "Tab",
            role: "button",
            name: ALL_HOSTILE,
            states: [],
            spoken: ALL_HOSTILE,
            unnamed: false,
            selector: HOSTILE.breakOut,
          },
        ],
        notScanned: HOSTILE.escapes,
      },
    ],
    cannotSee: [...golden.cannotSee],
  };
}
