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
