import { describe, expect, it } from "vitest";
import {
  narrationFiles,
  narrationFileStem,
  producesResult,
  renderTranscript,
  unnamedStepFinding,
  type NarratedStep,
  type WorkflowResult,
} from "../../src/narrate.js";
import { genieRules } from "../../src/genie-rules.js";
import { parseStep } from "../../src/steps.js";
import "../../src/rules-command.js";
import { readGoldenRecord } from "../helpers/goldens.js";
import { validate } from "../helpers/json-schema.js";
import { readFileSync } from "node:fs";

function step(key: string, spoken: string, rest: Partial<NarratedStep> = {}): NarratedStep {
  return { key, role: null, name: "", states: [], spoken, unnamed: false, selector: null, ...rest };
}

describe("the transcript", () => {
  it("is the transcript's format: a heading, one line a step, and a note under a step with no name", () => {
    const text = renderTranscript({
      name: "flow",
      page: "settings",
      steps: [
        step("Tab", "Time zone, combo box, collapsed"),
        step("ArrowDown", "Pacific time, option, 3 of 12"),
        step("Tab", "button", { unnamed: true }),
        step("Enter", "Save, button", { produced: [{ kind: "live", spoken: "Saved, status" }] }),
      ],
    });
    expect(text).toBe(
      [
        "flow, on settings",
        "1  Tab        Time zone, combo box, collapsed",
        "2  ArrowDown  Pacific time, option, 3 of 12",
        "3  Tab        button",
        '   ^ This step has no name. A screen reader says "button", and stops.',
        "4  Enter      Saved, status",
        "",
      ].join("\n"),
    );
  });

  it("keeps its columns when there are ten steps or more", () => {
    const steps = Array.from({ length: 10 }, () => step("Tab", "Save, button"));
    steps[1] = step("Tab", "button", { unnamed: true });
    const lines = renderTranscript({ name: "flow", page: "home", steps }).split("\n");
    expect(lines[1]).toBe("1   Tab  Save, button");
    expect(lines[11]).toBe("10  Tab  Save, button");
    expect(lines[3]).toBe('    ^ This step has no name. A screen reader says "button", and stops.');
  });

  it("continues a press that produced several things under the first, and says when it produced none", () => {
    const text = renderTranscript({
      name: "flow",
      page: "home",
      steps: [
        step("Enter", "Open, button", {
          produced: [
            { kind: "dialog", spoken: "Settings, dialog" },
            { kind: "focus", spoken: "Close, button" },
          ],
        }),
        step("Space", "Close, button", { produced: [] }),
        step("Enter", "", { produced: [{ kind: "focus", spoken: "" }] }),
        step("Tab", ""),
      ],
    });
    expect(text.split("\n")).toEqual([
      "flow, on home",
      "1  Enter  Settings, dialog",
      "          Close, button",
      "2  Space  (nothing is said)",
      "3  Enter  (focus is on no element)",
      "4  Tab    (focus is on no element)",
      "",
    ]);
  });

  it("ends with why a flow stopped, when it did", () => {
    const text = renderTranscript({
      name: "flow",
      page: "home",
      steps: [step("Tab", "Save, button")],
      notScanned: "step 2 (Enter) failed: the browser could not do it",
    });
    expect(text.split("\n").slice(-3)).toEqual([
      "",
      "Not narrated past this point: step 2 (Enter) failed: the browser could not do it.",
      "",
    ]);
  });
});

describe("which steps are read for what they produced", () => {
  const is = (text: string) => producesResult(parseStep(text, { source: "test", use: "flow" }));
  it("Enter, Space and a click are; a Tab, an arrow and typing are not", () => {
    for (const yes of [
      "Enter",
      "Space",
      "Shift+Enter",
      "NumpadEnter",
      "click button 'Save'",
      "click css '#a'",
    ]) {
      expect(is(yes), yes).toBe(true);
    }
    for (const no of ["Tab", "ArrowDown", "Escape", "type 'a'", "wait dialog", "Tab to button 'Save'"]) {
      expect(is(no), no).toBe(false);
    }
  });
});

