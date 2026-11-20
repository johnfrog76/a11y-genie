# Known gaps

What A11y Genie does not do, and the limits it was built with, written down so nobody finds them by surprise.
Each has a status as it stands today: *open* (not built or not solved yet), or *accepted* (a limit the project
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

Gaps G6 and G7 are security limits. [SECURITY.md](SECURITY.md) lists them too, with two more of the same kind
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
([CLI.md](CLI.md), *check*).

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
handler of its own goes to *needs review*, never to the findings. A person decides. See [CHECKS.md](CHECKS.md).

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

**Status: accepted. This is a security limit, and it is also in [SECURITY.md](SECURITY.md).**

A page's own script shares the page with axe-core while it runs. It can replace DOM methods or prototypes, or
`window.axe` itself, or change the page between axe-core's reads. A hostile page can therefore hide its own
findings. A scan describes a page as the page presents itself, and is never a security boundary: do not read a
scan as proof that a page you do not trust behaves. A11y Genie's own checks read the page in an isolated
world that the page's script cannot reach, but axe-core still runs in the page itself. Running axe-core in an
isolated world is not tried yet.

## G7: a public name can point at a private address

**Status: accepted. This is a security limit, and it is also in [SECURITY.md](SECURITY.md).**

By default, a public page cannot use the browser to reach the machine's own network: requests to loopback,
link-local and private addresses are blocked unless you pass `--allow-private`. The rule judges a request's host
as it is written and never looks a name up. So a public name that points at a private address (known as DNS
rebinding) is not caught. A check in the browser's request path that looks names up is a question for later.
[ARCHITECTURE.md](ARCHITECTURE.md) (*The private-network rule*) says how the rule works.

## Two more security limits

[SECURITY.md](SECURITY.md) lists these as known gaps too. They belong to the same private-network rule:

- **A dedicated worker's WebSocket.** A page's WebSockets, and its frames', are blocked from private addresses;
  one opened from a dedicated worker is not, because none of the browser's interception points sees it.
- **Other ways out.** Shared workers, WebRTC, and any connection that is not an HTTP request or a WebSocket are
  not checked against the private-network rule.

## What a scan cannot see

Separate from these gaps, every report lists the questions a scan cannot answer, such as whether an image's
alternative text says what the image is for. That list is in [CHECKS.md](CHECKS.md) (*What a scan cannot see*).
