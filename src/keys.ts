/**
 * The key names a step may press (any Playwright key name; docs/STEPS.md), as playwright-core 1.65.1 accepts them
 * in `keyboard.press()`. `test/unit/keys.test.ts` reads playwright-core's own keyboard layout and fails when
 * this list and the installed version's differ, so a Playwright update that adds or drops a key is seen.
 */

/** The named keys: every key code of Playwright's US layout, its aliases, and `ControlOrMeta`. */
const NAMED_KEYS = [
  // Functions row
  "Escape",
  "F1",
  "F2",
  "F3",
  "F4",
  "F5",
  "F6",
  "F7",
  "F8",
  "F9",
  "F10",
  "F11",
  "F12",
  // Numbers row
  "Backquote",
  "Digit1",
  "Digit2",
  "Digit3",
  "Digit4",
  "Digit5",
  "Digit6",
  "Digit7",
  "Digit8",
  "Digit9",
  "Digit0",
  "Minus",
  "Equal",
  "Backslash",
  "Backspace",
  // Letter rows
  "Tab",
  "KeyQ",
  "KeyW",
  "KeyE",
  "KeyR",
  "KeyT",
  "KeyY",
  "KeyU",
  "KeyI",
  "KeyO",
  "KeyP",
  "BracketLeft",
  "BracketRight",
  "CapsLock",
  "KeyA",
  "KeyS",
  "KeyD",
  "KeyF",
  "KeyG",
  "KeyH",
  "KeyJ",
  "KeyK",
  "KeyL",
  "Semicolon",
  "Quote",
  "Enter",
  "ShiftLeft",
  "Shift",
  "KeyZ",
  "KeyX",
  "KeyC",
  "KeyV",
  "KeyB",
  "KeyN",
  "KeyM",
  "Comma",
  "Period",
  "Slash",
  "ShiftRight",
  // Last row
  "ControlLeft",
  "Control",
  "MetaLeft",
  "Meta",
  "AltLeft",
  "Alt",
  "Space",
  "AltRight",
  "AltGraph",
  "MetaRight",
  "ContextMenu",
  "ControlRight",
  "ControlOrMeta",
  // Centre block
  "PrintScreen",
  "ScrollLock",
  "Pause",
  "PageUp",
  "PageDown",
  "Insert",
  "Delete",
  "Home",
  "End",
  "ArrowLeft",
  "ArrowUp",
  "ArrowRight",
  "ArrowDown",
  // Media keys
  "AudioVolumeMute",
  "AudioVolumeDown",
  "AudioVolumeUp",
  "MediaTrackNext",
  "MediaTrackPrevious",
  "MediaPlayPause",
  // Numpad
  "NumLock",
  "NumpadDivide",
  "NumpadMultiply",
  "NumpadSubtract",
  "Numpad7",
  "Numpad8",
  "Numpad9",
  "Numpad4",
  "Numpad5",
  "Numpad6",
  "NumpadAdd",
  "Numpad1",
  "Numpad2",
  "Numpad3",
  "Numpad0",
  "NumpadDecimal",
  "NumpadEnter",
];

/**
 * The single characters Playwright presses as keys: each printable character of the US layout, shifted or not.
 * Four it also accepts are left out, because the step grammar gives them another meaning: the space (written
 * `Space`), `;` (written `Semicolon`), `'` (written `Quote`), and the newline and carriage return (written
 * `Enter`).
 */
const CHARACTER_KEYS =
  '`~1!2@3#4$5%6^7&8*9(0)-_=+\\|qQwWeErRtTyYuUiIoOpP[{]}aAsSdDfFgGhHjJkKlL:"zZxXcCvVbBnNmM,<.>/?';

/** Every key name a step may press on its own, or last in a combination such as `Shift+Tab`. */
export const KEY_NAMES: ReadonlySet<string> = new Set([...NAMED_KEYS, ...CHARACTER_KEYS]);

/** The keys that may come before a `+` in a combination, held down while the last key is pressed. */
export const MODIFIER_KEYS: ReadonlySet<string> = new Set([
  "Shift",
  "Control",
  "Alt",
  "Meta",
  "ControlOrMeta",
]);
