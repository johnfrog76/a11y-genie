/**
 * Builds the project's page: copies `site/` into a folder for GitHub Pages, and fills in the call to watch
 * the deck, or leaves it out.
 *
 * `site/index.html` holds one marker, `<!-- deck-cta -->`, where the deck's button goes. With `DECK_URL` set,
 * the button to watch the deck goes there, before the repository's. Emptied, the marker is taken out and the
 * page has no deck button at all, so there is never a link to nowhere. The page is published only once the
 * repository is public (pages.yml, which also puts the deck page beside it at deck/, the address the button
 * opens).
 *
 * Run it with `npm run site` (or `node scripts/build-site.ts [folder]`); it writes `_site/` by default.
 * test/unit/site.test.ts checks both cases.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * The product deck's address, set here and only here: the deck page `web/` builds, which Pages serves at `deck/`
 * beside this page (docs/DECK.md). Emptied, the page has no deck button at all.
 */
export const DECK_URL: string = "deck/";

/** The one address that is not an https: one: the deck page beside this one. */
export const DECK_PAGE = "deck/";

/** The marker in `site/index.html` the deck's button replaces. */
export const DECK_MARKER = "<!-- deck-cta -->";

/** The deck button's words. */
export const DECK_LABEL = "Watch the video";

export const SITE_DIR = fileURLToPath(new URL("../site/", import.meta.url));

/** The page's HTML with the deck button filled in, or with no deck button when `deckUrl` is empty. */
export function renderIndex(html: string, deckUrl: string = DECK_URL): string {
  const markers = html.split(DECK_MARKER).length - 1;
  if (markers !== 1)
    throw new Error(`site/index.html must hold ${DECK_MARKER} exactly once, not ${markers} times`);
  if (deckUrl === "") {
    // Take out the marker's whole line, so the built page has no trace of it.
    return html.replace(new RegExp(`^[ \\t]*${DECK_MARKER}\\r?\\n`, "m"), "").replace(DECK_MARKER, "");
  }
  if (deckUrl !== DECK_PAGE && !/^https:\/\/[^\s"'<>]+$/.test(deckUrl)) {
    throw new Error(
      `DECK_URL must be ${DECK_PAGE}, or an https: address with no spaces, quotes or angle brackets: ${deckUrl}`,
    );
  }
  const button = `<a class="lp-cta-button" data-cta="deck" href="${deckUrl.replaceAll("&", "&amp;")}">${DECK_LABEL}</a>`;
  return html.replace(DECK_MARKER, button);
}

/** The repository's root, the folder above `scripts/`. */
export const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url));

/** The real path of `path`: of its nearest folder that exists, with the rest put back, so `..` and links count. */
function realPathOf(path: string): string {
  const full = resolve(path);
  if (existsSync(full)) return realpathSync(full);
  const parent = dirname(full);
  return parent === full ? full : join(realPathOf(parent), full.slice(parent.length + 1));
}

function contains(outer: string, inner: string): boolean {
  const rel = relative(outer, inner);
  return rel === "" || (!rel.startsWith("..") && !rel.includes(`..${sep}`) && resolve(outer, rel) === inner);
}

/**
 * The reason `out` must not be emptied, or `undefined` when it may be. The build deletes `out` first, so it is
 * refused, before anything is deleted, when it is, holds or sits inside `site/`, when it is or holds the
 * repository, and when it is anywhere else inside the repository but `_site/`, so no folder of the project
 * itself (`src/`, `docs/`) can be emptied by a mistyped argument.
 */
export function unsafeOutFolder(
  out: string,
  from: string = SITE_DIR,
  root: string = REPO_ROOT,
): string | undefined {
  const target = realPathOf(out);
  const source = realPathOf(from);
  const repo = realPathOf(root);
  const given = resolve(out);
  if (contains(target, source) || contains(source, target)) {
    return `Refusing ${given}: it is, holds or sits inside the page's source folder. Give a folder of its own, such as _site.`;
  }
  if (contains(target, repo)) {
    return `Refusing ${given}: it is or holds the repository. Give a folder of its own, such as _site.`;
  }
  if (contains(repo, target) && !contains(join(repo, "_site"), target)) {
    return `Refusing ${given}: inside the repository, only _site may be emptied. Give _site, or a folder outside it.`;
  }
  return undefined;
}

/** Writes the page into `out`, replacing whatever was there. */
export function buildSite(out: string, deckUrl: string = DECK_URL, from: string = SITE_DIR): void {
  const refusal = unsafeOutFolder(out, from);
  if (refusal !== undefined) throw new Error(refusal);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  cpSync(from, out, { recursive: true });
  const index = join(out, "index.html");
  writeFileSync(index, renderIndex(readFileSync(index, "utf8"), deckUrl));
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const out = resolve(process.argv[2] ?? "_site");
  const refusal = unsafeOutFolder(out);
  if (refusal !== undefined) {
    console.error(refusal);
    process.exit(1);
  }
  buildSite(out);
  console.log(`Built the page into ${out}${DECK_URL === "" ? ", with no deck button yet" : ""}.`);
}