describe("the files of the transcripts", () => {
  it("are narration/<name>.txt, with the name made one safe path part", () => {
    expect(narrationFiles(["flow"])).toEqual(["narration/flow.txt"]);
    expect(narrationFiles(["change-time-zone"])).toEqual(["narration/change-time-zone.txt"]);
    expect(narrationFileStem("../../etc/passwd")).toBe("etc-passwd");
    expect(narrationFileStem("Save it all!")).toBe("Save-it-all");
    expect(narrationFileStem("..")).toBe("workflow");
    expect(narrationFileStem("\u001b[31m")).toBe("workflow");
    expect(narrationFileStem("x".repeat(200))).toHaveLength(64);
  });

  it("never let one transcript overwrite another", () => {
    expect(narrationFiles(["save flow", "Save-flow", "save/flow", "other"])).toEqual([
      "narration/save-flow.txt",
      "narration/Save-flow-2.txt",
      "narration/save-flow-3.txt",
      "narration/other.txt",
    ]);
  });
});

describe("genie/unnamed-step", () => {
  const unnamed = (name: string, selector: string, number: number): WorkflowResult => ({
    name,
    page: "home",
    steps: [],
    evidence: [
      { number, key: "Tab", spoken: "button", target: [selector], selector, html: `<button id="x">` },
    ],
  });

  it("is one finding on the page, with one element for each control reached unnamed", () => {
    const finding = unnamedStepFinding("home", [
      unnamed("a", "#x", 2),
      unnamed("b", "#x", 3),
      unnamed("b", "#y", 1),
    ]);
    expect(finding).toMatchObject({
      id: "genie/unnamed-step@home",
      impact: "serious",
      kind: "violation",
      page: "home",
    });
    expect(finding?.elements.map((element) => element.selector)).toEqual(["#x", "#y"]);
    expect(finding?.elements[0]?.failure).toContain('Step 2 (Tab) of the flow "a"');
  });

  it("is none when no step was", () => {
    expect(
      unnamedStepFinding("home", [{ name: "a", page: "home", steps: [], evidence: [] }]),
    ).toBeUndefined();
  });

  it("is registered: serious, WCAG 4.1.2", () => {
    const rule = genieRules().find((entry) => entry.rule.id === "unnamed-step");
    expect(rule).toMatchObject({ impact: "serious", rule: { source: "genie", wcag: ["4.1.2"] } });
  });
});

describe("scan.json 1.10", () => {
  const schema = JSON.parse(
    readFileSync(new URL("../../schema/scan-1.json", import.meta.url), "utf8"),
  ) as Record<string, never>;

  it("a 1.9 record, with its empty workflows, still validates", () => {
    const record = { ...readGoldenRecord("clean"), schema: "1.9" };
    expect(record.workflows).toEqual([]);
    expect(validate(schema, record)).toEqual([]);
  });

  it("a record with a narrated flow validates, and a bad one does not", () => {
    const record = {
      ...readGoldenRecord("clean"),
      command: "narrate",
      workflows: [
        {
          name: "flow",
          page: "home",
          file: "narration/flow.txt",
          steps: [
            {
              key: "Enter",
              role: "button",
              name: "Save",
              states: [],
              spoken: "Save, button",
              unnamed: false,
              selector: "#save",
              produced: [{ kind: "live", spoken: "Saved, status" }],
            },
          ],
          notScanned: "step 2 (Tab) failed: no such element",
        },
      ],
    };
    expect(validate(schema, record)).toEqual([]);
    const outside = structuredClone(record);
    (outside.workflows[0] as { file: string }).file = "../flow.txt";
    expect(validate(schema, outside)).not.toEqual([]);
    const unknownKind = structuredClone(record);
    (unknownKind.workflows[0]?.steps[0]?.produced?.[0] as { kind: string }).kind = "shout";
    expect(validate(schema, unknownKind)).not.toEqual([]);
  });
});
