/**
 * The genie and his bottle: the drawing A11y Genie shows a person at a terminal.
 *
 * An original character: a rounded genie with big sleepy eyes and a lopsided smirk, a curl of smoke for
 * a crown, floating on puffs of mist above a tall bottle with a pointed stopper.
 *
 * Printable ASCII only, at most 18 lines of at most 72 columns, so it draws the same in every
 * terminal. Nothing prints it yet: it is for a person at a terminal, never for `--json`, a pipe or CI.
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
