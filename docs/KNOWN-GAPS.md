# Known gaps

What A11y Genie does not do yet, what is planned, and the limits it was built with, written down so nobody finds
them by surprise.
Each gap has a status as it stands today: *open* (not built or not solved yet), or *accepted* (a limit the project
has chosen to keep for now).

| Gap | In short | Status |
| --- | --- | --- |
| [G1](#g1-a-card-cannot-be-added-to-later) | A card, once filed, cannot be added to | Open, and the card hand-off is not built yet |
| [G2](#g2-the-card-system-gives-no-machine-readable-reply) | The card system gives no machine-readable reply | Accepted, and the hand-off is not built yet |
| [G3](#g3-a-click-handler-set-at-the-root-is-not-seen) | A click handler set at the root is not seen | Accepted |
| [G4](#g4-chromium-family-browsers-only) | Chromium-family browsers only | Accepted |
| [G5](#g5-states-are-given-by-hand) | States are given by hand | Accepted |
| [G6](#g6-a-page-can-tamper-with-the-scan) | A page can tamper with the scan | Accepted |
| [G7](#g7-a-public-name-can-point-at-a-private-address) | A public name can point at a private address | Accepted |
| [G8](#g8-the-skip-link-check-does-not-count-inside-closed-shadow-roots) | The skip-link check does not count inside closed shadow roots | Accepted |

Gaps G6 and G7 are security limits. [SECURITY.md](../SECURITY.md) lists them too, with two more of the same kind
(below), and says how to report a way around one of A11y Genie's promises that is not on the list.

## G1: a card cannot be added to later

**Status: open. The hand-off is not built yet.**

A11y Genie will be able to turn findings into cards for a team's work tracker (the planned `cards` command).
Today it writes only the files of a scan (`scan.json` and `report.md`), and there is no `cards` command. When it
exists, a card that has been filed will not be updated by a later scan: the tracker it hands cards to can make a
card, and nothing in it adds to one already filed. So the answers to the questions of a manual checklist, and a
rescan's *fixed*, will not reach a card that is already there.

What you can do today: nothing is lost. `a11y-genie check --baseline <scan>` already says which findings are
new, still open and fixed since an earlier scan, from the files of the scans themselves
(the [README](../README.md), *Usage*).

## G2: the card system gives no machine-readable reply

**Status: accepted. The hand-off is not built yet.**

When cards are made, the card system answers with lines of text a person reads, not with a structured reply. So
A11y Genie will have to read the new card's id from those success lines, and it will fail to find one if the
wording changes. This is accepted, as it is for other tools that hand work to the same system.
Nothing reads them today, because there is no hand-off yet.

## G3: a click handler set at the root is not seen

**Status: accepted.** `genie/click-on-non-control` looks for an element that reacts to a click but is not a
control.

It sees a click handler of the element's own: an `onclick` attribute, or a `click` listener set on that element.
A framework such as React often sets one listener at the root of the page instead, and from the element alone
that cannot be told from a pointer cursor that does nothing. So an element that looks clickable and has no
handler of its own goes to *needs review*, never to the findings. A person decides. [ARCHITECTURE.md](ARCHITECTURE.md)
(*Click on a non-control*) says how the check works.

## G4: Chromium-family browsers only

**Status: accepted.** A11y Genie drives Chrome, Microsoft Edge, or Playwright's own Chromium (`--browser-channel
chrome`, `msedge` or `chromium`). It does not run Firefox or Safari, so a problem that shows only in one of those
is not seen, and the keyboard checks read how Chrome moves focus. If no Chrome is installed, it downloads
Playwright's Chromium once and says so.

## G5: states are given by hand

**Status: accepted.** A page looks different when a menu is open, a dialog is showing, or a different colour
scheme is chosen, and each of these is a *state*. A11y Genie scans the states you name, with `--states` or in a
config file ([STEPS.md](STEPS.md), [CONFIG.md](CONFIG.md)), each from a fresh load. It does not find states by
clicking through the page itself, so a state nobody names is not scanned. Finding them automatically is a
question for later.

## G6: a page can tamper with the scan

**Status: accepted. This is a security limit, and it is also in [SECURITY.md](../SECURITY.md).**

A page's own script shares the page with axe-core while it runs. It can replace DOM methods or prototypes, or
`window.axe` itself, or change the page between axe-core's reads. A hostile page can therefore hide its own
findings. A scan describes a page as the page presents itself, and is never a security boundary: do not read a
scan as proof that a page you do not trust behaves. A11y Genie's own checks read the page in an isolated
world that the page's script cannot reach, but axe-core still runs in the page itself. Running axe-core in an
isolated world is not tried yet.

## G7: a public name can point at a private address

**Status: accepted. This is a security limit, and it is also in [SECURITY.md](../SECURITY.md).**

By default, a public page cannot use the browser to reach the machine's own network: requests to loopback,
link-local and private addresses are blocked unless you pass `--allow-private`. The rule judges a request's host
as it is written and never looks a name up. So a public name that points at a private address (known as DNS
rebinding) is not caught. A check in the browser's request path that looks names up is a question for later.
[ARCHITECTURE.md](ARCHITECTURE.md) (*The private-network rule*) says how the rule works.

## G8: the skip-link check does not count inside closed shadow roots

**Status: accepted.** `genie/skip-link` decides whether a page has enough to skip by counting the tabbable
elements before its main content. It counts through open shadow roots, the trees web components keep
([issue #216](https://github.com/johnfrog76/a11y-genie/issues/216)), but a closed shadow root cannot be read from
outside it, so what is inside one is not counted. A page whose navigation lives in components with closed shadow
roots counts few or none. Below five, the check does not run, so there is no finding and no note that it was
skipped. A page like that can lack a skip link and still get no finding. The keyboard walk cannot read inside a
closed shadow root either. [CHECKS.md](CHECKS.md) (`genie/skip-link`) says what the check does.

## Two more security limits

[SECURITY.md](../SECURITY.md) lists these as known gaps too. They belong to the private-network rule, and to
`--same-origin`, which stops requests in the same places; `--offline` closes them (below):

- **A dedicated worker's WebSocket.** A page's WebSockets, and its frames', are blocked from private addresses;
  one opened from a dedicated worker is not, because none of the browser's interception points sees it.
- **Other ways out.** Shared workers, WebRTC, and any connection that is not an HTTP request or a WebSocket are
  not checked against the private-network rule.

Under `--offline` the browser is launched so that every connection off the machine goes to a proxy on the machine
that refuses it, WebRTC sends no UDP, and no name is looked up but `localhost` and `*.localhost`. So under
`--offline` neither of these gets off the machine (checked on Playwright's headless shell;
[ARCHITECTURE.md](ARCHITECTURE.md), *--offline at the launch*).

## Planned, not built

These are planned and not built yet. Each one comes off this list in the same change that builds it.

- **An HTML report.** One `report.html` that opens from disk, with no network, next to `report.md`.
- **Play.** A button in the HTML report that reads a narrated flow's transcript aloud, with the voices already
  on your machine only, so no page text leaves it.
- **Finding cards.** A `cards` command that writes one Markdown card per finding, ready to paste into a work
  tracker.
- **The hand-off to a team's tracker.** Filing those cards in a work tracker for you, not only writing them as
  files.
- **The checklist and ignores.** A guided checklist of the questions a scan cannot answer, asked page by page
  with your answers kept on the scan; and a way to set a finding aside with a reason, which every report still
  shows.
- **npm.** A11y Genie is not on npm yet, so `npx a11y-genie` does not work. Until it is, build it from a clone
  (the [README](../README.md), *Quick start*).

## What a scan cannot see

Separate from these gaps, every report lists the questions a scan cannot answer, such as whether an image's
alternative text says what the image is for. `report.md` ends with that list, under
*What this scan cannot see*.
