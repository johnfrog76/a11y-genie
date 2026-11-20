import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Locator, Page } from "playwright-core";
import { TreeReader, type FocusedAccessible } from "../../src/a11y-tree.js";
import { withBrowser } from "../../src/browser.js";
import { LIMITS } from "../../src/context.js";
import { chromeIsInstalled, guardContext } from "../helpers/browser-guard.js";
import { startFixtureServer, type FixtureServer } from "../helpers/fixture-server.js";

// Reading the accessibility tree for narration (spec 6.6, src/a11y-tree.ts): for each control of
// workflow.html, focused, the properties read and the exact spoken line; then what the reader works out for
// itself (a place in a set, aria-activedescendant, aria-valuetext), a control in a shadow root and one in a
// same-origin frame, a page that lies about focus, and names kept as data. Skipped, and says so, where Chrome
// is not installed.
const hasChrome = await chromeIsInstalled();

type Expected = Pick<FocusedAccessible, "role" | "name" | "states" | "spoken"> &
  Partial<Pick<FocusedAccessible, "value" | "level" | "setPosition" | "unnamed">>;

/** workflow.html's controls, by id, with what the tree must say of each, in the page's order. */
const WORKFLOW: [id: string, expected: Expected][] = [
  [
    "heading",
    {
      role: "heading",
      name: "Account settings",
      level: 1,
      states: [],
      spoken: "Account settings, heading, level 1",
    },
  ],
  ["email", { role: "textbox", name: "Email", states: ["required"], spoken: "Email, edit text, required" }],
  ["unnamed", { role: "button", name: "", states: [], unnamed: true, spoken: "button" }],
  ["save", { role: "button", name: "Save", states: [], unnamed: false, spoken: "Save, button" }],
  [
    "display",
    {
      role: "textbox",
      name: "Display name",
      value: "Ada",
      states: [],
      spoken: "Display name, edit text, Ada",
    },
  ],
  [
    "code",
    { role: "textbox", name: "Invite code", states: ["invalid"], spoken: "Invite code, edit text, invalid" },
  ],
  [
    "free",
    {
      role: "radio",
      name: "Free",
      states: ["checked"],
      setPosition: { position: 1, size: 3 },
      spoken: "Free, radio button, checked, 1 of 3",
    },
  ],
  [
    "team",
    {
      role: "radio",
      name: "Team",
      states: ["not checked"],
      setPosition: { position: 2, size: 3 },
      spoken: "Team, radio button, not checked, 2 of 3",
    },
  ],
  [
    "business",
    {
      role: "radio",
      name: "Business",
      states: ["not checked"],
      setPosition: { position: 3, size: 3 },
      spoken: "Business, radio button, not checked, 3 of 3",
    },
  ],
  [
    "news",
    {
      role: "checkbox",
      name: "Send me news",
      states: ["checked"],
      spoken: "Send me news, check box, checked",
    },
  ],
  ["bold", { role: "button", name: "Bold", states: ["pressed"], spoken: "Bold, toggle button, pressed" }],
  [
    "menu",
    { role: "button", name: "Actions", states: ["collapsed"], spoken: "Actions, menu button, collapsed" },
  ],
  ["archive", { role: "button", name: "Archive", states: ["disabled"], spoken: "Archive, button, disabled" }],
  ["privacy", { role: "link", name: "Privacy notes", states: [], spoken: "Privacy notes, link" }],
];

