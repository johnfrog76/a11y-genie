# The deck

A11y Genie will have a short product deck: the genie's story, narrated, played in the browser on a page of its
own beside the project's page. This page says where the deck is made, where it lives here, how a deck is
registered, and how its page is built, checked and served.

The deck has arrived, and the deck page plays it. The project's page opens it with its "Watch the video"
button: `DECK_URL` in `scripts/build-site.ts` is `deck/`, the deck page beside it. Emptied, the button goes.
With the registry empty, the page says the deck is not here and links back to the project's page.

## Where the deck is made

The deck is made in a separate deck studio, with its art, its notes and its narration. The studio's ship step
carries it here as files, byte for byte, after two plain rewrites that fit its imports to this player:
`../engine/` becomes `../deck-engine/`, and `GiveawayButton` becomes `CopyLinkButton`.

So the deck files and their voices are never edited here. A change made here is a bug: the next ship writes
over it. Change the deck where it is made, and ship it again.

## The home

Everything the deck needs is under `web/src/deck/`, the deck's home:

```text
web/src/deck/
  decks/
    index.ts        the registry: DECKS, the decks this page can play (empty until the deck arrives)
    types.ts        the authoring contract: Deck, Slide, DeckState
    <deck>.tsx      a deck, and its figures file (shipped)
  voices/
    <deckId>/       its narration, <slideId>-<voiceId>.mp3 (shipped)
  bakedVoices.ts    finds the clips, as bundled URLs
  deck-engine/      the player, copied from Connected Deck
  shared/, *.tsx    what the player imports from outside its folder, copied with it
```

A deck imports the player's pieces from `../deck-engine/` (`makeSlide`, `PresenterNoteKit`,
`useCompactLayout`, `ComponentFrame`, `CopyLinkButton` and the rest) and its types from `./types`.
`CopyLinkButton` with no `url` copies the address of Connected Deck, the presentation engine the deck plays
on: the deck's closing button offers the engine, not A11y Genie.

## Registering a deck

A deck plays as soon as `decks/index.ts` imports it and lists it in `DECKS`: one import line, one entry.

```ts
import { myDeck } from "./my-deck";

export const DECKS: Deck[] = [myDeck];
```

The page plays the first deck listed. The ship step reports the line the registry still lacks, and whether
this page names the deck yet, in "The decks here" below. Both change in the same commit as the deck, and so
does `web/tests/smoke.mjs`, which gains the checks that the deck plays.

## The decks here

| Deck | File | Voices |
| --- | --- | --- |
| `a11y-genie`: the genie's story, seven slides, the deck page's first and only deck | `decks/a11y-genie.tsx` | `voices/a11y-genie/`: Brian and Jenny, 14 clips |

Its own figures are drawn in its one file, so it ships no figures file. It is shipped as it was made, still a
draft where it is made.

## The page

`web/` is its own private npm project (Vite, React and Fluent UI), apart from the published package: its
dependencies are not A11y Genie's, every version is pinned exactly, and nothing in it ships with the command.
`test/unit/deck-page.test.ts` holds that line. Its entry is `web/index.html`, which loads `web/src/main.tsx` and
nothing else.

The page plays the registered deck over the whole window, to an audience, and to an audience only. Its one
call to the player, in `web/src/DeckPage.tsx`, locks it there; the copied player files stay as they came, and
the parts this page locks off never show.

| The player's mode or setting | Here |
| --- | --- |
| Sofa: the viewer pages through the deck, and the voice reads each slide | the only mode (`mode="audience"`) |
| Podium: the presenter's notes, timer and next slide in a second window | locked off: `offeredModes` is the audience's alone, and no presenter preference is read |
| Audiobook: the deck reads itself aloud and turns its own slides | locked off: the page gives the player no Audiobook choice, so the settings sheet has no mode row |
| A live voice service | locked off (`hasApi={false}`): only the clips in `voices/` play |
| Narration | on from the start (`narrateByDefault`) |
| The sound control, the voice picker, zoom on a framed code sample | kept, as the player gives them |
| Exit, or Escape | goes to `../`, the project's page |

A browser may hold the first clip until the viewer presses something; the sound control is there for that.
The player runs inside an in-memory router, so the address bar never changes. `test/unit/deck-page.test.ts`
holds the lock.

`npm run build` in `web/` writes `web/dist/`, with every address relative (`base: "./"`), so the page works
under any path. `.github/workflows/pages.yml` publishes it at `deck/`, beside the project's page, in two jobs:
`build` installs `web/` from its lockfile, builds both pages, puts them in one folder (its "Assemble the page"
step) and uploads it, holding no token that can publish; `deploy` holds the Pages token and only deploys that
upload, installing nothing. The project's page stays plain HTML with no script.

## Running it locally

```sh
npm run build      # at the root first: the smoke test scans the deck page with dist/cli.js
cd web
npm ci
npm run dev        # the page, served by Vite
npm run typecheck  # tsc
npm run build      # web/dist/
npm run smoke                 # both pages, in the headless shell, as Pages serves them
npm run smoke -- --serve      # the same, then keeps serving them and prints the address
```

Served alone by Vite, the page has no project's page one folder up, so its link back lands on itself.
`npm run smoke` serves both, put together by the Pages workflow's own "Assemble the page" step: the project's
page built by `scripts/build-site.ts`, with `web/dist` at `deck/`.

The smoke test builds `web/`, assembles the two pages, serves them on `127.0.0.1` and drives Playwright's
headless shell, never the Google Chrome app. It holds that the deck page plays the registered deck ("1 / N" in
its bar, slide 1's title on screen) and that Escape leaves it for the project's page; that every baked clip is
in the build and answers as audio; that the project's page shows "Watch the video" and that it opens `deck/`; that
on a 390 px phone the deck page plays slide 1 and does not scroll sideways; that neither page logs an error;
and that A11y Genie's own scan of the deck page, on the deck's first slide, finds nothing critical or serious. `--shots <dir>` saves
screenshots, and `--host` and `--port` choose where it listens.

The root's `npm run lint` checks the page's own files (`web/src/*.tsx`, `web/index.html`, `web/tests/`, its
config) with ESLint and Prettier, and leaves `web/src/deck/` alone: it holds the copied player and the
shipped deck, which keep the style they came in.

## The player

`web/src/deck/deck-engine/` is the deck player from Connected Deck, an MIT project, copied at commit `cbb3f9e5`
without its tests. Code Sleuth copies the same commit, so the two products play their decks with the same
player.
The files it imports from outside its folder came with it, to the same relative paths.
`deck-engine/NOTICE.md` keeps the licence and lists what changed: `CopyLinkButton`'s default link, a
`useCompactLayout` that asks the player's viewport, a plain-text notes viewer in place of the Markdown one,
and two of the deck studio's words in `types.ts`. [THIRD-PARTY-NOTICES.md](../THIRD-PARTY-NOTICES.md) records
the copy.

A change to the player belongs in Connected Deck first, then comes here as a new copy.
