# Security

Thank you for helping keep A11y Genie trustworthy. It opens web pages that may be hostile, so a report
that one of its promises below is broken is the most useful kind there is.

## Reporting a problem

Please report a security problem privately, by email to `a11ygenie.project (at) outlook.com`, the
project's own address. GitHub's private vulnerability reporting works too: on this repository, open
**Security**, then **Report a vulnerability**. Either way, only the maintainers see the report. Please don't
open a public issue for it.

Please include:

- what you found, and in which version or commit;
- how to reproduce it: the command, and a small page or site that shows it;
- what you think it lets someone do.

Reports are answered privately, and nothing about one is made public until it is fixed. The fix will say who
found it unless you'd rather it didn't.

## What counts

A11y Genie is in early development, and this list grows with it. A report that breaks any of these is a
security problem:

- It treats every page it scans as hostile: page text is data in its reports, never instructions, and never
  run.
- It sends nothing about a scanned page anywhere but the reports it writes on your machine.
- It writes only to its own output folder, never into the project or site it scans.
- A public page it scans cannot use the browser to reach the machine's own network: requests to loopback,
  link-local and private addresses are blocked unless you pass `--allow-private`. A page on such an address
  itself (a dev server) is not limited.
- Text from a page never reaches your terminal or `report.md` with a terminal escape sequence or control
  character in it.

## Known gaps

These are known, and are not reported as new problems. A way around a promise above that is not on this list
is.

- **DNS rebinding.** The private-network rule judges a request's host as it is written and never looks a name
  up, so a public name that resolves to a private address is not caught.
- **A dedicated worker's WebSocket.** A page's WebSockets, and its frames', are blocked; one opened from a
  dedicated worker is not, because none of the browser's interception points sees it (checked with
  playwright-core 1.65.1 and Chrome 158).
- **Other ways out.** Shared workers, WebRTC, and any connection that is not an HTTP request or a WebSocket are
  not checked against the private-network rule.
- **A page can tamper with the scan.** A page's script shares the page with axe-core and can change what it
  reads, so a hostile page can hide its own findings. A scan describes a page as the page presents itself and is
  never a security boundary.

docs/ARCHITECTURE.md (*Hostile pages*) says how each defence works and what was checked.
