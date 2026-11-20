/**
 * The genie and his bottle: the drawing A11y Genie shows a person at a terminal.
 *
 * An original character: a rounded genie with big sleepy eyes and a lopsided smirk, a curl of smoke for
 * a crown, floating on puffs of mist above a tall bottle with a pointed stopper.
 *
 * Printable ASCII only, at most 18 lines of at most 72 columns, so it draws the same in every
 * terminal. It is for a person at a terminal: `--help` prints it on stdout, and `scan`, `check` and `narrate`
 * on stderr, never under `--json`, to a pipe or file, in CI, or on a terminal too narrow for it.
 * The README's first block is the same drawing, and a test holds the two together.
 */
export const BANNER_MAX_LINES = 18;
export const BANNER_MAX_COLUMNS = 72;

export const BANNER_LINES: readonly string[] = String.raw`
                    ,-.
                   ( (_)
            .-~~~~~' '~~~~~-.
           /  .---.   .---.  \
          |   |===|   |===|   |
          |   '-o-'   '-o-'   |
           \     -.____.-~'  /
             '-._________.-'
        .-~-.(  ~-.___.-~  ).-~-.
       (__.-~-.__)~~~~~(__.-~-.__)
                   /^\
                  /___\
                   | |
                   | |
                .-'   '-.
               /  ~   ~  \
               |  a11y   |
               '._______.'
`
  .split("\n")
  .slice(1, -1);

/** The drawing as one string, each line ending in a newline. */
export const BANNER: string = BANNER_LINES.map((line) => `${line}\n`).join("");

/** The widest line of the drawing, in columns. */
const BANNER_WIDTH = Math.max(...BANNER_LINES.map((line) => line.length));

/** True when `CI` is set to anything but "", "0" or "false" (any case). */
export function isCi(env: NodeJS.ProcessEnv): boolean {
  const value = env.CI?.trim().toLowerCase();
  return value !== undefined && value !== "" && value !== "0" && value !== "false";
}

export interface BannerContext {
  /** Whether the stream the drawing would go to is a terminal. */
  isTTY: boolean | undefined;
  /** That stream's width in columns, when it knows. */
  columns: number | undefined;
  env: NodeJS.ProcessEnv;
  /** `--json` is on. */
  json: boolean;
}

/**
 * Whether to show the drawing. Not under `--json`, not unless the stream is a terminal, not in CI, and not
 * when the terminal is narrower than the drawing. The drawing has no colour, so `NO_COLOR` does not hide it.
 */
export function shouldShowBanner({ isTTY, columns, env, json }: BannerContext): boolean {
  if (json || isTTY !== true || isCi(env)) return false;
  // A size of 0 is a terminal that does not know its width (a bare pty), not a narrow one.
  return columns === undefined || columns <= 0 || columns >= BANNER_WIDTH;
}

/** `text` with the drawing and an empty line above it when `show`, else `text` unchanged. */
export function withBanner(text: string, show: boolean): string {
  return show ? `${BANNER}\n${text}` : text;
}

/** Writes the drawing to stderr, for a run, when stderr is a terminal that wants it. Call it once the arguments are accepted. */
export function printRunBanner(json: boolean): void {
  const show = shouldShowBanner({
    isTTY: process.stderr.isTTY,
    columns: process.stderr.columns,
    env: process.env,
    json,
  });
  if (show) process.stderr.write(withBanner("", true));
}