describe.skipIf(!hasChrome)("reading the accessibility tree (skipped where Chrome is not installed)", () => {
  let server: FixtureServer;
  beforeAll(async () => {
    server = await startFixtureServer();
  });
  afterAll(async () => {
    await server.close();
  });

  /** Opens `file`, then for each locator `focus` gives, focuses it and reads the tree. */
  async function readEach(
    file: string,
    focus: (page: Page) => Locator[],
    between?: (page: Page, at: number) => Promise<void>,
  ): Promise<(FocusedAccessible | null)[]> {
    return withBrowser("chrome", async (browser) => {
      const context = await browser.newContext();
      const attempted = await guardContext(context, server.origin);
      const page = await context.newPage();
      await page.goto(server.url(file));
      const reader = await TreeReader.open(page);
      try {
        const reads: (FocusedAccessible | null)[] = [];
        for (const [at, locator] of focus(page).entries()) {
          await between?.(page, at);
          await locator.focus();
          reads.push(await reader.read());
        }
        expect(attempted).toEqual([]);
        return reads;
      } finally {
        await reader.close();
      }
    });
  }

  it("reads each control of workflow.html: its properties and the exact spoken line", async () => {
    const reads = await readEach("workflow.html", (page) => WORKFLOW.map(([id]) => page.locator(`#${id}`)));
    expect(reads.map((read) => read?.spoken)).toEqual(WORKFLOW.map(([, expected]) => expected.spoken));
    for (const [at, [id, expected]] of WORKFLOW.entries()) {
      expect(reads[at], id).toMatchObject({ selector: `#${id}`, value: "", unnamed: false, ...expected });
      if (expected.setPosition === undefined) expect(reads[at], id).not.toHaveProperty("setPosition");
      if (expected.level === undefined) expect(reads[at], id).not.toHaveProperty("level");
    }
  });

  it("reads the menu button as expanded once it is open", async () => {
    const [before, after] = await readEach(
      "workflow.html",
      (page) => [page.locator("#menu"), page.locator("#menu")],
      async (page, at) => {
        if (at === 1) await page.locator("#menu").click();
      },
    );
    expect(before?.spoken).toBe("Actions, menu button, collapsed");
    expect(after?.spoken).toBe("Actions, menu button, expanded");
  });

  it("reads nothing when focus is on no element", async () => {
    await withBrowser("chrome", async (browser) => {
      const context = await browser.newContext();
      await guardContext(context, server.origin);
      const page = await context.newPage();
      await page.goto(server.url("workflow.html"));
      const reader = await TreeReader.open(page);
      try {
        expect(await reader.read()).toBeNull();
      } finally {
        await reader.close();
      }
    });
  });

  it("works out a place in a set, follows aria-activedescendant and reads aria-valuetext", async () => {
    const ids = ["utc", "pacific", "eastern", "zone", "fourth", "docs", "guide", "faq", "src", "volume"];
    const reads = await readEach("a11y-tree-sets.html", (page) => ids.map((id) => page.locator(`#${id}`)));
    expect(reads.map((read) => read?.spoken)).toEqual([
      // The hidden option is not counted.
      "UTC, option, 1 of 3",
      "Pacific time, option, selected, 2 of 3",
      "Eastern time, option, 3 of 3",
      // Focus is on the combo box; it points at its selected option, which is what is read.
      "Pacific time, option, selected, 2 of 3",
      // The page gives the place: aria-posinset and aria-setsize.
      "Fourth of nine, menu item, 4 of 9",
      // A tree item's set leaves out the items of the group nested in it. Chrome selects a tree item on focus.
      "Docs, tree item, level 1, expanded, selected, 1 of 2",
      "Guide, tree item, level 2, selected, 1 of 2",
      "FAQ, tree item, level 2, selected, 2 of 2",
      "Source, tree item, level 1, selected, 2 of 2",
      // aria-valuetext, not the number.
      "Volume, slider, 7 of 10",
    ]);
    expect(reads[3]).toMatchObject({ selector: "#pacific", activeDescendant: true });
    expect(reads[1]).not.toHaveProperty("activeDescendant");
  });

  it("reads a control inside open shadow roots", async () => {
    const reads = await readEach("walk-shadow.html", (page) => [
      page.getByRole("button", { name: "In the shadow" }),
      page.getByLabel("Deeper still"),
    ]);
    expect(reads.map((read) => read?.spoken)).toEqual(["In the shadow, button", "Deeper still, edit text"]);
    expect(reads[1]?.target).toEqual([["#host", ":host > span", ":host > div > input"]]);
  });

  it("reads a control inside a frame of the same origin", async () => {
    const reads = await readEach("walk-frame.html", (page) => [
      page.frameLocator("#inner").getByRole("button", { name: "In the frame" }),
    ]);
    expect(reads[0]).toMatchObject({ spoken: "In the frame, button", tag: "button" });
    expect(reads[0]?.target).toHaveLength(2);
  });

  it("reads the focused element of a page that lies about focus", async () => {
    const reads = await readEach("walk-tampered.html", (page) => [page.getByRole("button", { name: "Two" })]);
    expect(reads[0]?.spoken).toBe("Two, button");
  });

  it("makes a hostile name printable, and cuts a long one to the excerpt limit", async () => {
    const [escapes] = await readEach("a11y-tree-sets.html", (page) => [page.locator("#escapes")]);
    expect(escapes?.name).toBe("Red and bell");
    expect(escapes?.spoken).toBe("Red and bell, button");
    const [long] = await readEach("walk-names.html", (page) => [page.locator("#long")]);
    expect([...(long?.name ?? "")]).toHaveLength(LIMITS.excerptChars + 1);
    expect(long?.name.endsWith("…")).toBe(true);
    expect(long?.spoken).toBe(`${long?.name ?? ""}, button`);
  });
});
