# The config file

`a11y-genie scan --config <file>` scans every page a file lists, each in every state the file gives it. The file
is YAML. It is checked whole before a browser opens, so a mistake is a refusal (exit 2) that names the file, the
line and the key, and nothing is scanned or written.

```yaml
# a11y-genie.yaml
baseUrl: http://localhost:5173
pages:
  - key: home
    path: /
  - key: settings
    path: /settings
    states:
      - name: menu-open
        steps: ["click button 'Menu'", "wait menu"]
      - name: dark
        steps: ["colorScheme dark"]
      - name: delete-dialog
        steps: ["click button 'Delete account'", "wait dialog"]
workflows:
  - name: change-time-zone
    page: settings
    steps: ["Tab to combobox 'Time zone'", "ArrowDown", "Tab to button 'Save'", "Enter"]
```

```sh
a11y-genie scan --config a11y-genie.yaml
a11y-genie scan http://localhost:4173 --config a11y-genie.yaml   # the same file, another server
```

## The keys

Only these are read. An unknown key is a refusal, not ignored.

| Where | Key | Takes |
| --- | --- | --- |
| the file | `baseUrl` | an `http:` or `https:` address. Only its origin is used: every page is on it. Optional, when the address is given on the command line, which then takes its place |
| the file | `pages` | a list of at least one page |
| the file | `workflows` | a list of workflows. `scan --config` narrates each one after the pages, from a fresh load of its page, and writes a transcript for each (`docs/ARCHITECTURE.md`, *Narration*) |
| a page | `path` | required. Starts with a single `/`, and may hold a query: `/settings?tab=1`. A path that would leave the site (`//example.com`) is refused |
| a page | `key` | the page's name in finding ids (`axe/color-contrast@settings`): letters, digits, `.`, `_`, `-` and `/`, up to 100. Without one, the path read as a page's key always is: `/settings` is `settings`, `/` is `home`. Two pages may not share a key |
| a page | `states` | a list of states, beside the `default` state every page is scanned in first |
| a state | `name` | required. The state-name rule in `docs/STEPS.md`: lower case, digits, `-` and `_`, never `default`. Once per page |
| a state | `steps` | required: a list of at least one step, one string each, in the grammar of `docs/STEPS.md`. A `;` in one string is refused |
| a workflow | `name`, `page`, `steps` | all required. `page` is a page's key in this file. Steps may not set media (`colorScheme`, `viewport`, `reducedMotion`), and a workflow has at most 200. The transcript is `narration/<name>.txt` in the scan folder, the name made one safe path part (letters, digits, `.`, `_`, `-`; two names that come to the same one get `-2`, `-3`) |

A step that does not parse is a refusal that names the file, the line and the step's column, for example
`a11y-genie.yaml line 6 "clik", column 1: "clik" is not a step.` Each state starts from a fresh load of its page,
so states never leak into each other. A page that does not answer after the first, or a state whose
step fails, reads *not scanned* with why, the run goes on, and the exit is 1.

`--states` does not mix with `--config`: a config's states live under their pages.

## The YAML it reads

The file is read by `src/yaml-subset.ts`, a strict reader for the small part of YAML a config needs, so the package
takes no YAML dependency for it. A file in the subset reads the same in a YAML parser, with three exceptions
(listed after the rules below). What it takes:

- blocks of `key: value` lines and `- ` lists, nested by indenting with spaces (a tab is refused);
- a value that is text: plain (`/settings`, `http://localhost:5173`), `"double-quoted"` with JSON's escapes, or
  `'single-quoted'` with `''` for a `'`;
- a list of such values on one line: `["click button 'Menu'", "wait menu"]`;
- `# comments`.

Everything else is refused with its line: tags (`!!`), anchors and aliases (`&`, `*`), merge keys, block text
(`|`, `>`), flow maps (`{}`), document markers (`---`), a key given twice, text with `: ` in it that is not
quoted, a file over 5000 lines or 20 levels deep, and a file over 1 MB. Numbers and `true` or `false` are read as
the text they are. Put each step in double quotes, as above, so the single quotes inside it reach the step parser
as they are.

Three things read differently here than in a YAML parser. Avoid them, and the file reads the same in both:

- **A tab before `#`.** In YAML, `key: value<tab># note` ends the value before the tab. Here a `#` is a comment only
  at the start of a line or after a space, so the `#` and the text after it stay in the value. Put a space before
  `#`.
- **A quote after `,` or `:` inside a value.** In YAML, a plain value such as `a, "b # c"` is not quoted, so the
  `#` starts a comment. Here a quote opens a string after a `,` or `:`, so the `#` stays in the value, and a
  quote that never closes is refused with *a quote is never closed*. Quote the whole value, or leave quotes out
  of the middle of it.
- **A `:` followed by a tab.** In YAML, `key:<tab>value` is a pair. Here only `: ` (a colon and a space) ends a
  key, so a line with no other `: ` is refused as not a `key: value` pair, and `- key:<tab>value` in a list is
  read as one text item, not a pair. Use a space after the colon.
