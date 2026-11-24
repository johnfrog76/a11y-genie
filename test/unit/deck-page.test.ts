import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The deck page (web/, docs/DECK.md) is its own npm project beside the command. These hold the line between the
// two, and the player's lock to the audience's mode, without a browser. `npm run smoke` in web/ checks the page
// itself in one.

const root = new URL("../../", import.meta.url);
const json = (path: string) =>
  JSON.parse(readFileSync(new URL(path, root), "utf8")) as {
    private?: boolean;
    files?: string[];
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
const rootPackage = json("package.json");
const webPackage = json("web/package.json");

describe("the deck page's own npm project", () => {
  it("is private, so it is never published", () => {
    expect(webPackage.private).toBe(true);
  });

  it("pins every dependency exactly", () => {
    const all = { ...webPackage.dependencies, ...webPackage.devDependencies };
    expect(Object.keys(all).length).toBeGreaterThan(0);
    for (const [name, version] of Object.entries(all)) {
      expect(version, name).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });

  it("runs nothing at install", () => {
    const lifecycle = ["preinstall", "install", "postinstall", "prepare", "prepack", "postpack"];
    expect(Object.keys(webPackage.scripts ?? {}).filter((name) => lifecycle.includes(name))).toEqual([]);
  });

  it("adds no dependency to the command's package", () => {
    const command = { ...rootPackage.dependencies, ...rootPackage.devDependencies };
    for (const name of Object.keys(webPackage.dependencies ?? {})) {
      expect(command, name).not.toHaveProperty(name);
    }
  });

  it("is not in the command's package: no `files` entry names web/", () => {
    expect(rootPackage.files?.filter((entry) => entry === "web" || entry.startsWith("web/"))).toEqual([]);
  });
});

describe("the deck page's player", () => {
  const page = readFileSync(new URL("web/src/DeckPage.tsx", root), "utf8");

  it("plays to an audience only: Sofa, with no Podium", () => {
    expect(page).toContain('const AUDIENCE_ONLY: readonly DeckMode[] = ["audience"];');
    expect(page).toContain('mode="audience"');
    expect(page).toContain("offeredModes={AUDIENCE_ONLY}");
    expect(page).not.toContain("PresenterModeProvider");
  });

  it("offers no Audiobook mode: the settings sheet gets no mode row", () => {
    expect(page).not.toMatch(/\baudiobook=/);
    expect(page).not.toContain("onAudiobookChange");
  });

  it("asks no voice service: only the baked clips play, narrated from the start", () => {
    expect(page).toContain("hasApi={false}");
    expect(page).toContain("narrateByDefault");
  });
});
