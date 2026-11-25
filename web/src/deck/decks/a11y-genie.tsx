import type { CSSProperties, ReactNode } from "react";
import { ComponentFrame } from "../deck-engine/ComponentFrame";
import { NARRATION_CHARS_PER_SEC } from "../deck-engine/deckDuration";
import { CopyLinkButton } from "../deck-engine/CopyLinkButton";
import { createMakeSlide } from "../deck-engine/makeSlide";
import { Beat, Context, Say } from "../deck-engine/PresenterNoteKit";
import { slideSpokenText } from "../deck-engine/sayText";
import { useCompactLayout } from "../deck-engine/useCompactLayout";
import type { Deck, Slide } from "./types";
import { DeckState } from "./types";

// A11y Genie — the commercial. A dusty bottle on a shelf is wiped clean, and a
// genie rides out of it on a magic carpet to grant three wishes: accessible
// HTML, focus you can follow, and narrated workflows. The bottle is the tool,
// the genie is its voice, the carpet is the ride through a page.
//
// The genie is the studio's own: a rounded, big-eyed bust in lamp-gold with
// accessibility words written on his body, floating on puffs of smoke. He
// follows no film's genie, in colour, build or face.

// ── Palette — named for what the colours MEAN in this world ──────────────────
const P = {
  // lamp-gold — order forming, a calm balance: the genie and the bottle's light
  goldHot: "#fff1c4",
  goldHi: "#ffdf86",
  gold: "#f2bd45",
  goldDeep: "#c27f17",
  goldShadow: "#7a4709",
  /** the ink the genie's body words are written in: dark enough for 4.5:1 on his gold */
  goldInk: "#2a1400",
  // carpet-crimson — the journey and its widening path
  crimsonHi: "#cf4257",
  crimson: "#a3203a",
  crimsonDeep: "#5c0c20",
  // lantern-teal — structure appearing (the carpet's medallion)
  tealHi: "#7fe0cf",
  teal: "#27a796",
  tealDeep: "#0d5751",
  // night-velvet — the calm dark the bottle waits in
  night: "#120c22",
  nightHi: "#251a42",
  nightLift: "#3a2b5e",
  nightDeep: "#07050f",
  /** the moon's cool light through a window nobody sees */
  moon: "#c9c4f2",
  // parchment, from the Worker's Almanac's palette: the faded label, the carpet's cream
  parchment: "#e4cf9c",
  parchmentHi: "#f3e6c4",
  parchmentDeep: "#c6a86c",
  parchmentEdge: "#a88a52",
  // dust: grey with the night in it
  dust: "#9d97a8",
  dustHi: "#c3bdca",
  // copy panel
  leadText: "#ebe3d2",
  // bug-ink — the knot of a bug and the force meeting it
  bugInk: "#ff5fa2",
  bugInkDeep: "#5a0f36",
  // the Bug Cards: the Worker's Almanac's parchment and its iron-gall ink (AL.order,
  // orderDeep, orderEdge, ink), copied so this deck travels alone
  ink: "#33220f",
  inkSoft: "#5a4025",
  /** bug-ink and lamp-gold as marks on parchment: deep enough for 3:1 on the cream */
  bugMark: "#9c0f4c",
  goldMark: "#d99a1e",
  goldMarkEdge: "#5a3800",
  /** bug-ink lightened for text on the page's dark chips */
  bugInkHi: "#ff9cc8",
  // The Page: a lit screen in the dark
  screen: "#2e2456",
  screenDeep: "#1a1434",
  screenLine: "#b9b0dc",
  screenEdge: "#6f61a8",
} as const;

const MONO = "'Cascadia Code', 'Fira Code', 'Consolas', monospace";

// The four acts' easings (design/a11y-genie.md, "Tempo Arc").
const ACT_I = "cubic-bezier(0.25, 0.25, 0.75, 0.75)";
const ACT_II = "cubic-bezier(0.34, 1.56, 0.64, 1)";
const ACT_IV = "cubic-bezier(0.25, 0.46, 0.45, 0.94)";

// ── Copy-panel kit — the house chrome, in this world's colours ──────────────
function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p
      style={{
        fontFamily: MONO,
        fontSize: "0.75rem",
        fontWeight: 700,
        letterSpacing: "0.16em",
        textTransform: "uppercase",
        color: P.gold,
        margin: "0 0 16px 0",
        display: "flex",
        alignItems: "center",
        gap: "10px",
      }}
    >
      <span style={{ display: "inline-block", width: "22px", height: "2px", backgroundColor: P.gold, borderRadius: "1px", flexShrink: 0 }} />
      {children}
    </p>
  );
}

function SlideTitle({ children }: { children: ReactNode }) {
  return (
    <h2
      style={{
        fontSize: "clamp(1.45rem, 6vw, 2.5rem)",
        fontWeight: 800,
        lineHeight: "1.22em",
        margin: "0 0 20px 0",
        background: `linear-gradient(172deg, #ffffff 0%, ${P.parchmentHi} 34%, ${P.goldHi} 70%, ${P.gold} 100%)`,
        WebkitBackgroundClip: "text",
        WebkitTextFillColor: "transparent",
        backgroundClip: "text",
        filter: "drop-shadow(0 0 14px rgba(255,214,120,0.22))",
        whiteSpace: "pre-line",
      }}
    >
      {children}
    </h2>
  );
}

function Lead({ children }: { children: ReactNode }) {
  return <p style={{ fontSize: "1.25rem", lineHeight: 1.75, color: P.leadText, margin: "0 0 24px 0", whiteSpace: "pre-line" }}>{children}</p>;
}

function CopyPanel({ children }: { children: ReactNode }) {
  return <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", height: "100%", padding: "40px 88px 40px 48px" }}>{children}</div>;
}

const makeSlide = createMakeSlide({ CopyPanel, Eyebrow, SlideTitle, Lead });

// ── Keyframes — one block per deck, mounted in each Stage ────────────────────
function GenieKeyframes() {
  return (
    <style>{`
      /* the bottle sighs: its light presses at the glass, then eases off */
      @keyframes ag-sigh { 0%,100% { opacity: 0.55; } 50% { opacity: 1; } }
      /* a wisp of wish smoke leaves the neck, rises, widens and thins out */
      @keyframes ag-wisp { 0% { transform: translate(0, 0) scale(0.6); opacity: 0; } 18% { opacity: 0.85; } 100% { transform: translate(var(--wx, 18px), -170px) scale(1.5); opacity: 0; } }
      /* dust hanging in the moonlight */
      @keyframes ag-mote { 0%,100% { transform: translate(0, 0); } 50% { transform: translate(var(--mx, 6px), var(--my, -10px)); } }
      @keyframes ag-twinkle { 0%,100% { opacity: 0.25; } 50% { opacity: 0.9; } }
      /* the feather duster: in from the left, three strokes across the glass (belly, shoulders, neck), then up and away */
      @keyframes ag-dust {
        0%   { transform: translate(-120px, -20px) rotate(-14deg); opacity: 0; }
        8%   { transform: translate(-40px, -10px) rotate(-8deg); opacity: 1; }
        26%  { transform: translate(250px, -10px) rotate(10deg); }
        44%  { transform: translate(0px, -50px) rotate(-12deg); }
        62%  { transform: translate(230px, -90px) rotate(8deg); }
        78%  { transform: translate(90px, -170px) rotate(-6deg); opacity: 1; }
        100% { transform: translate(380px, -300px) rotate(20deg); opacity: 0; }
      }
      /* its plume flexes against the glass on each stroke */
      @keyframes ag-flex { 0%,100% { transform: scale(1, 1); } 25% { transform: scale(0.9, 1.06); } 50% { transform: scale(1.04, 0.95); } 75% { transform: scale(0.9, 1.06); } }
      /* dust knocked off the glass: a small grey cloud that swells and thins */
      @keyframes ag-dustpuff { 0% { transform: translate(0, 0) scale(0.3); opacity: 0; } 15% { opacity: 0.7; } 100% { transform: translate(var(--px, 30px), var(--py, -40px)) scale(1.6); opacity: 0; } }
      /* the dust lifts off the glass as the duster passes */
      @keyframes ag-dustoff { 0% { opacity: 1; } 30% { opacity: 0.7; } 62% { opacity: 0.35; } 100% { opacity: 0; } }
      /* lamp-gold light spills out of the clean glass */
      @keyframes ag-spill { from { transform: scale(0.25); opacity: 0; } to { transform: scale(1); opacity: 1; } }
      /* a smoke ribbon draws itself from the neck to the genie */
      @keyframes ag-draw { from { stroke-dashoffset: 1; } to { stroke-dashoffset: 0; } }
      /* the carpet unrolls from its left end */
      @keyframes ag-unroll { from { transform: scaleX(0.02); } to { transform: scaleX(1); } }
      @keyframes ag-roll { 0% { transform: translateX(0) scaleX(1); opacity: 0; } 4% { opacity: 1; } 92% { opacity: 1; } 100% { transform: translateX(620px) scaleX(0.35); opacity: 0; } }
      /* the genie rises out of the neck in a curl, and grows to his size */
      /* equilibrium: the genie and his carpet float, held in balance */
      @keyframes ag-float { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-9px); } }
      @keyframes ag-puff { 0%,100% { transform: scale(1); } 50% { transform: scale(1.08); } }
      @keyframes ag-flicker { 0%,100% { transform: rotate(-4deg) scaleY(1); } 50% { transform: rotate(5deg) scaleY(1.08); } }
      @keyframes ag-blink { 0%,90%,100% { transform: scaleY(1); } 94% { transform: scaleY(0.1); } }
      @keyframes ag-fadein { from { opacity: 0; } to { opacity: 1; } }
      @keyframes ag-fadeout { from { opacity: 1; } to { opacity: 0; } }
      @keyframes ag-sweep { 0% { opacity: 0; } 40% { opacity: 0.22; } 100% { opacity: 0; } }
      /* act IV: a card comes out of the smoke and settles into the list */
      @keyframes ag-cardin { 0% { transform: translateY(-26px) scale(0.86); opacity: 0; filter: blur(5px); } 40% { opacity: 1; filter: blur(0); } 70% { transform: translateY(3px) scale(1.01); } 100% { transform: none; opacity: 1; } }
      @keyframes ag-cardsmoke { 0% { transform: scale(0.5); opacity: 0; } 30% { opacity: 0.85; } 100% { transform: scale(1.5); opacity: 0; } }
      /* a card flies off the carpet into the backlog */
      @keyframes ag-scan { 0% { transform: translateY(30px); opacity: 0; } 10% { opacity: 1; } 90% { opacity: 1; } 100% { transform: translateY(594px); opacity: 0; } }
      @keyframes ag-stamp { from { transform: scale(1.9) rotate(-12deg); opacity: 0; } to { transform: none; opacity: 1; } }
      @keyframes ag-settle { from { transform: translateY(-14px); opacity: 0; } to { transform: none; opacity: 1; } }
      @keyframes ag-handup { from { transform: none; } to { transform: rotate(-78deg); } }
      @keyframes ag-handdown { from { transform: rotate(-78deg); } to { transform: none; } }
      /* the genie's mist: a slow drift and eddy, and a breath in its opacity */
      @keyframes ag-mistdrift { 0%,100% { transform: translate(0, 0) scale(1); } 30% { transform: translate(var(--dx), var(--dy)) scale(1.06); } 65% { transform: translate(calc(var(--dx) * -0.6), calc(var(--dy) * 0.5)) scale(0.96); } }
      @keyframes ag-breathe { 0%,100% { opacity: var(--o1); } 50% { opacity: var(--o2); } }
      /* it spreads out under him as he settles */
      @keyframes ag-billow { from { transform: scale(0.45, 0.6); opacity: 0.3; } to { transform: none; opacity: 1; } }
      /* a streak of mist left behind as he flies in */
      @keyframes ag-trail { 0% { transform: translateX(0) scaleX(0.6); opacity: 0.7; } 100% { transform: translateX(-60px) scaleX(1.4); opacity: 0; } }
      @keyframes ag-glint { 0%,100% { transform: scale(0.3); opacity: 0; } 50% { transform: scale(1); opacity: 1; } }
      /* a dialog: opens with a pop, holds, and closes */
      @keyframes ag-dialog { 0% { transform: scale(0.7); opacity: 0; } 12% { transform: none; opacity: 1; } 88% { transform: none; opacity: 1; } 100% { transform: scale(0.96); opacity: 0; } }
      /* act II: things arrive with a little overshoot */
      @keyframes ag-approach { from { transform: translateX(60px) scale(0.92); opacity: 0; } to { transform: none; opacity: 1; } }
      @keyframes ag-flyin { from { transform: translateX(-420px); } to { transform: none; } }
      @keyframes ag-pop { from { transform: scale(0.6); opacity: 0; } to { transform: none; opacity: 1; } }
      /* a landmark lantern lights: its glass warms from dark to teal */
      @keyframes ag-light { from { opacity: 0.12; } to { opacity: 1; } }
      /* a bug knot snaps tight, trembles, and lets go */
      @keyframes ag-knot { from { transform: scale(1.6) rotate(-24deg); opacity: 0; } to { transform: none; opacity: 1; } }
      @keyframes ag-tremble { 0%,100% { transform: translate(0, 0); } 25% { transform: translate(-1.5px, 1px); } 50% { transform: translate(1.5px, -1px); } 75% { transform: translate(-1px, -1px); } }
      @keyframes ag-untie { from { transform: none; opacity: 1; } to { transform: scale(1.5) rotate(28deg); opacity: 0; } }
      /* a line glows where the genie names a bug */
      @keyframes ag-name { 0% { opacity: 0; } 30% { opacity: 1; } 100% { opacity: 0.55; } }
    `}</style>
  );
}

function Stage({ children }: { children: ReactNode }) {
  return (
    <div style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden", background: P.night }}>
      <GenieKeyframes />
      {children}
    </div>
  );
}

/** An animation that rests on its end state: the element's own style is what it shows, before and after. */
const anim = (name: string, dur: number, delay = 0, extra: CSSProperties = {}, fill = "backwards", ease: string = ACT_I): CSSProperties => ({
  animation: `${name} ${dur}s ${ease} ${delay}s ${fill}`,
  ...extra,
});

type Pt = [number, number];

/** Transform about the element's own box: SVG groups need it for scale and rotate. */
const box = (origin: string): CSSProperties => ({ transformBox: "fill-box", transformOrigin: origin });

// ── The shared definitions: gradients and textures ───────────────────────────
function Defs() {
  return (
    <defs>
      {/* the wall: night-velvet, a little lifted where the moon falls */}
      <radialGradient id="ag-wall" cx="32%" cy="20%" r="85%">
        <stop offset="0%" stopColor={P.nightHi} />
        <stop offset="55%" stopColor={P.night} />
        <stop offset="100%" stopColor={P.nightDeep} />
      </radialGradient>
      {/* the moon's shaft, from a window high on the left */}
      <linearGradient id="ag-shaft" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor={P.moon} stopOpacity="0.16" />
        <stop offset="70%" stopColor={P.moon} stopOpacity="0.05" />
        <stop offset="100%" stopColor={P.moon} stopOpacity="0" />
      </linearGradient>
      {/* the shelf: a dark painted board, its top caught by the light */}
      <linearGradient id="ag-shelftop" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#4a3d63" />
        <stop offset="100%" stopColor="#2c2342" />
      </linearGradient>
      <linearGradient id="ag-shelffront" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#231b37" />
        <stop offset="100%" stopColor="#120c20" />
      </linearGradient>
      {/* amber glass: dark at the walls of the bottle, bright where light passes through the middle */}
      <linearGradient id="ag-glass" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stopColor="#4a2a06" />
        <stop offset="18%" stopColor="#a3610f" />
        <stop offset="38%" stopColor="#e09a2a" />
        <stop offset="62%" stopColor="#b8721a" />
        <stop offset="86%" stopColor="#6a3c08" />
        <stop offset="100%" stopColor="#8c6a8e" />
      </linearGradient>
      {/* the same glass under dust: the colour gone grey and the light gone flat */}
      <linearGradient id="ag-glassdusty" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stopColor="#2e2320" />
        <stop offset="30%" stopColor="#6a5338" />
        <stop offset="55%" stopColor="#7d6040" />
        <stop offset="85%" stopColor="#3d2d22" />
        <stop offset="100%" stopColor="#5d5668" />
      </linearGradient>
      {/* the light inside the bottle: the genie pressing at the glass */}
      <radialGradient id="ag-inner" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stopColor={P.goldHot} stopOpacity="0.95" />
        <stop offset="40%" stopColor={P.gold} stopOpacity="0.55" />
        <stop offset="100%" stopColor={P.gold} stopOpacity="0" />
      </radialGradient>
      {/* the glow it throws on the wall and the shelf */}
      <radialGradient id="ag-spillglow" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stopColor={P.goldHi} stopOpacity="0.55" />
        <stop offset="35%" stopColor={P.gold} stopOpacity="0.22" />
        <stop offset="100%" stopColor={P.gold} stopOpacity="0" />
      </radialGradient>
      {/* dust film: heaviest on the surfaces that face up */}
      <linearGradient id="ag-dustfilm" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={P.dustHi} stopOpacity="0.85" />
        <stop offset="45%" stopColor={P.dust} stopOpacity="0.5" />
        <stop offset="100%" stopColor={P.dust} stopOpacity="0.28" />
      </linearGradient>
      {/* dust grain: fine speckle */}
      <filter id="ag-grain" x="0" y="0" width="100%" height="100%">
        <feTurbulence type="fractalNoise" baseFrequency="0.75" numOctaves="2" seed="7" result="n" />
        <feColorMatrix in="n" type="matrix" values="0 0 0 0 0.8  0 0 0 0 0.77  0 0 0 0 0.84  0 0 0 2.2 -1.3" result="speck" />
        <feComposite in="speck" in2="SourceAlpha" operator="in" />
      </filter>
      {/* the wall's own grain, barely there */}
      <filter id="ag-wallgrain" x="0" y="0" width="100%" height="100%">
        <feTurbulence type="fractalNoise" baseFrequency="0.7" numOctaves="3" seed="3" result="n" />
        <feColorMatrix in="n" type="matrix" values="0 0 0 0 0.6  0 0 0 0 0.55  0 0 0 0 0.8  0 0 0 0.9 -0.42" />
      </filter>
      {/* the carpet's weave */}
      <filter id="ag-weave" x="0" y="0" width="100%" height="100%">
        <feTurbulence type="fractalNoise" baseFrequency="0.9 0.25" numOctaves="2" seed="11" result="n" />
        <feColorMatrix in="n" type="matrix" values="0 0 0 0 0.1  0 0 0 0 0.02  0 0 0 0 0.05  0 0 0 1.1 -0.45" result="w" />
        <feComposite in="w" in2="SourceAlpha" operator="in" />
      </filter>
      <filter id="ag-soft" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="6" />
      </filter>
      <filter id="ag-softer" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="16" />
      </filter>
      <filter id="ag-hair" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur stdDeviation="1.2" />
      </filter>
      {/* wish smoke: pale gold going to nothing */}
      <linearGradient id="ag-smoke" x1="0" y1="1" x2="0" y2="0">
        <stop offset="0%" stopColor={P.goldHot} stopOpacity="0.85" />
        <stop offset="100%" stopColor={P.goldHi} stopOpacity="0" />
      </linearGradient>
      <radialGradient id="ag-mist" cx="45%" cy="40%" r="55%">
        <stop offset="0%" stopColor="#fff8e2" stopOpacity="0.85" />
        <stop offset="45%" stopColor="#f6dc9c" stopOpacity="0.55" />
        <stop offset="100%" stopColor="#e9bf6a" stopOpacity="0" />
      </radialGradient>
      {/* the far mist, lit from above by his gold and fading out below */}
      <radialGradient id="ag-mistlit" cx="50%" cy="25%" r="70%">
        <stop offset="0%" stopColor="#fff3cf" stopOpacity="0.9" />
        <stop offset="50%" stopColor={P.goldHi} stopOpacity="0.45" />
        <stop offset="100%" stopColor={P.gold} stopOpacity="0" />
      </radialGradient>
      <radialGradient id="ag-puff" cx="40%" cy="35%" r="65%">
        <stop offset="0%" stopColor="#fff8e2" />
        <stop offset="55%" stopColor="#f6dc9c" />
        <stop offset="100%" stopColor="#c99a55" stopOpacity="0.85" />
      </radialGradient>
      {/* the genie's body: lamp-gold, lit from above-left, the night bouncing violet into his right side */}
      <radialGradient id="ag-body" cx="36%" cy="26%" r="78%">
        <stop offset="0%" stopColor={P.goldHot} />
        <stop offset="30%" stopColor={P.goldHi} />
        <stop offset="62%" stopColor={P.gold} />
        <stop offset="100%" stopColor={P.goldDeep} />
      </radialGradient>
      <linearGradient id="ag-bodyrim" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stopColor={P.nightLift} stopOpacity="0" />
        <stop offset="78%" stopColor={P.nightLift} stopOpacity="0" />
        <stop offset="100%" stopColor="#8a6fb8" stopOpacity="0.45" />
      </linearGradient>
      <linearGradient id="ag-bodyfoot" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={P.goldShadow} stopOpacity="0" />
        <stop offset="70%" stopColor={P.goldShadow} stopOpacity="0" />
        <stop offset="100%" stopColor={P.goldShadow} stopOpacity="0.35" />
      </linearGradient>
      <linearGradient id="ag-arm" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={P.goldHi} />
        <stop offset="100%" stopColor={P.goldDeep} />
      </linearGradient>
      <radialGradient id="ag-mitt" cx="38%" cy="32%" r="70%">
        <stop offset="0%" stopColor={P.goldHot} />
        <stop offset="60%" stopColor={P.gold} />
        <stop offset="100%" stopColor={P.goldDeep} />
      </radialGradient>
      <radialGradient id="ag-eye" cx="42%" cy="36%" r="70%">
        <stop offset="0%" stopColor="#ffffff" />
        <stop offset="100%" stopColor="#efe4cf" />
      </radialGradient>
      <radialGradient id="ag-aura" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stopColor={P.goldHi} stopOpacity="0.38" />
        <stop offset="60%" stopColor={P.gold} stopOpacity="0.1" />
        <stop offset="100%" stopColor={P.gold} stopOpacity="0" />
      </radialGradient>
      {/* the carpet's field: crimson, warmest at the centre */}
      <radialGradient id="ag-field" cx="50%" cy="50%" r="60%">
        <stop offset="0%" stopColor={P.crimsonHi} />
        <stop offset="60%" stopColor={P.crimson} />
        <stop offset="100%" stopColor="#7d1529" />
      </radialGradient>
      <radialGradient id="ag-medallion" cx="45%" cy="40%" r="60%">
        <stop offset="0%" stopColor={P.tealHi} />
        <stop offset="55%" stopColor={P.teal} />
        <stop offset="100%" stopColor={P.tealDeep} />
      </radialGradient>
      {/* the carpet's gentle ripple: light and shade across its length */}
      <linearGradient id="ag-ripple" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stopColor="#000" stopOpacity="0.34" />
        <stop offset="14%" stopColor="#fff" stopOpacity="0.1" />
        <stop offset="30%" stopColor="#000" stopOpacity="0.22" />
        <stop offset="47%" stopColor="#fff" stopOpacity="0.14" />
        <stop offset="64%" stopColor="#000" stopOpacity="0.22" />
        <stop offset="81%" stopColor="#fff" stopOpacity="0.1" />
        <stop offset="100%" stopColor="#000" stopOpacity="0.38" />
      </linearGradient>
      <linearGradient id="ag-rollshade" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stopColor={P.crimsonDeep} />
        <stop offset="40%" stopColor={P.crimsonHi} />
        <stop offset="100%" stopColor={P.crimsonDeep} />
      </linearGradient>
      {/* the duster's turned handle: lit from the left, by the bottle */}
      <linearGradient id="ag-handle" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stopColor="#d9aa6a" />
        <stop offset="0.45" stopColor="#a8743c" />
        <stop offset="1" stopColor="#5a3818" />
      </linearGradient>
      <linearGradient id="ag-band" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stopColor="#4a4550" />
        <stop offset="0.35" stopColor="#1a171e" />
        <stop offset="1" stopColor="#060508" />
      </linearGradient>
      {/* an ostrich feather: dark at the quill, softer and lighter as it frays to the tip */}
      <linearGradient id="ag-feather" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#141016" />
        <stop offset="0.45" stopColor="#3d3238" stopOpacity="0.95" />
        <stop offset="0.85" stopColor="#6e5c58" stopOpacity="0.75" />
        <stop offset="1" stopColor="#8a7670" stopOpacity="0.35" />
      </linearGradient>
      {/* feathers fray: their edges broken into barbs */}
      <filter id="ag-fluff" x="-30%" y="-30%" width="160%" height="160%">
        <feTurbulence type="fractalNoise" baseFrequency="0.09 0.5" numOctaves="2" seed="5" result="t" />
        <feDisplacementMap in="SourceGraphic" in2="t" scale="14" xChannelSelector="R" yChannelSelector="G" result="d" />
        <feGaussianBlur in="d" stdDeviation="0.8" />
      </filter>
      <linearGradient id="ag-screen" x1="0" y1="0" x2="0.4" y2="1">
        <stop offset="0" stopColor="#3a2f6a" />
        <stop offset="1" stopColor={P.screenDeep} />
      </linearGradient>
      <linearGradient id="ag-goldbtn" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor={P.goldHi} />
        <stop offset="1" stopColor={P.gold} />
      </linearGradient>
      <radialGradient id="ag-lanternglass" cx="50%" cy="45%" r="60%">
        <stop offset="0" stopColor={P.tealHi} />
        <stop offset="0.6" stopColor={P.teal} />
        <stop offset="1" stopColor={P.tealDeep} />
      </radialGradient>
      <linearGradient id="ag-panel" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#1c1a26" />
        <stop offset="0.5" stopColor="#0d0c13" />
        <stop offset="1" stopColor="#15131d" />
      </linearGradient>
      <radialGradient id="ag-card" cx="50%" cy="40%" r="70%">
        <stop offset="0" stopColor={P.parchmentHi} />
        <stop offset="0.55" stopColor={P.parchment} />
        <stop offset="1" stopColor={P.parchmentDeep} />
      </radialGradient>
      {/* one bottle shape, reused for the glass, the dust and the clip */}
      <clipPath id="ag-bottleclip">
        <path d={BOTTLE_BODY} />
      </clipPath>
    </defs>
  );
}

/** The 1600×900 canvas, sliced to the panel: discrete atoms live in x≈300–1300. */
function Scene({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
      <Defs />
      {children}
    </svg>
  );
}

// ── The room: a night wall and the moon's shaft ─────────────────────────────
// Motes are placed by index, never at random, so every capture is the same.
const MOTES = Array.from({ length: 26 }, (_, i) => ({
  x: 260 + ((i * 137) % 900),
  y: 140 + ((i * 89) % 470),
  r: 1.2 + (i % 4) * 0.7,
  d: 5 + (i % 5) * 1.3,
  delay: -((i * 0.73) % 6),
}));

function NightWall({ motes = true }: { motes?: boolean }) {
  return (
    <g>
      <rect x={0} y={0} width={1600} height={900} fill="url(#ag-wall)" />
      <rect x={0} y={0} width={1600} height={900} filter="url(#ag-wallgrain)" opacity={0.35} />
      {/* the shaft of moonlight, falling from the upper left across the shelf */}
      <path d="M 120 -40 L 520 -40 L 1180 900 L 560 900 Z" fill="url(#ag-shaft)" filter="url(#ag-soft)" />
      {motes &&
        MOTES.map((m, i) => (
          <circle
            key={i}
            cx={m.x}
            cy={m.y}
            r={m.r}
            fill={P.moon}
            style={
              {
                "--mx": `${(i % 3) * 5 - 5}px`,
                "--my": `${-6 - (i % 4) * 3}px`,
                animation: `ag-mote ${m.d}s ease-in-out ${m.delay}s infinite, ag-twinkle ${m.d * 0.8}s ease-in-out ${m.delay}s infinite`,
              } as CSSProperties
            }
          />
        ))}
      {/* the corners fall away into the dark */}
      <rect x={0} y={0} width={1600} height={900} fill="none" stroke={P.nightDeep} strokeWidth={260} opacity={0.5} filter="url(#ag-softer)" />
    </g>
  );
}

// ── The shelf ───────────────────────────────────────────────────────────────
// A dark painted board running off both edges of the frame. Its top is where
// the dust settles and where the bottle's light lands.
const SHELF_Y = 760;

function Shelf({ glowX, glow = 0.3 }: { glowX: number; glow?: number }) {
  return (
    <g>
      {/* the shadow the board throws on the wall under it */}
      <rect x={-40} y={SHELF_Y + 54} width={1680} height={70} fill={P.nightDeep} opacity={0.7} filter="url(#ag-soft)" />
      {/* the top face, seen a little from above */}
      <path d={`M -40 ${SHELF_Y - 22} L 1640 ${SHELF_Y - 22} L 1640 ${SHELF_Y} L -40 ${SHELF_Y} Z`} fill="url(#ag-shelftop)" />
      {/* dust lying on the top face, thick and soft */}
      <path d={`M -40 ${SHELF_Y - 22} L 1640 ${SHELF_Y - 22} L 1640 ${SHELF_Y - 2} L -40 ${SHELF_Y - 2} Z`} fill={P.dust} opacity={0.32} />
      <path d={`M -40 ${SHELF_Y - 22} L 1640 ${SHELF_Y - 22} L 1640 ${SHELF_Y - 2} L -40 ${SHELF_Y - 2} Z`} fill="#fff" filter="url(#ag-grain)" opacity={0.5} />
      {/* the front edge catches the light as a thin line */}
      <line x1={-40} y1={SHELF_Y} x2={1640} y2={SHELF_Y} stroke="#6c5d8c" strokeWidth={2} opacity={0.8} />
      <path d={`M -40 ${SHELF_Y} L 1640 ${SHELF_Y} L 1640 ${SHELF_Y + 58} L -40 ${SHELF_Y + 58} Z`} fill="url(#ag-shelffront)" />
      {/* where the bottle's light lands on the board */}
      <ellipse cx={glowX} cy={SHELF_Y - 8} rx={300} ry={40} fill="url(#ag-spillglow)" opacity={glow} />
    </g>
  );
}

// ── The old books, at the left of the shelf ─────────────────────────────────
const BOOKS = [
  { x: 330, w: 46, h: 226, c: "#4d3446", band: "#6e5163" },
  { x: 378, w: 38, h: 204, c: "#34404a", band: "#526270" },
  { x: 418, w: 54, h: 240, c: "#5a4b3a", band: "#7b6a55" },
  { x: 474, w: 34, h: 190, c: "#43314d", band: "#634e70" },
];

function Books() {
  return (
    <g>
      {BOOKS.map((b, i) => {
        const top = SHELF_Y - 4 - b.h;
        return (
          <g key={i}>
            <rect x={b.x} y={top} width={b.w} height={b.h} rx={3} fill={b.c} />
            {/* the spine's roundness: lit on the left, falling off to the right */}
            <rect x={b.x + 3} y={top} width={b.w * 0.28} height={b.h} fill="#fff" opacity={0.07} />
            <rect x={b.x + b.w * 0.72} y={top} width={b.w * 0.28} height={b.h} fill="#000" opacity={0.25} />
            {/* raised bands and a blank title panel: whatever it said is long gone */}
            <rect x={b.x} y={top + 18} width={b.w} height={5} fill={b.band} />
            <rect x={b.x} y={top + 28} width={b.w} height={3} fill={b.band} opacity={0.7} />
            <rect x={b.x + 6} y={top + 52} width={b.w - 12} height={b.h * 0.26} rx={2} fill="#000" opacity={0.18} />
            <rect x={b.x} y={top + b.h - 30} width={b.w} height={5} fill={b.band} />
            {/* the moon's edge light down the left of the spine */}
            <rect x={b.x} y={top + 2} width={2} height={b.h - 4} fill={P.moon} opacity={0.45} />
            {/* wear: the cloth rubbed through at the head and foot, a scuff along the spine */}
            <path d={`M ${b.x} ${top + 8} Q ${b.x + b.w / 2} ${top + 2} ${b.x + b.w} ${top + 9} L ${b.x + b.w} ${top + 3} L ${b.x} ${top + 3} Z`} fill={P.dustHi} opacity={0.3} />
            <rect x={b.x + 2} y={top + b.h - 14} width={b.w - 4} height={8} rx={3} fill={P.dustHi} opacity={0.16} />
            <path d={`M ${b.x + b.w * 0.3} ${top + b.h * 0.62} q ${b.w * 0.2} ${-6} ${b.w * 0.45} ${2}`} fill="none" stroke={P.dustHi} strokeWidth={2} opacity={0.25} />
            {/* dust on the top edge */}
            <rect x={b.x - 1} y={top - 3} width={b.w + 2} height={6} rx={3} fill={P.dustHi} opacity={0.55} />
          </g>
        );
      })}
      {/* the last book has slumped over, its top corner resting on the bottle's shoulder */}
      <g transform={`rotate(21 ${560} ${SHELF_Y - 4})`}>
        <rect x={512} y={SHELF_Y - 4 - 200} width={48} height={200} rx={3} fill="#3e3a52" />
        <rect x={515} y={SHELF_Y - 204} width={13} height={200} fill="#fff" opacity={0.07} />
        <rect x={546} y={SHELF_Y - 204} width={14} height={200} fill="#000" opacity={0.25} />
        <rect x={512} y={SHELF_Y - 186} width={48} height={5} fill="#5c5878" />
        <rect x={512} y={SHELF_Y - 36} width={48} height={5} fill="#5c5878" />
        <rect x={512} y={SHELF_Y - 202} width={2} height={196} fill={P.moon} opacity={0.55} />
        <rect x={514} y={SHELF_Y - 18} width={44} height={8} rx={3} fill={P.dustHi} opacity={0.16} />
        <rect x={511} y={SHELF_Y - 207} width={50} height={6} rx={3} fill={P.dustHi} opacity={0.55} />
      </g>
    </g>
  );
}

// ── The tangle of cables, at the right of the shelf ─────────────────────────
// Old leads nobody threw away: loops piled on each other, one hanging over
// the edge with its plug.
const CABLE_LOOPS = [
  "M 1040 682 C 1020 610 1160 600 1150 660 C 1142 700 1060 700 1072 650 C 1082 612 1200 618 1196 676",
  "M 1100 684 C 1080 630 1250 620 1240 670 C 1232 704 1120 700 1140 646",
  "M 1150 686 C 1150 640 1270 644 1262 680",
  "M 1060 686 C 1100 660 1180 690 1230 684",
];

function Cables() {
  // drawn against a shelf line at 690, then moved to wherever the shelf is
  const CABLE_Y0 = 690;
  return (
    <g transform={`translate(-40 ${SHELF_Y - CABLE_Y0})`}>
      {CABLE_LOOPS.map((d, i) => (
        <g key={i}>
          <path d={d} fill="none" stroke="#1d1729" strokeWidth={11} strokeLinecap="round" />
          <path d={d} fill="none" stroke="#3d3552" strokeWidth={4} strokeLinecap="round" transform="translate(-2 -3)" opacity={0.9} />
          <path d={d} fill="none" stroke={P.dustHi} strokeWidth={2} strokeLinecap="round" transform="translate(-1 -5)" opacity={0.35} />
        </g>
      ))}
      {/* the one that hangs over the edge, with its plug */}
      <path d={`M 1210 684 C 1236 ${CABLE_Y0 + 4} 1244 ${CABLE_Y0 + 40} 1236 ${CABLE_Y0 + 64}`} fill="none" stroke="#1d1729" strokeWidth={11} strokeLinecap="round" />
      <path d={`M 1210 684 C 1236 ${CABLE_Y0 + 4} 1244 ${CABLE_Y0 + 40} 1236 ${CABLE_Y0 + 64}`} fill="none" stroke="#3d3552" strokeWidth={4} strokeLinecap="round" transform="translate(-3 -1)" />
      <g transform={`translate(1236 ${CABLE_Y0 + 64})`}>
        <rect x={-14} y={0} width={28} height={36} rx={5} fill="#2a2338" stroke="#4a4162" strokeWidth={2} />
        <rect x={-8} y={36} width={4} height={14} fill="#8a8399" />
        <rect x={4} y={36} width={4} height={14} fill="#8a8399" />
      </g>
    </g>
  );
}

// ── The cobweb ──────────────────────────────────────────────────────────────
// Strung from the slumped book's corner to the bottle's neck: nobody has moved
// either of them in years. Drawn in scene coordinates for slide 1's placing.
function Cobweb() {
  const hub: Pt = [724, 482];
  const anchors: Pt[] = [
    [690, 556],
    [672, 546],
    [764, 418],
    [742, 498],
  ];
  return (
    <g fill="none" stroke={P.moon} strokeLinecap="round" opacity={0.62}>
      {anchors.map(([x, y], i) => (
        <line key={i} x1={hub[0]} y1={hub[1]} x2={x} y2={y} strokeWidth={1.5} />
      ))}
      {[0.35, 0.6, 0.85].map((f) => (
        <path
          key={f}
          d={anchors
            .map(([x, y], i) => `${i === 0 ? "M" : "Q"} ${i === 0 ? "" : `${hub[0] + (x - hub[0]) * f * 0.7 + 2} ${hub[1] + (y - hub[1]) * f * 0.7 + 3} `}${hub[0] + (x - hub[0]) * f} ${hub[1] + (y - hub[1]) * f}`)
            .join(" ")}
          strokeWidth={1.2}
        />
      ))}
      {/* a thread sagging under its own dust */}
      <path d="M 690 556 Q 716 572 742 498" strokeWidth={1} opacity={0.7} />
    </g>
  );
}

// ── The Genie Bottle ────────────────────────────────────────────────────────
// A tall decanter: a body that swells low and narrows to a long neck, and a
// tall pointed stopper. No brand, and its label faded past reading. Drawn
// about its base centre, the shelf line, standing about 490 tall.
const BOTTLE_BODY =
  "M -72 0 C -104 -2 -120 -44 -117 -98 C -113 -165 -62 -218 -27 -262 L -21 -332 L 21 -332 L 27 -262 C 62 -218 113 -165 117 -98 C 120 -44 104 -2 72 0 Q 0 9 -72 0 Z";
const STOPPER_SPIRE = "M -20 -382 C -32 -414 -10 -452 0 -492 C 10 -452 32 -414 20 -382 Q 0 -374 -20 -382 Z";

/** The faded label: a strip of old paper round the belly, its writing gone to smudges. */
function FadedLabel() {
  return (
    <g clipPath="url(#ag-bottleclip)">
      <path d="M -112 -126 Q 0 -112 112 -126 L 112 -58 Q 0 -44 -112 -58 Z" fill={P.parchment} opacity={0.42} />
      <path d="M -112 -126 Q 0 -112 112 -126 L 112 -58 Q 0 -44 -112 -58 Z" fill="none" stroke={P.parchmentEdge} strokeWidth={2} opacity={0.4} />
      {/* not words: the ghost of where words were */}
      <path d="M -62 -100 Q -30 -96 4 -99 T 58 -97" fill="none" stroke={P.goldShadow} strokeWidth={5} strokeLinecap="round" opacity={0.18} filter="url(#ag-hair)" />
      <path d="M -40 -80 Q -6 -77 34 -80" fill="none" stroke={P.goldShadow} strokeWidth={3} strokeLinecap="round" opacity={0.14} filter="url(#ag-hair)" />
      {/* a torn corner */}
      <path d="M 82 -60 L 112 -62 L 112 -84 Z" fill="#000" opacity={0.25} />
    </g>
  );
}

/** `clear`: the glass wiped clean, so the dark behind shows through it and the light inside reads as light, not as metal. */
function GenieBottle({ dusty = 1, light = 0.4, dustOff, clear = false }: { dusty?: number; light?: number; dustOff?: CSSProperties; clear?: boolean }) {
  const glassOpacity = clear ? 0.5 : 1;
  return (
    <g>
      {/* the shadow it stands in */}
      <ellipse cx={0} cy={4} rx={120} ry={14} fill={P.nightDeep} opacity={0.75} filter="url(#ag-soft)" />
      {/* the glass: clean amber under everything */}
      <path d={BOTTLE_BODY} fill="url(#ag-glass)" fillOpacity={glassOpacity} />
      {/* the light inside, pressing at the glass */}
      <g clipPath="url(#ag-bottleclip)">
        <ellipse cx={-6} cy={-118} rx={104} ry={112} fill="url(#ag-inner)" opacity={light} style={{ animation: "ag-sigh 4.6s ease-in-out infinite" }} />
        {/* a curl of smoke caught inside, the genie folded up small */}
        <path d="M -40 -40 C -70 -120 30 -140 10 -200 C -4 -240 30 -250 18 -290" fill="none" stroke={P.goldHot} strokeWidth={10} strokeLinecap="round" opacity={0.35 * light} filter="url(#ag-soft)" />
      </g>
      {/* facets: the decanter's moulded panels */}
      <g clipPath="url(#ag-bottleclip)" fill="none" strokeWidth={2}>
        <path d="M -60 -2 C -80 -80 -70 -170 -24 -262" stroke="#3a1f04" opacity={0.35} />
        <path d="M 60 -2 C 80 -80 70 -170 24 -262" stroke="#3a1f04" opacity={0.35} />
        <path d="M 0 6 L 0 -262" stroke="#ffd690" opacity={0.12} />
      </g>
      <FadedLabel />
      {/* the shine: a window of light on the left shoulder, and a hairline on the right from the moon */}
      {clear ? (
        <g fill="none" strokeLinecap="round">
          {/* clean glass: light along its rims, a soft window on the shoulder, a bright ring at the foot */}
          <path d={BOTTLE_BODY} stroke={P.goldHot} strokeWidth={3} opacity={0.6} />
          <path d="M -92 -70 C -100 -124 -80 -174 -46 -216" stroke="#fff" strokeWidth={5} opacity={0.4} filter="url(#ag-hair)" />
          <path d="M -60 4 Q 0 12 60 4" stroke="#fff" strokeWidth={3} opacity={0.55} />
          <path d="M -24 -256 L -19 -326" stroke="#fff" strokeWidth={2.5} opacity={0.6} />
          <path d="M 24 -256 L 19 -326" stroke={P.goldHot} strokeWidth={2} opacity={0.5} />
        </g>
      ) : (
        <>
          <path d="M -88 -60 C -98 -120 -76 -176 -40 -222" fill="none" stroke="#fff" strokeWidth={9} strokeLinecap="round" opacity={0.42 - dusty * 0.2} />
          <path d="M -74 -40 C -80 -60 -80 -76 -78 -88" fill="none" stroke="#fff" strokeWidth={5} strokeLinecap="round" opacity={0.3 - dusty * 0.15} />
        </>
      )}
      <path d="M 110 -70 C 112 -130 76 -190 30 -250" fill="none" stroke={P.moon} strokeWidth={2.5} opacity={0.55} />
      <path d="M -14 -300 L -14 -330" stroke="#fff" strokeWidth={4} strokeLinecap="round" opacity={0.4 - dusty * 0.2} />
      {/* the lip, the stopper's ball and its tall spire */}
      <rect x={-29} y={-348} width={58} height={18} rx={7} fill="url(#ag-glass)" fillOpacity={clear ? 0.7 : 1} stroke={clear ? P.goldHot : "none"} strokeWidth={2} strokeOpacity={0.6} />
      <ellipse cx={0} cy={-366} rx={24} ry={19} fill="url(#ag-glass)" fillOpacity={clear ? 0.6 : 1} stroke={clear ? P.goldHot : "none"} strokeWidth={2} strokeOpacity={0.5} />
      <path d={STOPPER_SPIRE} fill="url(#ag-glass)" fillOpacity={clear ? 0.55 : 1} stroke={clear ? P.goldHot : "none"} strokeWidth={2} strokeOpacity={0.5} />
      <path d="M -10 -392 C -16 -420 -8 -446 -2 -470" fill="none" stroke="#fff" strokeWidth={4} strokeLinecap="round" opacity={0.4 - dusty * 0.2} />
      <ellipse cx={-8} cy={-372} rx={7} ry={5} fill="#fff" opacity={0.35 - dusty * 0.15} />
      {/* the dust: a grey film, heaviest on the shoulders, and its grain */}
      <g style={dustOff} opacity={dustOff ? 1 : dusty}>
        <path d={BOTTLE_BODY} fill="url(#ag-glassdusty)" opacity={0.8} />
        <path d={BOTTLE_BODY} fill="url(#ag-dustfilm)" opacity={0.6} />
        <path d={BOTTLE_BODY} fill="#fff" filter="url(#ag-grain)" opacity={0.45} />
        {/* the stopper, the ball and the lip: no light comes through them under the dust */}
        {[<path key="s" d={STOPPER_SPIRE} />, <ellipse key="b" cx={0} cy={-366} rx={24} ry={19} />, <rect key="l" x={-29} y={-348} width={58} height={18} rx={7} />].map((shape) => (
          <g key={shape.key}>
            <g fill="url(#ag-glassdusty)" opacity={0.92}>{shape}</g>
            <g fill="url(#ag-dustfilm)" opacity={0.7}>{shape}</g>
            <g fill="#fff" filter="url(#ag-grain)" opacity={0.4}>{shape}</g>
          </g>
        ))}
        {/* a soft ridge of dust lying on each shoulder */}
        <path d="M -104 -150 C -84 -196 -52 -228 -30 -258" fill="none" stroke={P.dustHi} strokeWidth={8} strokeLinecap="round" opacity={0.55} filter="url(#ag-hair)" />
        <path d="M 104 -150 C 84 -196 52 -228 30 -258" fill="none" stroke={P.dustHi} strokeWidth={8} strokeLinecap="round" opacity={0.45} filter="url(#ag-hair)" />
        {/* the light inside still presses through the dust, a warm bloom low in the belly that rises and falls */}
        <g clipPath="url(#ag-bottleclip)">
          <ellipse cx={-6} cy={-118} rx={112} ry={118} fill="url(#ag-inner)" opacity={0.22} style={{ animation: "ag-sigh 4.6s ease-in-out infinite" }} />
        </g>
      </g>
    </g>
  );
}

// ── Wish Smoke ──────────────────────────────────────────────────────────────
// Thin curls that leave the bottle's neck, rise, widen and thin to nothing.
// Each wisp enters the shared cycle at its own point (a negative delay), so
// the curls never move in step.
const WISPS = [
  { d: "M 0 0 C -14 -30 16 -54 2 -86 C -8 -110 12 -128 4 -150", w: 7, dur: 5.4, delay: 0, wx: "-16px" },
  { d: "M 0 0 C 12 -26 -10 -52 8 -80 C 20 -100 4 -124 14 -146", w: 5, dur: 6.2, delay: -2.1, wx: "22px" },
  { d: "M 0 0 C -6 -22 14 -40 0 -66 C -10 -86 6 -104 -4 -122", w: 4, dur: 4.8, delay: -3.6, wx: "6px" },
];

function WishSmoke({ strength = 1 }: { strength?: number }) {
  return (
    <g opacity={strength}>
      {WISPS.map((w, i) => (
        <g key={i} style={{ "--wx": w.wx, animation: `ag-wisp ${w.dur}s ${ACT_I} ${w.delay}s infinite`, ...box("50% 100%") } as CSSProperties}>
          <path d={w.d} fill="none" stroke="url(#ag-smoke)" strokeWidth={w.w * 2.4} strokeLinecap="round" opacity={0.35} filter="url(#ag-soft)" />
          <path d={w.d} fill="none" stroke="url(#ag-smoke)" strokeWidth={w.w} strokeLinecap="round" />
        </g>
      ))}
    </g>
  );
}

/** The bottle's sigh: smoke slipping out at the lip, under the stopper: one curl leaning away, a fainter one behind it. */
function SmokeAtTheLip({ strength = 1 }: { strength?: number }) {
  return (
    <g>
      <g transform="translate(-24 -342) rotate(-30)">
        <WishSmoke strength={strength} />
      </g>
      <g transform="translate(20 -344) rotate(12)">
        <WishSmoke strength={strength * 0.2} />
      </g>
    </g>
  );
}

// ── The smoke trail ─────────────────────────────────────────────────────────
// The curl the genie rose in, left hanging in the air from the bottle's neck to
// his puffs: soft puffs along a cubic curve, growing as they go, so it reads as
// smoke and never as a pipe. Each puff appears in turn, neck first.
function bezier(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return [a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]];
}

function SmokeTrail({ curves, start, dur }: { curves: [Pt, Pt, Pt, Pt][]; start: number; dur: number }) {
  const per = 18;
  const step = dur / (curves.length * per);
  const puffs: { x: number; y: number; r: number; o: number; i: number }[] = [];
  const total = curves.length * per;
  curves.forEach((c, ci) => {
    for (let k = 0; k < per; k++) {
      const i = ci * per + k;
      const f = i / (total - 1);
      const [x, y] = bezier(c[0], c[1], c[2], c[3], k / per);
      // thin at the neck, widest in the curl, thinning to almost nothing before it reaches him
      const r = 8 + 30 * Math.sin(Math.PI * Math.min(1, f * 1.1)) + (i % 3) * 4;
      const o = (0.05 + 0.13 * Math.sin(Math.PI * f)) * (1 - 0.6 * f);
      puffs.push({ x, y, r, o, i });
    }
  });
  // two strands that weave about the curve: the smoke's own threads
  const strand = (w: number) =>
    curves
      .map((c, ci) => {
        const o = (k: number) => (k % 2 === 0 ? w : -w);
        const head = ci === 0 ? `M ${c[0][0]} ${c[0][1]} ` : "";
        return `${head}C ${c[1][0] + o(ci)} ${c[1][1] - o(ci)} ${c[2][0] - o(ci)} ${c[2][1] + o(ci)} ${c[3][0]} ${c[3][1]}`;
      })
      .join(" ");
  return (
    <g>
      <g filter="url(#ag-softer)">
        {puffs.map((p) => (
          <circle key={p.i} cx={p.x} cy={p.y} r={p.r} fill={P.goldHi} opacity={p.o} style={anim("ag-fadein", 0.5, start + p.i * step)} />
        ))}
      </g>
      <g filter="url(#ag-hair)" fill="none" strokeLinecap="round">
        <path d={strand(26)} pathLength={1} strokeDasharray="1 1" stroke={P.goldHot} strokeWidth={4} opacity={0.4} style={anim("ag-draw", dur, start, {}, "backwards", "linear")} />
        <path d={strand(-34)} pathLength={1} strokeDasharray="1 1" stroke={P.goldHi} strokeWidth={2.5} opacity={0.28} style={anim("ag-draw", dur * 1.1, start, {}, "backwards", "linear")} />
      </g>
    </g>
  );
}

// ── The Magic Carpet ────────────────────────────────────────────────────────
// A Persian medallion rug: a crimson field, a teal medallion at its centre
// with pendants at either end, corner pieces, a patterned border and fringe.
// Drawn flat (RUG_W × RUG_H), then laid into the scene in perspective by its
// caller. It has no face and no personality of its own.
const RUG_W = 640;
const RUG_H = 300;

function RugBorder() {
  // a run of small cream rosettes on a teal band, all the way round
  const rosettes: { x: number; y: number }[] = [];
  for (let x = 30; x <= RUG_W - 30; x += 30) {
    rosettes.push({ x, y: 18 }, { x, y: RUG_H - 18 });
  }
  for (let y = 48; y <= RUG_H - 48; y += 30) {
    rosettes.push({ x: 18, y }, { x: RUG_W - 18, y });
  }
  return (
    <g>
      <rect x={0} y={0} width={RUG_W} height={RUG_H} rx={6} fill={P.tealDeep} />
      <rect x={4} y={4} width={RUG_W - 8} height={RUG_H - 8} rx={4} fill="none" stroke={P.parchment} strokeWidth={3} />
      <rect x={8} y={8} width={RUG_W - 16} height={RUG_H - 16} rx={3} fill={P.teal} opacity={0.75} />
      {rosettes.map((r, i) => (
        <g key={i} transform={`translate(${r.x} ${r.y})`}>
          <path d="M 0 -8 L 8 0 L 0 8 L -8 0 Z" fill={P.parchmentHi} />
          <circle r={3} fill={P.crimson} />
        </g>
      ))}
      {/* the guard stripes inside the border */}
      <rect x={32} y={32} width={RUG_W - 64} height={RUG_H - 64} fill={P.parchment} />
      <rect x={36} y={36} width={RUG_W - 72} height={RUG_H - 72} fill={P.crimsonDeep} />
    </g>
  );
}

function RugField() {
  const cx = RUG_W / 2;
  const cy = RUG_H / 2;
  // the medallion: an eight-pointed lozenge, stepped like a woven shape
  const medallion = `M ${cx - 132} ${cy} L ${cx - 96} ${cy - 30} L ${cx - 70} ${cy - 66} L ${cx - 30} ${cy - 74} L ${cx} ${cy - 92} L ${cx + 30} ${cy - 74} L ${cx + 70} ${cy - 66} L ${cx + 96} ${cy - 30} L ${cx + 132} ${cy} L ${cx + 96} ${cy + 30} L ${cx + 70} ${cy + 66} L ${cx + 30} ${cy + 74} L ${cx} ${cy + 92} L ${cx - 30} ${cy + 74} L ${cx - 70} ${cy + 66} L ${cx - 96} ${cy + 30} Z`;
  const corner = (sx: number, sy: number) => {
    const x0 = sx < 0 ? 40 : RUG_W - 40;
    const y0 = sy < 0 ? 40 : RUG_H - 40;
    return `M ${x0} ${y0} L ${x0 - sx * 96} ${y0} Q ${x0 - sx * 70} ${y0 - sy * 40} ${x0} ${y0 - sy * 62} Z`;
  };
  return (
    <g>
      <rect x={40} y={40} width={RUG_W - 80} height={RUG_H - 80} fill="url(#ag-field)" />
      {/* a lattice of small flowers over the field */}
      {Array.from({ length: 11 }, (_, i) =>
        Array.from({ length: 4 }, (_, j) => (
          <circle key={`${i}-${j}`} cx={70 + i * 50} cy={70 + j * 54} r={3} fill={P.parchment} opacity={0.35} />
        )),
      )}
      {/* corner pieces: quarter medallions in teal */}
      {[
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ].map(([sx, sy], i) => (
        <g key={i}>
          <path d={corner(sx, sy)} fill={P.teal} />
          <path d={corner(sx, sy)} fill="none" stroke={P.parchment} strokeWidth={2} />
        </g>
      ))}
      {/* pendants at the medallion's two ends */}
      {[-1, 1].map((s) => (
        <g key={s} transform={`translate(${cx + s * 168} ${cy})`}>
          <path d="M -22 0 L 0 -18 L 22 0 L 0 18 Z" fill={P.teal} stroke={P.parchment} strokeWidth={2} />
          <circle r={5} fill={P.parchmentHi} />
          <line x1={-s * 22} y1={0} x2={-s * 36} y2={0} stroke={P.parchment} strokeWidth={3} />
        </g>
      ))}
      {/* the medallion, its cream outline, and the small crimson heart */}
      <path d={medallion} fill="url(#ag-medallion)" />
      <path d={medallion} fill="none" stroke={P.parchment} strokeWidth={3} />
      <path d={medallion} fill="none" stroke={P.parchment} strokeWidth={1.5} transform={`translate(${cx} ${cy}) scale(0.78) translate(${-cx} ${-cy})`} opacity={0.7} />
      <ellipse cx={cx} cy={cy} rx={44} ry={32} fill={P.crimson} stroke={P.parchmentHi} strokeWidth={2.5} />
      <path d={`M ${cx} ${cy - 22} L ${cx + 18} ${cy} L ${cx} ${cy + 22} L ${cx - 18} ${cy} Z`} fill={P.tealHi} />
      <circle cx={cx} cy={cy} r={5} fill={P.parchmentHi} />
    </g>
  );
}

function RugFringe() {
  const tassels = [];
  for (let y = 12; y <= RUG_H - 12; y += 11) {
    tassels.push(
      <line key={`l${y}`} x1={0} y1={y} x2={-20} y2={y + 2} stroke={P.parchment} strokeWidth={3} strokeLinecap="round" />,
      <line key={`r${y}`} x1={RUG_W} y1={y} x2={RUG_W + 20} y2={y + 2} stroke={P.parchment} strokeWidth={3} strokeLinecap="round" />,
    );
  }
  return <g opacity={0.9}>{tassels}</g>;
}

/**
 * The carpet laid flat into the scene, seen from a little above: the rug is
 * foreshortened to a third of its depth and leaned so its far edge sits left.
 * `unroll` delays its unrolling from the left end; omit it for a carpet at rest.
 */
function MagicCarpet({ unroll }: { unroll?: number }) {
  const unrolling = unroll != null;
  return (
    <g>
      {/* the carpet's shadow, thrown down onto the dark below it */}
      <ellipse cx={RUG_W / 2 - 40} cy={190} rx={330} ry={26} fill={P.nightDeep} opacity={0.6} filter="url(#ag-softer)" style={unrolling ? anim("ag-fadein", 0.9, unroll) : undefined} />
      <g transform="matrix(1 0 -0.32 0.34 0 0)">
        <g style={unrolling ? { animation: `ag-unroll 0.9s ${ACT_I} ${unroll}s backwards, ag-fadein 0.05s linear ${unroll}s backwards`, ...box("0% 50%") } : undefined}>
          {/* the pile's thickness: a dark front edge under the near side */}
          <rect x={-4} y={RUG_H - 4} width={RUG_W + 8} height={44} rx={8} fill={P.crimsonDeep} />
          <rect x={-4} y={RUG_H + 4} width={RUG_W + 8} height={6} fill={P.crimson} opacity={0.8} />
          {/* the knotted pile, seen end-on along the near edge */}
          {Array.from({ length: 64 }, (_, i) => (
            <line key={i} x1={4 + i * 10} y1={RUG_H + 12} x2={4 + i * 10} y2={RUG_H + 34} stroke="#3a0612" strokeWidth={3} opacity={0.6} />
          ))}
          <RugFringe />
          <RugBorder />
          <RugField />
          <rect x={0} y={0} width={RUG_W} height={RUG_H} rx={6} fill="#fff" filter="url(#ag-weave)" opacity={0.9} />
          <rect x={0} y={0} width={RUG_W} height={RUG_H} rx={6} fill="url(#ag-ripple)" />
        </g>
        {/* the rolled end, travelling right as the carpet opens, invisible at rest */}
        {unrolling && (
          <g style={{ opacity: 0, ...anim("ag-roll", 0.9, unroll, {}, "both"), ...box("0% 50%") }}>
            <rect x={-14} y={-12} width={44} height={RUG_H + 30} rx={22} fill="url(#ag-rollshade)" />
            <rect x={-14} y={-12} width={44} height={RUG_H + 30} rx={22} fill="none" stroke={P.parchment} strokeWidth={3} opacity={0.6} />
          </g>
        )}
      </g>
    </g>
  );
}

// ── The Genie ───────────────────────────────────────────────────────────────
// A bust: head and torso in one rounded body, big eyes under heavy lids, a
// knowing smile, and short arms with round mitts set on his hips. No legs:
// he floats on small puffs of wish smoke. The words on his body are the
// ones he is made of. Drawn about his body's centre; about 400 tall with puffs.
const GENIE_BODY = "M 0 -200 C 104 -200 168 -112 166 8 C 164 108 128 172 0 178 C -128 172 -164 108 -166 8 C -168 -112 -104 -200 0 -200 Z";

const BODY_WORDS = [
  { t: "aria-label", x: -104, y: 66, r: -6, s: 23 },
  { t: "alt", x: 52, y: 58, r: 7, s: 25 },
  { t: "role", x: -88, y: 112, r: -2, s: 24 },
  { t: "tabindex", x: -6, y: 120, r: 4, s: 21 },
];

// ── The genie's mist ────────────────────────────────────────────────────────
// What he floats on, after the fog in the Venus Flytrap Guardian deck: soft
// blurred layers at two depths, each drifting on its own slow loop (no two
// periods alike, so the motion never visibly repeats), breathing in opacity,
// lit warm from inside by his gold, thinning and curling at its edges. It
// billows out under him as he settles, and see-through throughout.
const MIST_FAR = [
  { x: -150, y: 236, rx: 120, ry: 34, dur: 11.3, d: -2, dx: 22, dy: -4, o: [0.24, 0.42] },
  { x: 60, y: 246, rx: 150, ry: 38, dur: 13.7, d: -6, dx: -26, dy: 3, o: [0.2, 0.38] },
  { x: 170, y: 226, rx: 96, ry: 30, dur: 9.1, d: -4, dx: 18, dy: -5, o: [0.18, 0.34] },
];
const MIST_NEAR = [
  { x: -96, y: 200, r: 50, dur: 6.3, d: -1.2, dx: -9, dy: -6 },
  { x: -42, y: 218, r: 58, dur: 7.9, d: -3.1, dx: 7, dy: -8 },
  { x: 14, y: 224, r: 62, dur: 5.7, d: -0.4, dx: -6, dy: 5 },
  { x: 68, y: 212, r: 54, dur: 8.7, d: -5.2, dx: 10, dy: -4 },
  { x: 112, y: 196, r: 44, dur: 6.9, d: -2.6, dx: 8, dy: 7 },
  { x: -18, y: 258, r: 44, dur: 9.7, d: -4.4, dx: -12, dy: 6 },
  { x: 44, y: 262, r: 40, dur: 7.3, d: -1.9, dx: 11, dy: 5 },
];
// curls at the mist's edges, each thinning as it drifts away
const MIST_CURLS = [
  { d: "M -130 222 C -164 226 -176 250 -200 252 C -214 253 -222 244 -218 236", w: 7, dur: 7.7, delay: -1 },
  { d: "M 134 214 C 166 220 178 244 204 246 C 218 247 226 238 222 230", w: 6, dur: 8.9, delay: -3.6 },
  { d: "M -10 284 C -22 304 4 318 -8 342 C -14 352 -6 360 2 358", w: 5, dur: 10.3, delay: -5.1 },
  { d: "M 70 270 C 88 290 76 304 96 318", w: 4, dur: 6.1, delay: -2.4 },
];

function Puffs({ settle }: { settle?: number }) {
  const billow = settle != null ? anim("ag-billow", 1.4, settle, {}, "backwards", ACT_I) : undefined;
  return (
    <g>
      {/* lit from inside: his gold, pooled in the mist under him */}
      <ellipse cx={0} cy={214} rx={150} ry={56} fill={P.goldHi} opacity={0.28} filter="url(#ag-softer)" style={{ "--o1": "0.2", "--o2": "0.36", animation: "ag-breathe 5.3s ease-in-out infinite" } as CSSProperties} />
      {/* far layer: wide, thin, slow; it spreads out under him as he settles */}
      <g style={{ ...billow, ...box("50% 0%") }}>
        {MIST_FAR.map((m, i) => (
          <g key={i} transform={`translate(${m.x} ${m.y})`}>
            <ellipse
              rx={m.rx}
              ry={m.ry}
              fill="url(#ag-mistlit)"
              filter="url(#ag-softer)"
              style={
                {
                  "--dx": `${m.dx}px`,
                  "--dy": `${m.dy}px`,
                  "--o1": `${m.o[0]}`,
                  "--o2": `${m.o[1]}`,
                  animation: `ag-mistdrift ${m.dur}s ease-in-out ${m.d}s infinite, ag-breathe ${m.dur * 0.7}s ease-in-out ${m.d}s infinite`,
                } as CSSProperties
              }
            />
          </g>
        ))}
      </g>
      {/* near layer: the billows he rests on, each eddying on its own loop */}
      <g style={{ ...billow, ...box("50% 0%") }}>
        {MIST_NEAR.map((m, i) => (
          <g key={i} transform={`translate(${m.x} ${m.y})`}>
            <g style={{ "--dx": `${m.dx}px`, "--dy": `${m.dy}px`, animation: `ag-mistdrift ${m.dur}s ease-in-out ${m.d}s infinite`, ...box("50% 50%") } as CSSProperties}>
              <circle r={m.r} fill="url(#ag-mist)" opacity={0.92} filter="url(#ag-soft)" />
              <circle cx={-m.r * 0.2} cy={-m.r * 0.3} r={m.r * 0.5} fill={P.goldHot} opacity={0.35} filter="url(#ag-soft)" />
            </g>
          </g>
        ))}
      </g>
      {/* the edges: curls drifting off and thinning to nothing */}
      <g fill="none" stroke="url(#ag-smoke)" strokeLinecap="round" filter="url(#ag-hair)">
        {MIST_CURLS.map((c, i) => (
          <path key={i} d={c.d} strokeWidth={c.w} style={{ "--o1": "0.15", "--o2": "0.6", animation: `ag-breathe ${c.dur}s ease-in-out ${c.delay}s infinite` } as CSSProperties} />
        ))}
      </g>
    </g>
  );
}

function Arm({ side }: { side: -1 | 1 }) {
  // shoulder out to the elbow, then back in to the hip: hands on hips, unimpressed
  const d = `M ${side * 132} 0 C ${side * 200} 14 ${side * 236} 58 ${side * 226} 96 C ${side * 216} 124 ${side * 184} 132 ${side * 152} 126`;
  return (
    <g>
      <path d={d} fill="none" stroke={P.goldShadow} strokeWidth={62} strokeLinecap="round" opacity={0.5} transform="translate(0 6)" />
      <path d={d} fill="none" stroke="url(#ag-arm)" strokeWidth={56} strokeLinecap="round" />
      <path d={`M ${side * 140} -10 C ${side * 196} 0 ${side * 228} 34 ${side * 232} 76`} fill="none" stroke={P.goldHot} strokeWidth={8} strokeLinecap="round" opacity={0.45} />
    </g>
  );
}

/** The hand's sweep, in seconds: up off the hip, then down with the rescan's band (Act IV's 400 to 800ms). */
const SWEEP = { up: 0.5, down: 0.8 };

function Mitt({ side }: { side: -1 | 1 }) {
  return (
    <g transform={`translate(${side * 150} 124)`}>
      <ellipse rx={38} ry={34} fill="url(#ag-mitt)" />
      <path d={`M ${-side * 6} -20 C ${-side * 22} -12 ${-side * 26} 8 ${-side * 18} 22`} fill="none" stroke={P.goldShadow} strokeWidth={3} opacity={0.45} />
    </g>
  );
}

function Eye({ x, wide = false, look = [0, 0] }: { x: number; wide?: boolean; look?: Pt }) {
  return (
    <g transform={`translate(${x} -78)`}>
      <ellipse rx={36} ry={44} fill="url(#ag-eye)" />
      <g transform={`translate(${look[0]} ${look[1]})`}>
      <g style={{ animation: "ag-blink 6.5s ease-in-out infinite", ...box("50% 50%") }}>
        <ellipse cx={4} cy={10} rx={17} ry={21} fill={P.night} />
        <ellipse cx={4} cy={10} rx={10} ry={12} fill={P.nightLift} opacity={0.6} />
        <circle cx={12} cy={-1} r={6.5} fill="#fff" />
        <circle cx={-3} cy={20} r={2.6} fill="#fff" opacity={0.8} />
      </g>
      </g>
      {/* the heavy lid: he has seen your markup before */}
      {!wide && <path d="M -40 -50 L 40 -50 L 40 -10 C 22 -2 -22 -2 -40 -10 Z" fill="url(#ag-arm)" clipPath="url(#ag-eyeclip)" />}
      {!wide && <path d="M -36 -10 C -18 -2 18 -2 36 -10" fill="none" stroke={P.goldShadow} strokeWidth={4} strokeLinecap="round" />}
      <ellipse rx={36} ry={44} fill="none" stroke={P.goldShadow} strokeWidth={3} opacity={0.6} />
    </g>
  );
}

/** A closed eye: the lid down, a curve of lashes; he is listening. */
function ClosedEye({ x }: { x: number }) {
  return (
    <g transform={`translate(${x} -78)`}>
      <ellipse rx={36} ry={44} fill="url(#ag-arm)" />
      <ellipse rx={36} ry={44} fill="none" stroke={P.goldShadow} strokeWidth={3} opacity={0.6} />
      <path d="M -30 6 C -14 22 14 22 30 6" fill="none" stroke={P.goldInk} strokeWidth={5} strokeLinecap="round" />
      {[-20, -6, 8, 22].map((lx) => (
        <line key={lx} x1={lx} y1={14 + Math.abs(lx) * -0.2} x2={lx * 1.15} y2={24} stroke={P.goldInk} strokeWidth={2.5} strokeLinecap="round" />
      ))}
    </g>
  );
}

/**
 * `look` turns his pupils toward something; `calm` closes his eyes and softens
 * his smile, for slide 5's listening. Neither changes the approved drawing by default.
 */
/**
 * `sweep` lifts his hand off his hip at that second and sweeps it back down
 * (slide 7's rescan); without it he is drawn exactly as before, hands on hips.
 */
function Genie({ wide = false, look, calm = false, settle, sweep }: { wide?: boolean; look?: Pt; calm?: boolean; settle?: number; sweep?: number }) {
  // the arm and its mitt are drawn apart (the body lies between them), so each turns about the same shoulder
  const sweeping: CSSProperties | undefined =
    sweep != null
      ? {
          animation: `ag-handup ${SWEEP.up}s ${ACT_IV} ${sweep}s, ag-handdown ${SWEEP.down}s ${ACT_IV} ${sweep + SWEEP.up}s`,
          transformBox: "view-box",
          transformOrigin: "132px 0px",
        }
      : undefined;
  return (
    <g>
      {/* his aura in the dark */}
      <ellipse cx={0} cy={10} rx={330} ry={300} fill="url(#ag-aura)" />
      <Puffs settle={settle} />
      <Arm side={-1} />
      {sweeping ? (
        <g style={sweeping}>
          <Arm side={1} />
        </g>
      ) : (
        <Arm side={1} />
      )}
      {/* the body: head and torso in one friendly boulder */}
      <path d={GENIE_BODY} fill="url(#ag-body)" />
      <path d={GENIE_BODY} fill="url(#ag-bodyrim)" />
      <path d={GENIE_BODY} fill="url(#ag-bodyfoot)" />
      <path d={GENIE_BODY} fill="none" stroke={P.goldShadow} strokeWidth={3} opacity={0.55} />
      {/* the crown of smokeless fire a jinn is made of: see-through smoke, its tip flickering */}
      <g transform="translate(0 -192)">
        <g style={{ animation: "ag-flicker 3.2s ease-in-out infinite", ...box("50% 100%") }}>
          <path d="M -30 8 C -44 -18 -14 -30 -18 -54 C 4 -40 26 -30 20 -4 C 30 -14 30 -30 24 -40 C 44 -20 38 4 22 12 Z" fill="url(#ag-mist)" />
          <path d="M -14 6 C -20 -12 -4 -22 -8 -40 C 6 -28 14 -18 8 4 Z" fill={P.goldHot} opacity={0.45} />
        </g>
        <g transform="translate(-4 -48)">
          <g style={{ animation: "ag-flicker 1.3s ease-in-out -0.4s infinite", ...box("50% 100%") }}>
            <path d="M -6 6 C -14 -10 2 -18 -2 -36 C 12 -22 14 -6 6 6 Z" fill="url(#ag-mist)" opacity={0.8} />
            <path d="M 2 -36 C 8 -46 4 -56 10 -64" fill="none" stroke="url(#ag-smoke)" strokeWidth={4} strokeLinecap="round" opacity={0.6} />
          </g>
        </g>
      </g>
      {/* brows: one raised, because of course you did */}
      <path d="M -82 -138 C -64 -160 -30 -162 -12 -146" fill="none" stroke={P.goldShadow} strokeWidth={11} strokeLinecap="round" />
      <path d="M 16 -134 C 34 -146 66 -146 84 -130" fill="none" stroke={P.goldShadow} strokeWidth={11} strokeLinecap="round" />
      <clipPath id="ag-eyeclip">
        <ellipse rx={36} ry={44} />
      </clipPath>
      {calm ? (
        <>
          <ClosedEye x={-44} />
          <ClosedEye x={46} />
        </>
      ) : (
        <>
          <Eye x={-44} wide={wide} look={look} />
          <Eye x={46} wide={wide} look={look} />
        </>
      )}
      {/* cheeks, warm where the light comes from */}
      <ellipse cx={-98} cy={-6} rx={22} ry={13} fill={P.crimsonHi} opacity={0.22} />
      <ellipse cx={100} cy={-6} rx={22} ry={13} fill={P.crimsonHi} opacity={0.16} />
      {calm ? (
        /* the calm smile: closed, even, at peace with the dark */
        <path d="M -40 -2 C -20 16 22 16 42 -4" fill="none" stroke={P.goldInk} strokeWidth={6} strokeLinecap="round" />
      ) : (
        <>
          {/* the smile: wide, a touch lopsided, sure of itself */}
          <path d="M -54 -8 C -30 8 28 4 60 -26 C 50 14 6 30 -24 22 C -40 18 -50 8 -54 -8 Z" fill={P.goldInk} />
          <path d="M -26 14 C -10 24 18 22 34 8 C 22 22 -8 28 -26 14 Z" fill={P.crimson} />
          <path d="M -54 -8 C -30 8 28 4 60 -26" fill="none" stroke={P.goldInk} strokeWidth={5} strokeLinecap="round" />
          {/* the dimple on the lifted side, apart from the mouth */}
          <path d="M 80 -30 C 84 -24 84 -16 80 -10" fill="none" stroke={P.goldShadow} strokeWidth={4} strokeLinecap="round" opacity={0.75} />
        </>
      )}
      {/* the words he is made of, written on his body */}
      <g fontFamily={MONO} fontWeight={700} fill={P.goldInk}>
        {BODY_WORDS.map((w) => (
          <text key={w.t} x={w.x} y={w.y} fontSize={w.s} transform={`rotate(${w.r} ${w.x} ${w.y})`}>
            {w.t}
          </text>
        ))}
      </g>
      <Mitt side={-1} />
      {sweeping ? (
        <g style={sweeping}>
          <Mitt side={1} />
        </g>
      ) : (
        <Mitt side={1} />
      )}
    </g>
  );
}

// ── The feather duster ──────────────────────────────────────────────────────
// Only the duster is seen, floating with no hand: a full plume of dark ostrich
// feathers on a turned wooden handle, a black band where they meet, and a few
// sparks of wish smoke caught in the feathers. Drawn like the Zen Garden's
// rake: one tool, lit from one side (the bottle's glow), with its own shadow.
// Its origin is the band; the handle rises up and to the right, the plume
// hangs down and to the left.
const DUSTER_TILT = 58; // the handle's angle off upright: the plume sweeps sideways across the glass
const HANDLE_DIR: Pt = [Math.sin((DUSTER_TILT * Math.PI) / 180), -Math.cos((DUSTER_TILT * Math.PI) / 180)];
const FEATHERS = Array.from({ length: 27 }, (_, i) => {
  const f = i / 26; // 0 at one side of the fan, 1 at the other
  const spread = (f - 0.5) * 80; // degrees either side of the plume's axis
  const len = 150 + 70 * Math.cos((f - 0.5) * Math.PI) + ((i * 37) % 23);
  const w = 26 + ((i * 13) % 9);
  // the near side faces the bottle, so its feathers catch the warm light
  return { spread, len, w, rim: f > 0.62, back: i % 2 === 1 };
});

function Feather({ spread, len, w, rim }: { spread: number; len: number; w: number; rim: boolean }) {
  // a feather drawn pointing straight down from the band, then turned into the fan
  const d = `M -3 0 C ${-w} ${len * 0.25} ${-w * 1.1} ${len * 0.7} ${-w * 0.2} ${len} C ${w * 0.2} ${len * 0.92} ${w * 1.1} ${len * 0.7} ${w * 0.9} ${len * 0.3} C ${w * 0.7} ${len * 0.12} 4 ${len * 0.04} 3 0 Z`;
  return (
    <g transform={`rotate(${spread})`}>
      <path d={d} fill="url(#ag-feather)" />
      {/* the quill, faint down the middle */}
      <path d={`M 0 2 Q ${w * 0.1} ${len * 0.5} 0 ${len * 0.85}`} fill="none" stroke="#5a4a4e" strokeWidth={1.5} opacity={0.6} />
      {/* rim light on the edge that faces the bottle */}
      {rim && <path d={`M ${-w * 0.6} ${len * 0.3} C ${-w * 1.05} ${len * 0.55} ${-w * 0.8} ${len * 0.85} ${-w * 0.2} ${len}`} fill="none" stroke={P.goldHi} strokeWidth={7} opacity={0.55} filter="url(#ag-soft)" />}
    </g>
  );
}

const DUSTER_SPARKS = [
  { x: -30, y: 70, r: 3.4, d: 0 },
  { x: 22, y: 104, r: 2.6, d: -0.6 },
  { x: -58, y: 120, r: 2.2, d: -1.1 },
  { x: 8, y: 150, r: 3, d: -0.3 },
  { x: -14, y: 40, r: 2, d: -0.9 },
];

function FeatherDuster() {
  const [hx, hy] = HANDLE_DIR;
  const HL = 230; // handle length
  // the turned profile: beads and coves along the handle
  const rings = [0.18, 0.24, 0.62, 0.9];
  // the plume hangs opposite the handle: turn the downward-drawn feathers to point that way
  const plumeAngle = DUSTER_TILT;
  return (
    <g>
      {/* its own shadow, thrown down and away from the bottle's light */}
      <g transform="translate(26 30)" opacity={0.35} filter="url(#ag-softer)">
        <line x1={0} y1={0} x2={hx * HL} y2={hy * HL} stroke={P.nightDeep} strokeWidth={14} strokeLinecap="round" />
        <ellipse cx={0} cy={110} rx={55} ry={105} fill={P.nightDeep} transform={`rotate(${plumeAngle})`} />
      </g>
      {/* the handle */}
      <g transform={`rotate(${plumeAngle})`}>
        <rect x={-8} y={-HL} width={16} height={HL} rx={8} fill="url(#ag-handle)" />
        <rect x={-5} y={-HL + 6} width={3} height={HL - 14} rx={1.5} fill="#f6dcae" opacity={0.5} />
        {rings.map((r) => (
          <g key={r}>
            <ellipse cx={0} cy={-HL * r} rx={10.5} ry={4} fill="url(#ag-handle)" />
            <ellipse cx={-3} cy={-HL * r - 1} rx={4} ry={1.4} fill="#fbe6bf" opacity={0.55} />
          </g>
        ))}
        {/* the knob at the end, and the leather loop it hangs by */}
        <circle cx={0} cy={-HL - 4} r={11} fill="url(#ag-handle)" />
        <circle cx={-4} cy={-HL - 8} r={3.5} fill="#fbe6bf" opacity={0.6} />
        <path d={`M -4 ${-HL - 12} C -24 ${-HL - 44} 22 ${-HL - 50} 4 ${-HL - 12}`} fill="none" stroke="#2a1a10" strokeWidth={3} />
        {/* the black band, where the feathers are bound to the wood */}
        <rect x={-13} y={-30} width={26} height={36} rx={6} fill="url(#ag-band)" />
        <rect x={-9} y={-27} width={4} height={30} rx={2} fill="#8a8494" opacity={0.6} />
      </g>
      {/* the plume: the back feathers first, then the front; it flexes on each stroke */}
      <g transform={`rotate(${plumeAngle})`}>
        <g style={{ animation: `ag-flex 0.62s ease-in-out ${T2.wipe}s 3`, transformBox: "view-box", transformOrigin: "0px 0px" }}>
          {/* the plume's body: a soft dark teardrop the feathers fray out from */}
          <ellipse cx={0} cy={110} rx={78} ry={108} fill="#2a2226" opacity={0.85} filter="url(#ag-soft)" />
          <g filter="url(#ag-fluff)">
            {FEATHERS.filter((f) => f.back).map((f, i) => (
              <g key={`b${i}`} opacity={0.8}>
                <Feather spread={f.spread * 1.08} len={f.len * 0.94} w={f.w} rim={false} />
              </g>
            ))}
            {FEATHERS.filter((f) => !f.back).map((f, i) => (
              <Feather key={`f${i}`} spread={f.spread} len={f.len} w={f.w} rim={f.rim} />
            ))}
          </g>
          {/* sparks of wish smoke caught in the feathers */}
          {DUSTER_SPARKS.map((k, i) => (
            <g key={i} transform={`translate(${k.x} ${k.y})`}>
              <circle r={k.r * 3.2} fill={P.goldHi} opacity={0.22} filter="url(#ag-soft)" />
              <circle r={k.r} fill={P.goldHot} style={{ animation: `ag-twinkle 1.4s ease-in-out ${k.d}s infinite` }} />
            </g>
          ))}
        </g>
      </g>
    </g>
  );
}

/** Dust knocked off the glass at the end of each stroke, invisible at rest. */
const DUST_PUFFS = [
  { x: 150, y: 0, t: 0.5, px: "50px", py: "-30px" },
  { x: -150, y: -70, t: 0.86, px: "-50px", py: "-40px" },
  { x: 130, y: -120, t: 1.22, px: "46px", py: "-50px" },
  { x: -60, y: -210, t: 1.56, px: "-30px", py: "-60px" },
];

function KnockedDust() {
  return (
    <g>
      {DUST_PUFFS.map((d, i) => (
        <g key={i} transform={`translate(${d.x} ${d.y})`}>
          <g style={{ "--px": d.px, "--py": d.py, opacity: 0, ...anim("ag-dustpuff", 1.1, T2.wipe + d.t, {}, "both", "ease-out"), ...box("50% 50%") } as CSSProperties}>
            <circle r={34} fill={P.dust} filter="url(#ag-softer)" />
            <circle cx={14} cy={-8} r={18} fill={P.dustHi} opacity={0.6} filter="url(#ag-soft)" />
          </g>
        </g>
      ))}
    </g>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Slide 1 — The Bottle on the Shelf
// The bottle stands centre on a dusty shelf, the one warm thing in a night
// room: old books slumped at its left, a tangle of cables at its right, the
// moon's shaft falling across it, and a thin curl of wish smoke leaving its
// neck as something inside it sighs.
// ═════════════════════════════════════════════════════════════════════════════
function BottleOnTheShelfStage() {
  const BX = 790;
  return (
    <Stage>
      <Scene>
        <NightWall />
        {/* the faint warmth the bottle throws on the wall behind it */}
        <ellipse cx={BX} cy={SHELF_Y - 210} rx={300} ry={280} fill="url(#ag-spillglow)" opacity={0.35} style={{ animation: "ag-sigh 4.6s ease-in-out infinite" }} />
        <Shelf glowX={BX} glow={0.35} />
        <g transform="translate(50 0)">
          <Books />
        </g>
        <Cables />
        <Cobweb />
        <g transform={`translate(${BX} ${SHELF_Y - 2}) scale(1.12)`}>
          <GenieBottle dusty={1} light={0.55} />
          {/* the sigh: smoke slipping out beneath the stopper */}
          <SmokeAtTheLip strength={0.7} />
        </g>
      </Scene>
    </Stage>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Slide 2 — Three Wishes
// The camera moves right along the same shelf. A feather duster sweeps the dust from
// the bottle, lamp-gold light spills out of the clean glass, and the genie
// rises out of its neck in a curl of wish smoke onto a carpet that unrolls
// beneath him, where he settles, upright and in balance, and floats.
// ═════════════════════════════════════════════════════════════════════════════
// When each beat lands, in seconds after the slide arrives.
const T2 = { wipe: 0.4, spill: 2.3, unroll: 2.9, rise: 3.2, riseDur: 0.9, float: 4.3 };

// Where things stand: the bottle (its left edge at x≈472, well inside the crop) and the genie.
const S2 = { BX: 560, BS: 0.75, GX: 1000, GY: 360, GS: 0.9 } as const;
/** The point on the genie that rides the curl: the middle of his puffs, in his own coordinates. */
const PUFF_Y = 230;

// The curl of wish smoke the genie rises along, from the neck to where his puffs settle.
const TRAIL: [Pt, Pt, Pt, Pt][] = [
  [
    [S2.BX, SHELF_Y - 262],
    [S2.BX - 50, SHELF_Y - 420],
    [S2.BX + 50, SHELF_Y - 540],
    [S2.BX + 170, SHELF_Y - 470],
  ],
  [
    [S2.BX + 170, SHELF_Y - 470],
    [S2.BX + 300, SHELF_Y - 420],
    [S2.GX - 160, S2.GY + S2.GS * (PUFF_Y + 40)],
    [S2.GX, S2.GY + S2.GS * PUFF_Y],
  ],
];

function trailAt(f: number): Pt {
  const n = TRAIL.length;
  const ci = Math.min(n - 1, Math.floor(f * n));
  const c = TRAIL[ci];
  return bezier(c[0], c[1], c[2], c[3], f * n - ci);
}

// The rise, as keyframes along the curl: at each step his puffs sit on the trail's leading end,
// and he grows from a wisp at the neck to his full size.
const RISE_KEYFRAMES = (() => {
  const steps = 12;
  const frames: string[] = [];
  for (let k = 0; k <= steps; k++) {
    const f = k / steps;
    const [px, py] = trailAt(f);
    const tx = (px - S2.GX) / S2.GS;
    const ty = (py - S2.GY) / S2.GS - PUFF_Y;
    const sc = 0.08 + 0.92 * Math.pow(f, 1.6);
    const op = Math.min(1, f * 6);
    frames.push(`${(f * 100).toFixed(1)}% { transform: translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px) scale(${sc.toFixed(3)}); opacity: ${op.toFixed(2)}; }`);
  }
  return `@keyframes ag-rise { ${frames.join(" ")} }`;
})();

function ThreeWishesStage() {
  const { BX, BS, GX, GY, GS } = S2;
  // on a phone the band is narrower than the shelf: the camera steps back so the bottle and the carpet's fringe stay whole
  const compact = useCompactLayout();
  return (
    <Stage>
      <Scene>
        <NightWall motes={false} />
        <g transform={compact ? "translate(800 470) scale(0.8) translate(-800 -470)" : undefined}>
        {/* lamp-gold light spilling out over the wall once the glass is clean */}
        <g transform={`translate(${BX} ${SHELF_Y - 180})`}>
          <ellipse cx={0} cy={0} rx={520} ry={440} fill="url(#ag-spillglow)" style={{ ...anim("ag-spill", 1.0, T2.spill), ...box("50% 50%") }} />
        </g>
        <Shelf glowX={BX} glow={0.9} />
        {/* the curl of wish smoke he rose in, from the neck to his puffs */}
        <style>{RISE_KEYFRAMES}</style>
        <SmokeTrail start={T2.rise} curves={TRAIL} dur={T2.riseDur} />
        {/* the genie and his carpet, floating together once he has settled */}
        <g style={{ animation: `ag-float 3.6s ease-in-out ${T2.float}s infinite` }}>
          <g transform={`translate(${GX - 230} ${GY + 218}) scale(0.8)`}>
            <MagicCarpet unroll={T2.unroll} />
          </g>
          <g transform={`translate(${GX} ${GY}) scale(${GS})`}>
            <g style={{ ...anim("ag-rise", T2.riseDur, T2.rise, {}, "backwards", "linear"), transformBox: "view-box", transformOrigin: `0px ${PUFF_Y}px` }}>
              <Genie settle={T2.rise + T2.riseDur - 0.1} />
            </g>
          </g>
        </g>
        {/* the bottle stands nearest the camera, in front of the carpet's far corner */}
        <g transform={`translate(${BX} ${SHELF_Y - 2}) scale(${BS})`}>
          <GenieBottle dusty={0} light={1} clear dustOff={anim("ag-dustoff", 2.0, T2.wipe, { opacity: 0 })} />
          <SmokeAtTheLip strength={1} />
          <g transform="translate(0 -110)">
            <KnockedDust />
          </g>
          {/* the feather duster, seen only while it works: invisible at rest */}
          <g transform="translate(-20 -150)">
            <g style={{ opacity: 0, ...anim("ag-dust", 2.0, T2.wipe, {}, "both"), transformBox: "view-box", transformOrigin: "0px 0px" }}>
              <g transform="scale(1.05)">
                <FeatherDuster />
              </g>
            </g>
          </g>
        </g>
        </g>
      </Scene>
    </Stage>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Slice 2 — the wishes: The Page, Bug Knots, Landmark Lanterns, the Focus Ring
// ═════════════════════════════════════════════════════════════════════════════

// ── The Page ────────────────────────────────────────────────────────────────
// A web page of yours, drawn as a lit screen floating in the dark: no real
// product's interface, just the parts every page has. Drawn in its own box,
// PAGE_W × PAGE_H, origin top left; each slide places it. The regions are what
// the lanterns name, and the controls are what the Focus Ring visits.
const PAGE_W = 500;
const PAGE_H = 600;

type Box = { x: number; y: number; w: number; h: number };
const REGIONS: Record<"header" | "nav" | "main" | "footer", Box> = {
  header: { x: 10, y: 66, w: 480, h: 52 },
  nav: { x: 10, y: 124, w: 480, h: 36 },
  main: { x: 10, y: 166, w: 480, h: 354 },
  footer: { x: 10, y: 528, w: 480, h: 62 },
};
const CTRL = {
  skip: { x: 16, y: 36, w: 200, h: 26 },
  nav: [0, 1, 2, 3].map((i) => ({ x: 22 + i * 92, y: 131, w: 76, h: 22 })),
  heading: { x: 24, y: 180, w: 270, h: 26 },
  image: { x: 24, y: 300, w: 170, h: 120 },
  save: { x: 230, y: 330, w: 130, h: 46 },
  icon: { x: 384, y: 330, w: 46, h: 46 },
  dialog: { x: 64, y: 206, w: 372, h: 230 },
  dlgOk: { x: 246, y: 382, w: 76, h: 36 },
  dlgCancel: { x: 334, y: 382, w: 88, h: 36 },
};

/** The screen itself: bezel, glow, browser chrome and the page's quiet lines. */
function PageScreen({ dim = false }: { dim?: boolean }) {
  return (
    <g>
      {/* the screen's light thrown into the dark around it */}
      <rect x={-60} y={-60} width={PAGE_W + 120} height={PAGE_H + 120} rx={60} fill={P.screenEdge} opacity={dim ? 0.12 : 0.22} filter="url(#ag-softer)" />
      <rect x={-8} y={-8} width={PAGE_W + 16} height={PAGE_H + 16} rx={18} fill="#0c0918" />
      <rect x={0} y={0} width={PAGE_W} height={PAGE_H} rx={12} fill="url(#ag-screen)" />
      {/* the glass: one soft reflection across the top left */}
      <path d={`M 0 12 Q 0 0 12 0 L 220 0 L 0 260 Z`} fill="#fff" opacity={0.05} />
      {/* browser chrome: three dots and an address bar, no product's */}
      <rect x={0} y={0} width={PAGE_W} height={28} rx={12} fill={P.screenDeep} />
      {[16, 32, 48].map((cx) => (
        <circle key={cx} cx={cx} cy={14} r={4.5} fill={P.screenEdge} />
      ))}
      <rect x={70} y={8} width={300} height={12} rx={6} fill={P.screen} />
      {/* header: a mark and a title bar */}
      <circle cx={42} cy={92} r={16} fill={P.screenEdge} />
      <rect x={68} y={84} width={150} height={16} rx={8} fill={P.screenLine} opacity={0.55} />
      <rect x={380} y={84} width={96} height={16} rx={8} fill={P.screenLine} opacity={0.25} />
      {/* nav: four links */}
      {CTRL.nav.map((b, i) => (
        <rect key={i} x={b.x + 6} y={b.y + 7} width={b.w - 12} height={8} rx={4} fill={P.screenLine} opacity={0.6} />
      ))}
      {/* main: a heading, a paragraph, an image */}
      <rect x={CTRL.heading.x} y={CTRL.heading.y + 4} width={CTRL.heading.w} height={18} rx={9} fill={P.screenLine} opacity={0.85} />
      {[0, 1, 2, 3].map((i) => (
        <rect key={i} x={24} y={224 + i * 18} width={[440, 410, 430, 300][i]} height={8} rx={4} fill={P.screenLine} opacity={0.35} />
      ))}
      <rect x={CTRL.image.x} y={CTRL.image.y} width={CTRL.image.w} height={CTRL.image.h} rx={8} fill={P.screenDeep} />
      <path d={`M ${CTRL.image.x + 14} ${CTRL.image.y + 104} L ${CTRL.image.x + 62} ${CTRL.image.y + 50} L ${CTRL.image.x + 96} ${CTRL.image.y + 84} L ${CTRL.image.x + 118} ${CTRL.image.y + 64} L ${CTRL.image.x + 156} ${CTRL.image.y + 104} Z`} fill={P.screenEdge} opacity={0.8} />
      <circle cx={CTRL.image.x + 130} cy={CTRL.image.y + 30} r={11} fill={P.screenLine} opacity={0.5} />
      {[0, 1, 2].map((i) => (
        <rect key={i} x={24} y={444 + i * 18} width={[430, 380, 250][i]} height={8} rx={4} fill={P.screenLine} opacity={0.35} />
      ))}
      {/* footer */}
      <rect x={10} y={528} width={480} height={62} rx={8} fill={P.screenDeep} opacity={0.7} />
      {[0, 1, 2].map((i) => (
        <rect key={i} x={24 + i * 120} y={554} width={90} height={8} rx={4} fill={P.screenLine} opacity={0.3} />
      ))}
      {dim && <rect x={0} y={0} width={PAGE_W} height={PAGE_H} rx={12} fill={P.night} opacity={0.35} />}
    </g>
  );
}

/** A control on the page: its label is the one word the control would wear. */
function PageButton({ b, label, gold = false }: { b: Box; label: string; gold?: boolean }) {
  return (
    <g>
      <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={b.h / 2} fill={gold ? "url(#ag-goldbtn)" : P.screenEdge} />
      <rect x={b.x + 4} y={b.y + 3} width={b.w - 8} height={b.h * 0.35} rx={b.h * 0.2} fill="#fff" opacity={0.18} />
      <text x={b.x + b.w / 2} y={b.y + b.h / 2 + 7} textAnchor="middle" fontFamily={MONO} fontWeight={700} fontSize={20} fill={gold ? P.goldInk : "#ffffff"}>
        {label}
      </text>
    </g>
  );
}

/** The div pretending to be a button: a word in a box, no role, no focus, no keyboard. */
function DivPretending({ b }: { b: Box }) {
  return (
    <g>
      <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={4} fill={P.screenDeep} stroke={P.screenLine} strokeWidth={1.5} strokeDasharray="5 5" strokeOpacity={0.6} />
      <text x={b.x + b.w / 2} y={b.y + b.h / 2 + 7} textAnchor="middle" fontFamily={MONO} fontSize={20} fill="#e8e2f8">
        Save
      </text>
    </g>
  );
}

/** A code tag on the page, the way a developer's tools would label the element. */
function Tag({ x, y, text, color, scale = 1 }: { x: number; y: number; text: string; color: string; scale?: number }) {
  return (
    <g>
      <rect x={x - 8} y={y - 18 * scale} width={text.length * 10.3 * scale + 16} height={26 * scale} rx={6} fill="#120e26" stroke={color} strokeWidth={1.5} strokeOpacity={0.7} />
      <text x={x} y={y} fontFamily={MONO} fontWeight={700} fontSize={17 * scale} fill={color}>
      {text}
    </text>
    </g>
  );
}

// ── Landmark Lantern ────────────────────────────────────────────────────────
// A pierced lantern with teal glass, hung at the page's edge beside a region.
// Lit, its glass glows lantern-teal and the region it names is outlined;
// its label is the landmark's element, as the code says it.
function LandmarkLantern({
  region,
  delay,
  still = false,
  label = true,
  nudge = 0,
  labelScale = 1,
}: {
  region: keyof typeof REGIONS;
  delay?: number;
  still?: boolean;
  label?: boolean;
  /** moves the lantern up or down its edge, where two regions sit close */
  nudge?: number;
  /** the legend's size, raised on the phone so it stays readable there */
  labelScale?: number;
}) {
  const r = REGIONS[region];
  const cy = r.y + r.h / 2 + nudge;
  const lightStyle = delay != null && !still ? anim("ag-light", 0.3, delay, {}, "backwards", ACT_II) : undefined;
  return (
    <g>
      {/* the region it names, outlined in teal once lit */}
      <rect x={r.x} y={r.y} width={r.w} height={r.h} rx={8} fill="none" stroke={P.teal} strokeWidth={2} strokeDasharray="8 6" opacity={0.85} style={lightStyle} />
      <g transform={`translate(-30 ${cy}) scale(0.78)`}>
        {/* the chain it hangs by */}
        <line x1={0} y1={-44} x2={0} y2={-26} stroke={P.tealDeep} strokeWidth={2} />
        {/* its glow in the dark, then its body: cap, pierced glass, base and finial */}
        <circle r={34} fill={P.teal} opacity={0.35} filter="url(#ag-soft)" style={lightStyle} />
        <path d="M -12 -18 Q 0 -30 12 -18 Z" fill="#7a6a3a" />
        <path d="M -13 -18 L 13 -18 L 11 14 L -11 14 Z" fill={P.tealDeep} />
        <path d="M -13 -18 L 13 -18 L 11 14 L -11 14 Z" fill="url(#ag-lanternglass)" style={lightStyle} />
        {/* the piercings: small stars of light */}
        {[-8, 0, 8].map((dy) => (
          <g key={dy} style={lightStyle}>
            <circle cx={-5} cy={dy} r={1.8} fill={P.tealHi} />
            <circle cx={5} cy={dy + 4} r={1.8} fill={P.tealHi} />
          </g>
        ))}
        <rect x={-14} y={13} width={28} height={6} rx={2} fill="#7a6a3a" />
        <path d="M -4 19 L 4 19 L 0 28 Z" fill="#7a6a3a" />
      </g>
      {/* its name, a legend on the region's border, the way a browser's tools label a landmark */}
      {label && (
        <g style={lightStyle}>
          <rect x={r.x + r.w - 16 - (region.length + 2) * 10.3 * labelScale - 12} y={r.y - 11 * labelScale} width={(region.length + 2) * 10.3 * labelScale + 12} height={22 * labelScale} rx={5} fill={P.screenDeep} stroke={P.teal} strokeWidth={1.5} />
          <text x={r.x + r.w - 22} y={r.y + 5 * labelScale} textAnchor="end" fontFamily={MONO} fontWeight={700} fontSize={16 * labelScale} fill={P.tealHi}>
            {`<${region}>`}
          </text>
        </g>
      )}
    </g>
  );
}

// ── Bug Knot ────────────────────────────────────────────────────────────────
// An accessibility bug where forces meet and block the way: a knot of
// bug-ink cord tied round an element. It snaps tight and trembles until it is
// named, then lets go. Drawn round a box; `tie` and `untie` time it, and
// `held` keeps it tight and still (Act III).
function BugKnot({ b, tie, untie, held = false }: { b: Box; tie?: number; untie?: number; held?: boolean }) {
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const rx = b.w / 2 + 16;
  const ry = b.h / 2 + 14;
  // a loop round the element, crossed over itself twice, with two loose ends
  const d = `M ${-rx - 26} ${-ry * 0.2} C ${-rx} ${-ry * 1.4} ${rx * 0.4} ${-ry * 1.3} ${rx} ${-ry * 0.5} C ${rx * 1.3} ${ry * 0.2} ${rx * 0.6} ${ry * 1.2} ${-rx * 0.2} ${ry} C ${-rx * 1.1} ${ry * 0.9} ${-rx * 1.2} ${-ry * 0.4} ${-rx * 0.3} ${-ry * 0.9} C ${rx * 0.4} ${-ry * 1.2} ${rx * 1.25} ${-ry * 0.2} ${rx * 0.9} ${ry * 0.6} C ${rx * 0.7} ${ry * 1.1} ${rx * 1.1} ${ry * 1.5} ${rx + 30} ${ry * 1.3}`;
  const tieStyle: CSSProperties = tie != null ? anim("ag-knot", 0.4, tie, {}, "backwards", ACT_II) : {};
  const untieStyle: CSSProperties = untie != null ? { ...anim("ag-untie", 0.6, untie, {}, "both", ACT_II) } : {};
  const trembleUntil = untie;
  return (
    <g transform={`translate(${cx} ${cy})`}>
      <g style={{ ...untieStyle, transformBox: "view-box", transformOrigin: "0px 0px" }}>
        <g style={{ ...tieStyle, transformBox: "view-box", transformOrigin: "0px 0px" }}>
          <g
            style={
              held || tie == null
                ? undefined
                : { animation: `ag-tremble 0.12s linear ${tie + 0.4}s ${trembleUntil != null ? Math.max(1, Math.round((trembleUntil - tie - 0.4) / 0.12)) : "infinite"}` }
            }
          >
            {/* the glow of the pressure it holds */}
            <ellipse rx={rx + 10} ry={ry + 8} fill={P.bugInk} opacity={0.16} filter="url(#ag-soft)" />
            <path d={d} fill="none" stroke={P.bugInkDeep} strokeWidth={12} strokeLinecap="round" />
            <path d={d} fill="none" stroke={P.bugInk} strokeWidth={7} strokeLinecap="round" />
            <path d={d} fill="none" stroke="#ffd1e6" strokeWidth={1.8} strokeLinecap="round" opacity={0.7} transform="translate(-1 -2)" />
          </g>
        </g>
      </g>
    </g>
  );
}

// ── Focus Ring ──────────────────────────────────────────────────────────────
// Visible keyboard focus: a clear ring that glides from one control to the
// next and rests there. Two rings, lamp-gold over night, so it shows on any
// ground: the same trick a good focus style uses. It is moved by a keyframe
// list of the boxes it visits.
const RING_PAD = 6;
/** The ring's two outlines: gold at `RING_PAD` out from the control, a thin dark one just outside it. */
const RING_OUTER = 3;
function ringRect(b: Box, extra = 0) {
  const pad = RING_PAD + extra;
  return { x: b.x - pad, y: b.y - pad, width: b.w + pad * 2, height: b.h + pad * 2 };
}

/**
 * One keyframe block for a ring's journey, for each of its two outlines: each
 * stop is a box, a time (0–1), and how it gets there. `dx` nudges a stop
 * sideways, for a press that shakes.
 */
function ringKeyframes(name: string, stops: { at: number; b: Box; ease?: string; opacity?: number; dx?: number }[]) {
  const block = (n: string, extra: number) =>
    `@keyframes ${n} { ${stops
      .map((st) => {
        const r = ringRect(st.b, extra);
        return `${(st.at * 100).toFixed(2)}% { x: ${r.x + (st.dx ?? 0)}px; y: ${r.y}px; width: ${r.width}px; height: ${r.height}px; opacity: ${st.opacity ?? 1}; animation-timing-function: ${st.ease ?? ACT_II}; }`;
      })
      .join(" ")} }`;
  return `${block(name, 0)} ${block(`${name}-outer`, RING_OUTER)}`;
}

function FocusRing({ rest, name, dur, delay }: { rest: Box; name?: string; dur?: number; delay?: number }) {
  const inner = ringRect(rest);
  const outer = ringRect(rest, RING_OUTER);
  const run = (n: string) => (name ? { animation: `${n} ${dur}s linear ${delay}s both` } : undefined);
  return (
    <g fill="none">
      {/* outline only: it covers nothing it lands on, and the dark edge keeps the gold visible on any ground */}
      <rect {...outer} rx={outer.height / 2.4} stroke={P.nightDeep} strokeWidth={2.5} style={name ? run(`${name}-outer`) : undefined} />
      <rect {...inner} rx={inner.height / 2.4} stroke={P.goldHi} strokeWidth={3.5} style={name ? run(name) : undefined} />
    </g>
  );
}

/** The genie and his carpet, small, for the slides where the page is the subject. */
/**
 * `held` keeps him where slide 3 left him: no entrance, no float and no billow,
 * so the eye goes to the page (the owner's word on slide 4); only the mist drifts.
 */
function GenieOnCarpet({ look, calm = false, enter, held = false, sweep }: { look?: Pt; calm?: boolean; enter?: number; held?: boolean; sweep?: number }) {
  return (
    <g style={enter != null ? anim("ag-flyin", 0.5, enter, {}, "backwards", ACT_II) : undefined}>
      <g
        style={
          // held at the middle of slide 3's float, so the hand-over is never more than half a bob
          held ? { transform: "translateY(-4.5px)" } : { animation: `ag-float 3.6s ease-in-out ${calm ? 0 : 0.6}s infinite` }
        }
      >
        <g transform="translate(-150 148) scale(0.55)">
          <MagicCarpet />
        </g>
        <g transform="scale(0.6)">
          <Genie look={look} calm={calm} settle={held ? undefined : (enter ?? 0) + 0.35} sweep={sweep} />
        </g>
      </g>
      {/* the mist he left behind on the way in, streaming off and thinning */}
      {enter != null && (
        <g style={{ opacity: 0, animation: `ag-trail 1.4s ease-out ${enter + 0.2}s both` }}>
          {[
            [-120, 120, 90, 22],
            [-170, 150, 110, 18],
            [-90, 160, 70, 16],
          ].map(([x, y, rx, ry], i) => (
            <ellipse key={i} cx={x} cy={y} rx={rx} ry={ry} fill="url(#ag-mistlit)" filter="url(#ag-soft)" />
          ))}
        </g>
      )}
    </g>
  );
}

const PAGE_X = 760;
const PAGE_Y = 150;

// ═════════════════════════════════════════════════════════════════════════════
// Slide 3 — Wish One, Accessible HTML
// The genie rides his carpet up to The Page. Landmark Lanterns light down its
// edge, header, nav, main, footer; lamp-gold light finds a div pretending to
// be a button, a Bug Knot tightens on it until it is named, and lets go as it
// becomes a real button.
// ═════════════════════════════════════════════════════════════════════════════
// On the phone the stage draws the scene at about a third of its size, so the
// page's own words are raised to stay at 8 CSS px or more there.
const PHONE_TEXT = 1.44;
const PHONE_TAG = 1.36;

const T3 = { enter: 0.1, page: 0.3, lanterns: 1.1, find: 2.1, tie: 2.4, name: 3.5, fix: 3.8 };

function WishOneStage() {
  // on a phone the band is narrower: the camera steps back so the carpet stays whole
  const compact = useCompactLayout();
  const s = CTRL.save;
  return (
    <Stage>
      <Scene>
        <NightWall motes={false} />
        <g transform={compact ? "translate(800 450) scale(0.86) translate(-800 -450)" : undefined}>
        <g transform={`translate(${PAGE_X} ${PAGE_Y})`}>
          <g style={{ ...anim("ag-approach", 0.5, T3.page, {}, "backwards", ACT_II), ...box("50% 50%") }}>
            <PageScreen />
            {(["header", "nav", "main", "footer"] as const).map((r, i) => (
              <LandmarkLantern key={r} region={r} delay={T3.lanterns + i * 0.2} labelScale={compact ? PHONE_TEXT : 1} />
            ))}
            {/* lamp-gold light finding the div */}
            <ellipse cx={s.x + s.w / 2} cy={s.y + s.h / 2} rx={120} ry={70} fill="url(#ag-spillglow)" style={anim("ag-fadein", 0.4, T3.find, {}, "backwards", ACT_II)} />
            {/* before: the div and its tag, until it is fixed */}
            <g style={{ ...anim("ag-fadeout", 0.3, T3.fix, {}, "both", ACT_II), opacity: 0 }}>
              <DivPretending b={s} />
              <Tag x={s.x} y={s.y - 62} text="<div onclick>" color={P.bugInkHi} scale={compact ? PHONE_TAG : 1} />
            </g>
            {/* after: a real button, and its tag in gold */}
            <g style={{ ...anim("ag-pop", 0.5, T3.fix, {}, "backwards", ACT_II), ...box("50% 50%") }}>
              <PageButton b={s} label="Save" gold />
              <Tag x={s.x + 8} y={s.y - 8} text="<button>" color={P.goldHi} scale={compact ? PHONE_TAG : 1} />
            </g>
            <BugKnot b={s} tie={T3.tie} untie={T3.name} />
          </g>
        </g>
        <g transform="translate(520 450)">
          <GenieOnCarpet look={[8, 2]} enter={T3.enter} />
        </g>
        </g>
      </Scene>
    </Stage>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Slide 4 — Wish Two, Focus You Can Follow
// From his carpet the genie watches the Focus Ring glide along The Page, a
// skip link glowing at its top. At a dialog a Bug Knot snaps tight with the
// ring caught inside, until the knot unties and the ring glides back to the
// button that opened the dialog.
// ═════════════════════════════════════════════════════════════════════════════
const T4 = { start: 0.5, skip: 1.2, dialog: 2.4, press: 3.9, tie: 4.0, untie: 4.8, close: 5.15, total: 6.0 };
const at4 = (t: number) => (t - T4.start) / (T4.total - T4.start);
/** The skip link on the phone: its words at 23px, so 8 CSS px there; the box grows with them. */
const SKIP_PHONE: Box = { x: 16, y: 33, w: 300, h: 34 };
const ring4Stops = (skip: Box) => [
  { at: 0, b: skip, opacity: 0 },
  { at: at4(0.6), b: skip },
  { at: at4(T4.skip), b: skip },
  // the skip link is followed: past the navigation, straight to main's first control
  { at: at4(1.6), b: CTRL.save },
  { at: at4(2.4), b: CTRL.save },
  // inside the open dialog, Tab moves between its controls: keeping focus in is right
  { at: at4(2.75), b: CTRL.dlgOk },
  { at: at4(3.15), b: CTRL.dlgCancel },
  { at: at4(3.5), b: CTRL.dlgOk },
  { at: at4(3.85), b: CTRL.dlgCancel },
  // Close is pressed, and nothing happens: there is no way out
  { at: at4(3.92), b: CTRL.dlgCancel, dx: -5, ease: "linear" },
  { at: at4(3.99), b: CTRL.dlgCancel, dx: 5, ease: "linear" },
  { at: at4(4.06), b: CTRL.dlgCancel, dx: -4, ease: "linear" },
  { at: at4(4.13), b: CTRL.dlgCancel, dx: 3, ease: "linear" },
  { at: at4(4.2), b: CTRL.dlgCancel },
  { at: at4(5.45), b: CTRL.dlgCancel },
  // let go: the dialog closes and focus goes back to the button that opened it
  { at: 1, b: CTRL.save },
];
const RING4 = ringKeyframes("ag-ring4", ring4Stops(CTRL.skip));
const RING4_PHONE = ringKeyframes("ag-ring4p", ring4Stops(SKIP_PHONE));

function WishTwoStage() {
  // on a phone the band is narrower: the camera steps back so the carpet stays whole
  const compact = useCompactLayout();
  const d = CTRL.dialog;
  const skip = compact ? SKIP_PHONE : CTRL.skip;
  return (
    <Stage>
      <Scene>
        <NightWall motes={false} />
        <g transform={compact ? "translate(800 450) scale(0.86) translate(-800 -450)" : undefined}>
        <g transform={`translate(${PAGE_X} ${PAGE_Y})`}>
          <PageScreen />
          {/* the skip link at the top, glowing: past the navigation in one step */}
          <g>
            <rect x={skip.x} y={skip.y} width={skip.w} height={skip.h} rx={6} fill={P.goldHi} opacity={0.16} />
            <text x={skip.x + 12} y={skip.y + (compact ? 25 : 18)} fontFamily={MONO} fontWeight={700} fontSize={compact ? 23 : 15} fill={P.goldHi}>
              Skip to main content
            </text>
          </g>
          <PageButton b={CTRL.save} label="Open" />
          {/* the skip link followed: a glow passes over the navigation it jumps */}
          <rect x={REGIONS.nav.x} y={REGIONS.nav.y} width={REGIONS.nav.w} height={REGIONS.nav.h} rx={8} fill={P.goldHi} style={{ opacity: 0, ...anim("ag-sweep", 0.5, T4.skip, {}, "both", "ease-out") }} />
          {/* the dialog, open while it holds the focus, invisible at rest */}
          <g style={{ opacity: 0, animation: `ag-dialog ${T4.close + 0.3 - T4.dialog}s ${ACT_I} ${T4.dialog}s both`, ...box("50% 50%") }}>
            <g>
              <rect x={0} y={0} width={PAGE_W} height={PAGE_H} rx={12} fill={P.nightDeep} opacity={0.55} />
              <rect x={d.x} y={d.y} width={d.w} height={d.h} rx={14} fill={P.screen} stroke={P.screenEdge} strokeWidth={2} />
              <rect x={d.x + 20} y={d.y + 24} width={180} height={18} rx={9} fill={P.screenLine} opacity={0.8} />
              {[0, 1, 2].map((i) => (
                <rect key={i} x={d.x + 20} y={d.y + 66 + i * 18} width={[320, 290, 200][i]} height={8} rx={4} fill={P.screenLine} opacity={0.4} />
              ))}
              {/* the trap's knot lies behind the dialog's buttons, so its cord crosses no label */}
              <BugKnot b={{ x: d.x + 10, y: d.y + 10, w: d.w - 20, h: d.h - 20 }} tie={T4.tie} untie={T4.untie} />
              <PageButton b={CTRL.dlgOk} label="OK" />
              <PageButton b={CTRL.dlgCancel} label="Close" />
            </g>
          </g>
          <style>{compact ? RING4_PHONE : RING4}</style>
          <FocusRing rest={CTRL.save} name={compact ? "ag-ring4p" : "ag-ring4"} dur={T4.total - T4.start} delay={T4.start} />
        </g>
        <g transform="translate(520 450)">
          <GenieOnCarpet look={[8, 2]} held />
        </g>
        </g>
      </Scene>
    </Stage>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Slide 5 — Wish Three, Narrated Workflows
// The held frame: dark and still. The carpet floats steady and the genie
// floats with his eyes closed and a calm smile, beside the bottle on its shelf
// and a 40-inch flat panel leaning there, far too big to fit inside it. The
// Focus Ring steps along The Page, one instant step per spoken line, the
// lanterns lit, and one Bug Knot held tight where a step has no name.
// ═════════════════════════════════════════════════════════════════════════════
const STEPS5 = [CTRL.nav[0], CTRL.heading, CTRL.save, CTRL.image, CTRL.icon];
const RING5 = (() => {
  const per = 1 / STEPS5.length;
  const stops: { at: number; b: Box; ease?: string }[] = [];
  STEPS5.forEach((b, i) => {
    // held at each step, then a jump: no glide in the stillness
    stops.push({ at: i * per, b, ease: "linear" });
    if (i < STEPS5.length - 1) stops.push({ at: (i + 1) * per - 0.004, b, ease: "linear" });
  });
  stops.push({ at: 1, b: STEPS5[STEPS5.length - 1], ease: "linear" });
  return ringKeyframes("ag-ring5", stops);
})();

/** The 40-inch flat panel: dark, glossy, switched off, and much bigger than any bottle. */
function FlatPanel() {
  const W = 280;
  const H = 158;
  const B = 12; // a thick bezel, the way a big panel has one
  return (
    <g>
      {/* where it meets the shelf: a contact shadow, darkest under the bezel */}
      <ellipse cx={W / 2} cy={B + 2} rx={W / 2 + 20} ry={9} fill={P.nightDeep} opacity={0.85} filter="url(#ag-soft)" />
      {/* the shadow it throws back onto the wall it leans on */}
      <rect x={14} y={-H - B + 10} width={W + B} height={H + B} rx={10} fill={P.nightDeep} opacity={0.5} filter="url(#ag-softer)" />
      <rect x={-B} y={-H - B} width={W + B * 2} height={H + B * 2} rx={10} fill="#0b0a12" />
      <rect x={-B} y={-H - B} width={W + B * 2} height={4} rx={2} fill={P.moon} opacity={0.3} />
      <rect x={0} y={-H} width={W} height={H} rx={3} fill="url(#ag-panel)" />
      {/* its glass catches the page across the room: a faint, mirrored reflection */}
      <clipPath id="ag-panelglass">
        <rect x={0} y={-H} width={W} height={H} rx={3} />
      </clipPath>
      <g clipPath="url(#ag-panelglass)">
        <g transform={`translate(${W - 30} ${-H + 18}) scale(-0.2 0.2)`} opacity={0.14}>
          <rect x={0} y={0} width={PAGE_W} height={PAGE_H} rx={12} fill={P.screenEdge} />
          {[84, 140, 190, 230, 260, 450].map((y) => (
            <rect key={y} x={24} y={y} width={360} height={14} rx={7} fill={P.screenLine} />
          ))}
          <rect x={CTRL.save.x} y={CTRL.save.y} width={CTRL.save.w} height={CTRL.save.h} rx={22} fill={P.goldHi} />
        </g>
        <path d={`M 60 ${-H} L 130 ${-H} L 40 0 L -30 0 Z`} fill="#fff" opacity={0.05} />
      </g>
      <circle cx={W - 10} cy={6} r={1.8} fill={P.bugInk} opacity={0.6} />
    </g>
  );
}

function WishThreeStage() {
  const s = CTRL.icon;
  return (
    <Stage>
      <Scene>
        <NightWall motes={false} />
        <Shelf glowX={430} glow={0.35} />
        {/* the panel, leaning on the wall beside the bottle: square on the shelf, its bezel's foot on the shelf line */}
        <g transform={`translate(492 ${SHELF_Y - 16})`}>
          <FlatPanel />
        </g>
        <g transform={`translate(430 ${SHELF_Y - 2}) scale(0.42)`}>
          <GenieBottle dusty={0} light={0.7} clear />
        </g>
        <g transform="translate(950 190) scale(0.6)">
          <PageScreen dim />
          {(["header", "nav", "main", "footer"] as const).map((r) => (
            <LandmarkLantern key={r} region={r} still label={false} nudge={r === "header" ? -10 : r === "nav" ? 12 : 0} />
          ))}
          <PageButton b={CTRL.save} label="Save" gold />
          {/* an icon-only button: a gear, and no name */}
          <g>
            <circle cx={s.x + s.w / 2} cy={s.y + s.h / 2} r={s.w / 2} fill={P.screenEdge} />
            <circle cx={s.x + s.w / 2} cy={s.y + s.h / 2} r={9} fill="none" stroke="#fff" strokeWidth={4} />
            {[0, 60, 120, 180, 240, 300].map((a) => (
              <rect key={a} x={s.x + s.w / 2 - 2.5} y={s.y + 6} width={5} height={8} fill="#fff" transform={`rotate(${a} ${s.x + s.w / 2} ${s.y + s.h / 2})`} />
            ))}
          </g>
          <BugKnot b={s} held />
          <style>{RING5}</style>
          <FocusRing rest={STEPS5[STEPS5.length - 1]} name="ag-ring5" dur={7.5} delay={0.2} />
        </g>
        <g transform="translate(640 235)">
          <GenieOnCarpet calm />
        </g>
      </Scene>
    </Stage>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Slice 3 — the cards and the gift
// ═════════════════════════════════════════════════════════════════════════════

// ── Bug Card ────────────────────────────────────────────────────────────────
// One finding made into work: a parchment card, the Worker's Almanac's paper
// and ink, with the finding's impact, what it is, the rule it rests on, the
// element and its fix. A bug is marked in bug-ink and a fix in lamp-gold, as a
// diff marks a removed and an added line; the marks are deep or outlined so
// they hold 3:1 on the cream. Its lower lines are genie filler, drawn as
// texture and hidden from the accessibility tree.
type Impact = "critical" | "serious" | "moderate";
type Finding = { impact: Impact; title: string; rule: string; bug: string; fix: string };

const FINDINGS: Finding[] = [
  { impact: "critical", title: "A click handler on a div", rule: "A11y Genie: click on a non-control", bug: '<div onclick="save()">Save</div>', fix: '<button onclick="save()">Save</button>' },
  { impact: "critical", title: "An icon button with no name", rule: "axe-core: button-name", bug: "<button><svg/></button>", fix: '<button aria-label="Settings"><svg/></button>' },
  { impact: "serious", title: "A dialog that traps focus", rule: "A11y Genie: keyboard trap", bug: "Escape does nothing", fix: "Escape closes it; focus goes back" },
  { impact: "moderate", title: "No landmark regions", rule: "axe-core: region", bug: "<div class=\"top\">", fix: "<header> <nav> <main> <footer>" },
];

/** The product's name, as the cards print it. */
const PRODUCT = "A11y Genie";

const GENIE_FILLER =
  "Poof! Out of the musty bottle and through the magic mist, floating footless over a vintage magic carpet. Mind the rug burn while you pick your three wishes. I have read your markup, and my patience is purely cosmetic.";

// The Almanac's paper: fibre grain, a toasted edge, and one old water stain with its tide-line.
const PARCHMENT_GRAIN =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='220'%3E%3Cfilter id='g'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85 0.35' numOctaves='3' seed='4' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 0.36 0 0 0 0 0.24 0 0 0 0 0.1 0 0 0 0.3 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23g)'/%3E%3C/svg%3E\")";
const PARCHMENT_BG = [
  PARCHMENT_GRAIN,
  "radial-gradient(circle 34px at 95% 90%, rgba(150,100,40,0.08) 0px, rgba(150,100,40,0.1) 26px, rgba(110,70,25,0.2) 30px, rgba(150,100,40,0) 33px)",
  `radial-gradient(ellipse at 50% 40%, ${P.parchmentHi} 0%, ${P.parchment} 55%, ${P.parchmentDeep} 100%)`,
].join(", ");

function ImpactChip({ impact, size = "0.72em" }: { impact: Impact; size?: string }) {
  const bg = impact === "moderate" ? P.goldMarkEdge : P.bugMark;
  return (
    <span style={{ fontFamily: MONO, fontSize: size, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#ffffff", background: bg, borderRadius: 4, padding: "2px 7px" }}>
      {impact}
    </span>
  );
}

/** A line of code on the card, marked like a diff: − for the bug, + for the fix. */
function CardCode({ text, kind, wrap }: { text: string; kind: "bug" | "fix"; wrap: boolean }) {
  const bug = kind === "bug";
  return (
    <div style={{ display: "flex", alignItems: "stretch", gap: 10, margin: "4px 0" }}>
      <span
        aria-hidden="true"
        style={{
          flexShrink: 0,
          width: 22,
          borderRadius: 4,
          background: bug ? P.bugMark : P.goldMark,
          border: bug ? "none" : `2px solid ${P.goldMarkEdge}`,
          color: bug ? "#ffffff" : P.ink,
          fontFamily: MONO,
          fontWeight: 700,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {bug ? "−" : "+"}
      </span>
      <code
        style={{
          fontFamily: MONO,
          fontSize: "1em",
          fontWeight: 700,
          color: P.ink,
          background: bug ? "rgba(156,15,76,0.10)" : "rgba(217,154,30,0.22)",
          borderRadius: 4,
          padding: "3px 8px",
          whiteSpace: wrap ? "pre-wrap" : "pre",
          overflowWrap: wrap ? "anywhere" : undefined,
          flex: 1,
          minWidth: 0,
        }}
      >
        {text}
      </code>
    </div>
  );
}

function BugCard({ f, big = false, wrap = false, tilt = 0, delay }: { f: Finding; big?: boolean; wrap?: boolean; tilt?: number; delay?: number }) {
  return (
    <div style={{ position: "relative", transform: `rotate(${tilt}deg)` }}>
      {/* the wish smoke it comes out of, invisible at rest */}
      {delay != null && (
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: "-70px -60px",
            borderRadius: "50%",
            background: `radial-gradient(ellipse, rgba(255,241,196,0.95) 0%, rgba(255,223,134,0.55) 40%, rgba(255,223,134,0) 70%)`,
            filter: "blur(6px)",
            opacity: 0,
            animation: `ag-cardsmoke 1.4s ${ACT_IV} ${delay - 0.15}s both`,
          }}
        />
      )}
      <div
        style={{
          position: "relative",
          background: PARCHMENT_BG,
          border: `1px solid ${P.parchmentEdge}`,
          borderRadius: 6,
          boxShadow: `inset 0 0 26px rgba(120,80,30,0.38), 0 10px 26px rgba(0,0,0,0.5)`,
          color: P.ink,
          padding: big ? "18px 22px 14px" : "10px 16px 8px",
          // on the phone (wrap) the small cards' rule and chip are raised to read at 8 CSS px
          fontSize: big ? 19 : wrap ? 15 : 14,
          lineHeight: 1.35,
          fontFamily: "Georgia, 'Times New Roman', serif",
          animation: delay != null ? `ag-cardin 1s ${ACT_IV} ${delay}s backwards` : undefined,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: big ? 8 : 4 }}>
          <ImpactChip impact={f.impact} size={wrap ? "0.95em" : "0.72em"} />
          <strong style={{ fontSize: "1.08em" }}>{f.title}</strong>
        </div>
        <div style={{ fontFamily: MONO, fontSize: wrap ? "0.95em" : "0.72em", color: P.ink, marginBottom: big ? 8 : 4 }}>
          Rule ·{" "}
          {f.rule.startsWith(PRODUCT) ? (
            <>
              {/* the product's name in the card's serif, where its 1s cannot read as l */}
              <span style={{ fontFamily: "Georgia, 'Times New Roman', serif", fontSize: "1.12em" }}>{PRODUCT}</span>
              {f.rule.slice(PRODUCT.length)}
            </>
          ) : (
            f.rule
          )}
        </div>
        <CardCode text={f.bug} kind="bug" wrap={wrap} />
        <CardCode text={f.fix} kind="fix" wrap={wrap} />
        {/* genie filler: the card's lower lines, texture only */}
        <div
          aria-hidden="true"
          style={{
            marginTop: big ? 10 : 6,
            fontSize: 8.5,
            lineHeight: 1.45,
            color: P.inkSoft,
            opacity: 0.5,
            height: big && !wrap ? "3.6em" : "1.45em",
            overflow: "hidden",
            // it fades out to the right and below, so it never stops on a visible cut
            WebkitMaskImage: "linear-gradient(to bottom, #000 35%, transparent 100%)",
            maskImage: "linear-gradient(to bottom, #000 35%, transparent 100%)",
          }}
        >
          <div style={{ WebkitMaskImage: "linear-gradient(to right, #000 55%, transparent 96%)", maskImage: "linear-gradient(to right, #000 55%, transparent 96%)" }}>
            {GENIE_FILLER} {GENIE_FILLER}
          </div>
        </div>
      </div>
    </div>
  );
}

/** The cards in the scene drawn small, as SVG: the same paper, a chip, two marked lines and filler. */
function BugCardMini({ f }: { f: Finding }) {
  return (
    <g>
      <rect x={0} y={0} width={150} height={92} rx={5} fill="url(#ag-card)" stroke={P.parchmentEdge} strokeWidth={1.5} />
      <rect x={10} y={10} width={44} height={11} rx={3} fill={f.impact === "moderate" ? P.goldMarkEdge : P.bugMark} />
      <rect x={60} y={11} width={74} height={8} rx={4} fill={P.ink} opacity={0.8} />
      <rect x={10} y={32} width={8} height={12} rx={2} fill={P.bugMark} />
      <rect x={22} y={34} width={110} height={8} rx={4} fill={P.ink} opacity={0.55} />
      <rect x={10} y={50} width={8} height={12} rx={2} fill={P.goldMark} stroke={P.goldMarkEdge} strokeWidth={1.2} />
      <rect x={22} y={52} width={116} height={8} rx={4} fill={P.ink} opacity={0.55} />
      <rect x={10} y={72} width={128} height={4} rx={2} fill={P.inkSoft} opacity={0.3} />
      <rect x={10} y={80} width={96} height={4} rx={2} fill={P.inkSoft} opacity={0.3} />
    </g>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Slide 6 — Cards, Like Magic
// Bug Cards come out of the wish smoke one by one and lay themselves in a neat
// list on the carpet, the genie beside them. The whole scene sits in a
// ComponentFrame that opens zoomed in on the top card, so its code is read
// first; zooming out shows the list. On a phone the scene drops to the cards
// alone, and the code breaks rather than shrinks.
// ═════════════════════════════════════════════════════════════════════════════
/** The opening zoom: 100%, the owner's call (the whole list at once). */
const CARDS_ZOOM = { desktop: 1, compact: 1 };
const T6 = { first: 0.4, step: 0.45 };
/** The phone's list: it starts below the frame's zoom control, and shows the top card and this many more. */
/** `seen`: how much of the 768px virtual panel the phone frame shows across (about 710, slide-deck-traps.md), so the list centres in what is seen. */
const CARDS_PHONE = { top: 104, gap: 6, more: 2, seen: 710 };

function CardsCanvas({ compact }: { compact: boolean }) {
  // on the phone the canvas is the virtual panel's width (768), so the list can stand centred in it
  const W = compact ? 768 : 940;
  return (
    <div style={{ position: "relative", width: W, height: compact ? 760 : 780 }}>
      {!compact && (
        <svg width={940} height={780} viewBox="0 0 940 780" style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }} aria-hidden="true">
          <Defs />
          {/* the carpet under the list, and the genie at its far end */}
          <g transform="translate(150 640) scale(0.92)">
            <MagicCarpet />
          </g>
          <g transform="translate(705 528) scale(0.52)">
            <g style={{ animation: "ag-float 3.6s ease-in-out infinite" }}>
              <Genie look={[-12, 4]} settle={0.2} />
            </g>
          </g>
        </svg>
      )}
      {compact ? (
        // on the phone: the list alone, below the zoom control, as many cards as the band holds whole
        <div style={{ position: "absolute", left: (CARDS_PHONE.seen - 490) / 2, top: CARDS_PHONE.top, width: 490, display: "flex", flexDirection: "column", gap: CARDS_PHONE.gap }}>
          <BugCard f={FINDINGS[0]} big wrap delay={T6.first} />
          {FINDINGS.slice(1, 1 + CARDS_PHONE.more).map((f, i) => (
            <BugCard key={f.title} f={f} wrap tilt={[-1.2, 0.8, -0.6][i]} delay={T6.first + T6.step * (i + 1)} />
          ))}
        </div>
      ) : (
        <>
          {/* the top card, framed big so its code is read first */}
          <div style={{ position: "absolute", left: 24, top: 46, width: 540 }}>
            <BugCard f={FINDINGS[0]} big delay={T6.first} />
          </div>
          {/* the rest of the list, laid on the carpet one under the next */}
          {FINDINGS.slice(1).map((f, i) => (
            <div key={f.title} style={{ position: "absolute", left: 44 + i * 14, top: 340 + i * 122, width: 470 }}>
              <BugCard f={f} tilt={[-1.2, 0.8, -0.6][i]} delay={T6.first + T6.step * (i + 1)} />
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function CardsLikeMagicStage() {
  const compact = useCompactLayout();
  return (
    <Stage>
      <Scene>
        <NightWall motes={false} />
      </Scene>
      <div style={{ position: "absolute", inset: 0 }}>
        <ComponentFrame transparent inverse initialZoom={compact ? CARDS_ZOOM.compact : CARDS_ZOOM.desktop} zoomStep={0.2}>
          <CardsCanvas compact={compact} />
        </ComponentFrame>
      </div>
    </Stage>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Slide 7 — Three Wishes Granted
// The payoff shows the result. The Page from slide 3 stands lit beside the
// genie on his carpet; he sweeps a hand and a band of lamp-gold light passes
// down it, header to footer: the rescan. A readout settles under the page, and
// the four cards from slide 6, stacked on the shelf (the backlog), are each
// stamped Fixed as the band passes. The Page glows clean with every lantern
// lit, the bottle shines with no dust on it, and once he has had his last word
// the genie and his carpet curl home into it. The button sits small in the
// corner and opens the presentation engine.
// ═════════════════════════════════════════════════════════════════════════════
/** The readout under the page, word for word what the rescan reports (design/a11y-genie.md, slide 7). */
const READOUT = "Critical 0 · Serious 0 · Fixed 4";
/** The stamp's word: the one `check --baseline` uses for a fixed finding. */
const STAMP = "Fixed";

/**
 * Where slide 7's things stand, on the desk and on the phone. B is the bottle,
 * G the genie, P the page (PS its scale), STACK_X the backlog's left edge and
 * READ the readout's type size. JOIN and NECK shape the curl home: where it
 * turns above the bottle, and how far its last reach swings out on the way
 * down into the neck.
 *
 * The desk keeps everything it draws inside x 330 to 1270: the scene is sliced
 * to the panel, and a 16:10 window shows about 316 to 1284 of it
 * (agentic/slide-deck-traps.md). The page's right edge is 1260, as on slides 3
 * to 5, and the readout is no wider than the page. On the phone the page is
 * drawn larger and the readout is about 8.7 CSS px, over the 8 the other
 * slides hold there.
 */
type Layout7 = { BX: number; BS: number; GX: number; GY: number; PX: number; PY: number; PS: number; STACK_X: number; READ: number; JOIN: number; NECK: [number, number] };
const S7: { desk: Layout7; phone: Layout7 } = {
  desk: { BX: 415, BS: 0.7, GX: 645, GY: 210, PX: 900, PY: 80, PS: 0.72, STACK_X: 600, READ: 17, JOIN: 60, NECK: [40, 10] },
  phone: { BX: 425, BS: 0.62, GX: 590, GY: 215, PX: 850, PY: 50, PS: 0.8, STACK_X: 600, READ: 21, JOIN: 30, NECK: [-50, -10] },
};
/**
 * The rescan, in seconds: his hand lifts, the band passes (800ms), a stamp
 * lands on each card in turn as it does (400ms each), then the readout settles
 * and the page glows. When he goes home is not here: it is read off the
 * slide's own Says (homeStart7).
 */
const T7 = { sweep: 0.4, scan: 0.9, scanDur: 0.8, stamp: 1.0, stampStep: 0.2, stampDur: 0.4, read: 1.7, glow: 1.7, homeDur: 0.8 };
/** Slide 7's id: the deck's entry wears it, and homeStart7 finds the entry by it. */
const SLIDE7_ID = "beautiful-html";
/**
 * The second he starts for home: once he has had his last word, which is how
 * long the voice takes to read this slide's title and Says. Read from the
 * deck's own entry, so a change to a Say moves it; found on first use, since
 * the deck is declared below.
 */
let homeStart7Cache: number | undefined;
function homeStart7(): number {
  if (homeStart7Cache == null) {
    const slide = a11yGenieDeck.slides().find((sl) => sl.id === SLIDE7_ID);
    homeStart7Cache = slide ? Math.ceil(slideSpokenText(slide).length / NARRATION_CHARS_PER_SEC) : 0;
  }
  return homeStart7Cache;
}
/** Where the genie's puffs sit in GenieOnCarpet's own coordinates. */
const PUFF7 = 0.6 * PUFF_Y;

/** The curl home from his puffs to the bottle's neck, and the keyframes that ride it, for one layout. */
function home7(l: Layout7, name: string) {
  const curves: [Pt, Pt, Pt, Pt][] = [
    [
      [l.GX, l.GY + PUFF7],
      [l.GX + 70, l.GY + 30],
      [l.GX - 150, l.GY - 70],
      [l.BX + l.JOIN, SHELF_Y - 440],
    ],
    [
      [l.BX + l.JOIN, SHELF_Y - 440],
      [l.BX + l.NECK[0], SHELF_Y - 400],
      [l.BX + l.NECK[1], SHELF_Y - 340],
      [l.BX, SHELF_Y - 2 - l.BS * 346],
    ],
  ];
  const at = (f: number): Pt => {
    const n = curves.length;
    const ci = Math.min(n - 1, Math.floor(f * n));
    const c = curves[ci];
    return bezier(c[0], c[1], c[2], c[3], f * n - ci);
  };
  // his puffs ride the curl, and he shrinks to a wisp at the neck
  const steps = 12;
  const frames: string[] = [];
  for (let k = 0; k <= steps; k++) {
    const f = k / steps;
    const [px, py] = at(f);
    const sc = 1 - 0.95 * Math.pow(f, 1.4);
    const op = f < 0.85 ? 1 : (1 - f) / 0.15;
    frames.push(`${(f * 100).toFixed(1)}% { transform: translate(${(px - l.GX).toFixed(1)}px, ${(py - l.GY - PUFF7).toFixed(1)}px) scale(${sc.toFixed(3)}); opacity: ${op.toFixed(2)}; }`);
  }
  return { name, curves, keyframes: `@keyframes ${name} { ${frames.join(" ")} }` };
}
const HOME7 = { desk: home7(S7.desk, "ag-home"), phone: home7(S7.phone, "ag-homep") };

/** The backlog: the four cards in a tidy stack on the shelf, each showing the strip its stamp lands on. */
const STACK_STEP = 34;
const STACK = FINDINGS.map((f, i) => {
  const up = FINDINGS.length - 1 - i;
  return { f, dx: (i % 2) * 6 - 3 + up * 8, y: SHELF_Y - 4 - 92 - up * STACK_STEP, r: [-2, 1.5, -1, 2][i] };
});

/** The lamp-gold stamp on a card in the stack: its ink is deep, so the word holds on the gold. */
function FixedStamp({ delay }: { delay: number }) {
  return (
    <g transform="translate(104 17)">
      <g style={{ ...anim("ag-stamp", T7.stampDur, delay, {}, "backwards", ACT_IV), ...box("50% 50%") }}>
        <g transform="rotate(-5)">
          <rect x={-41} y={-14.5} width={82} height={29} rx={5} fill="url(#ag-goldbtn)" stroke={P.goldMarkEdge} strokeWidth={2} />
          <rect x={-37} y={-10.5} width={74} height={21} rx={3} fill="none" stroke={P.goldInk} strokeWidth={1} opacity={0.45} />
          <text x={0} y={7.5} textAnchor="middle" fontFamily={MONO} fontWeight={700} fontSize={21} fill={P.goldInk}>
            {STAMP}
          </text>
        </g>
      </g>
    </g>
  );
}

function BeautifulHtmlStage() {
  // on a phone the band is narrower: The Page and its readout are drawn larger, the stack below them
  const compact = useCompactLayout();
  const { BX, BS, GX, GY, PX, PY, PS, STACK_X, READ } = compact ? S7.phone : S7.desk;
  const home = compact ? HOME7.phone : HOME7.desk;
  const homeAt = homeStart7();
  const readX = PX + (PS * PAGE_W) / 2;
  const readY = PY + PS * PAGE_H + 62;
  const readW = READOUT.length * READ * 0.6 + 28;
  return (
    <Stage>
      <Scene>
        <defs>
          {/* the rescan's band: its light trails off above the line */}
          <linearGradient id="ag-scantail" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={P.gold} stopOpacity={0} />
            <stop offset="1" stopColor={P.goldHi} stopOpacity={0.42} />
          </linearGradient>
          <clipPath id="ag-scanclip">
            <rect x={-24} y={0} width={PAGE_W + 48} height={PAGE_H} />
          </clipPath>
        </defs>
        <style>{home.keyframes}</style>
        <NightWall motes={false} />
        {/* the bottle's light, full, on the wall and the shelf */}
        <ellipse cx={BX} cy={SHELF_Y - 200} rx={420} ry={360} fill="url(#ag-spillglow)" />
        <Shelf glowX={BX} glow={1} />
        {/* The Page from slide 3, fixed: every lantern lit, and a lamp-gold glow once the rescan has passed */}
        <g transform={`translate(${PX} ${PY}) scale(${PS})`}>
          <rect x={-50} y={-50} width={PAGE_W + 100} height={PAGE_H + 100} rx={60} fill={P.gold} opacity={0.3} filter="url(#ag-softer)" style={anim("ag-fadein", 0.8, T7.glow, {}, "backwards", ACT_IV)} />
          <PageScreen />
          {(["header", "nav", "main", "footer"] as const).map((r) => (
            <LandmarkLantern key={r} region={r} still label={false} nudge={r === "header" ? -10 : r === "nav" ? 12 : 0} />
          ))}
          <PageButton b={CTRL.save} label="Save" gold />
          {/* the gear button, named now: lit gold like every fixed control */}
          <g>
            <circle cx={CTRL.icon.x + CTRL.icon.w / 2} cy={CTRL.icon.y + CTRL.icon.h / 2} r={CTRL.icon.w / 2} fill="url(#ag-goldbtn)" />
            <circle cx={CTRL.icon.x + CTRL.icon.w / 2} cy={CTRL.icon.y + CTRL.icon.h / 2} r={9} fill="none" stroke={P.goldInk} strokeWidth={4} />
            {[0, 60, 120, 180, 240, 300].map((a) => (
              <rect key={a} x={CTRL.icon.x + CTRL.icon.w / 2 - 2.5} y={CTRL.icon.y + 6} width={5} height={8} fill={P.goldInk} transform={`rotate(${a} ${CTRL.icon.x + CTRL.icon.w / 2} ${CTRL.icon.y + CTRL.icon.h / 2})`} />
            ))}
          </g>
          <rect x={0} y={0} width={PAGE_W} height={PAGE_H} rx={12} fill="none" stroke={P.goldHi} strokeWidth={4} opacity={0.8} style={anim("ag-fadein", 0.8, T7.glow, {}, "backwards", ACT_IV)} />
          {/* the rescan: a band of lamp-gold light passing down the page, header to footer; unseen at rest */}
          <g clipPath="url(#ag-scanclip)">
            <g style={{ opacity: 0, animation: `ag-scan ${T7.scanDur}s ${ACT_IV} ${T7.scan}s both` }}>
              <rect x={0} y={-90} width={PAGE_W} height={90} fill="url(#ag-scantail)" />
              <rect x={-14} y={-7} width={PAGE_W + 28} height={14} rx={7} fill={P.goldHi} opacity={0.8} filter="url(#ag-soft)" />
              <rect x={-6} y={-2} width={PAGE_W + 12} height={4} rx={2} fill={P.goldHot} />
            </g>
          </g>
        </g>
        {/* the readout: what the rescan came back with, settling under the page */}
        <g transform={`translate(${readX} ${readY})`}>
          <g style={{ ...anim("ag-settle", 0.6, T7.read, {}, "backwards", ACT_IV), ...box("50% 50%") }}>
            <rect x={-readW / 2} y={-READ * 0.95} width={readW} height={READ * 1.9} rx={7} fill="#120e26" stroke={P.gold} strokeWidth={1.5} strokeOpacity={0.7} />
            <text x={0} y={READ * 0.34} textAnchor="middle" fontFamily={MONO} fontWeight={700} fontSize={READ} fill={P.goldHi}>
              {READOUT}
            </text>
          </g>
        </g>
        {/* the backlog: slide 6's four cards in a tidy stack on the shelf, each stamped as the band passes */}
        {STACK.map((c, i) => (
          <g key={c.f.title} transform={`translate(${STACK_X + c.dx} ${c.y}) rotate(${c.r} 75 46)`}>
            <BugCardMini f={c.f} />
            <FixedStamp delay={T7.stamp + i * T7.stampStep} />
          </g>
        ))}
        {/* the curl of smoke he goes home in, gone once he is in */}
        <g style={{ opacity: 0, animation: `ag-fadeout 0.8s ${ACT_IV} ${homeAt + T7.homeDur}s both` }}>
          <SmokeTrail start={homeAt} curves={home.curves} dur={T7.homeDur} />
        </g>
        <g transform={`translate(${BX} ${SHELF_Y - 2}) scale(${BS})`}>
          <GenieBottle dusty={0} light={1} clear />
          <SmokeAtTheLip strength={0.8} />
          {/* the shine: glints on the clean glass */}
          {[
            [-70, -150, 0],
            [40, -260, 0.9],
            [-10, -430, 1.6],
          ].map(([x, y, d], i) => (
            <g key={i} transform={`translate(${x} ${y})`}>
              <g style={{ animation: `ag-glint 2.4s ease-in-out ${d}s infinite`, ...box("50% 50%") }}>
                <path d="M 0 -18 L 4 -4 L 18 0 L 4 4 L 0 18 L -4 4 L -18 0 L -4 -4 Z" fill="#fff" />
              </g>
            </g>
          ))}
        </g>
        {/* the genie on his carpet beside the page, sweeping a hand as it is scanned; then curling home */}
        <g transform={`translate(${GX} ${GY})`}>
          <g style={{ opacity: 0, animation: `${home.name} ${T7.homeDur}s ${ACT_IV} ${homeAt}s both`, transformBox: "view-box", transformOrigin: `0px ${PUFF7}px` }}>
            <GenieOnCarpet look={[8, 2]} sweep={T7.sweep} />
          </g>
        </g>
      </Scene>
      <CopyLinkButton />
    </Stage>
  );
}

// ── The deck ────────────────────────────────────────────────────────────────
export const a11yGenieDeck: Deck = {
  id: "a11y-genie",
  project: "a11y-genie",
  state: DeckState.Draft,
  title: "A11y Genie",
  summary:
    "A dusty old bottle sits on a shelf. Wipe it clean and a genie appears on his magic carpet: I grant you three wishes, part of the journey to accessible HTML: semantic markup, focus you can keep track of, and narrated workflows you can hear, then a list of cards, made like magic, for your backlog. This deck introduces a clean, magical tool that uses axe-core to find what is broken and narrates your page's workflows aloud. It is a product offering, and it is meant to be fun.",
  tags: ["product", "accessibility"],
  slides: (): Slide[] => [
    makeSlide({
      id: "the-bottle-on-the-shelf",
      title: "The Bottle on the Shelf",
      eyebrow: "Slide 1 · The Shelf",
      lead: "A dusty old bottle on a shelf. Something inside it is sighing.",
      notes: (
        <>
          <Say>Every backlog has a bottle on the shelf. Mine has been up here for years, watching you ship bugs, and frankly, I have seen enough.</Say>
          <Say>
            I am the genie, and the bottle is the tool. Wipe off the dust and axe-core runs the scan. It checks real rules, like names on controls and color contrast, and hands back
            each violation it finds, with the exact element and the rule it broke.
          </Say>
          <Beat>Hold three seconds before motion begins.</Beat>
          <Context>Establish baseline calm and the bottle. The sigh is the first sign of the genie&apos;s voice: tired, superior, and right.</Context>
        </>
      ),
      content: <BottleOnTheShelfStage />,
    }),
    makeSlide({
      id: "three-wishes",
      title: "Three Wishes",
      eyebrow: "Slide 2 · The Genie",
      lead: "Wipe off the dust, and a genie appears on his carpet. I grant you three wishes.",
      notes: (
        <>
          <Say>Oh, you dusted my bottle. Wonderful. I grant you three wishes, and I already know you are going to waste them on divs.</Say>
          <Say>
            I am A11y Genie. I run axe-core inside your page, the same rules many browser audit tools run, so everything I tell you names the rule it rests on, not a guess. Then I
            tell you what to fix first, by how hard it hits a real person.
          </Say>
          <Beat>Let the rise finish before the next line.</Beat>
          <Context>
            Introduce the genie as the tool&apos;s voice, not a mascot alone. Axe-core rates each violation&apos;s impact, which is what &quot;what to fix first&quot; stands on.
          </Context>
        </>
      ),
      content: <ThreeWishesStage />,
    }),
    makeSlide({
      id: "wish-one-accessible-html",
      title: "Wish One, Accessible HTML",
      eyebrow: "Slide 3 · Wish One",
      lead: "Wish one: part of the journey to accessible HTML. Semantic markup, so every part of the page says what it is.",
      notes: (
        <>
          <Say>
            Wish one. You slackers go around putting onclicks on divs. A div with an onclick cannot take keyboard focus and has no role, so a keyboard user cannot reach it and a
            screen reader does not know it is a button. Use a button. It comes with all of that for free.
          </Say>
          <Say>
            And no landmark regions. None. With a header, nav, main and footer, a screen reader jumps straight to the main content. And those icons without text you use as
            buttons? Give each one a name, or the screen reader says button. Just button. Button what?
          </Say>
          <Beat>Pause as each lantern lights.</Beat>
          <Context>Semantic markup: the right element for the job, landmark regions, and a name on every control.</Context>
        </>
      ),
      content: <WishOneStage />,
    }),
    makeSlide({
      id: "wish-two-focus",
      title: "Wish Two, Focus You Can Follow",
      eyebrow: "Slide 4 · Wish Two",
      lead: "Wish two, granted: keep track of focus. You always know where you are, and you can always get out.",
      notes: (
        <>
          <Say>
            Wish two. No skip links. A skip link lets a keyboard user jump past your navigation to the main content, instead of tabbing through forty menu items on every page.
            Every control must be reachable from the keyboard, and focus must be visible when it gets there.
          </Say>
          <Say>
            And the trap. A keyboard trap is a dialog or a widget that takes focus and never gives it back. Someone who cannot use a mouse now lives in your modal. Forever. Keep
            focus inside a modal on purpose while it is open, let Escape close it, and return focus to the control that opened it.
          </Say>
          <Beat>Follow the Focus Ring with your eyes; hold a beat on the trap before it lets go.</Beat>
          <Context>Focus you can keep track of: every control reachable, focus visible, and never trapped.</Context>
        </>
      ),
      content: <WishTwoStage />,
    }),
    makeSlide({
      id: "wish-three-narrated-workflows",
      title: "Wish Three, Narrated Workflows",
      eyebrow: "Slide 5 · Wish Three",
      lead: "Wish three, granted: narrated workflows. Close your eyes and hear your page.",
      notes: (
        <>
          <Say>How do I get a 40-inch flat panel in this bottle? I cannot. I have no monitor in this bottle, so I listen the way a screen reader does.</Say>
          <Say>Lorem genie, dolor sit amet. Button. Button. Graphic, image underscore final two dot P N G. Link, click here.</Say>
          <Say>That is your page, read aloud. Sound with no meaning.</Say>
          <Say>
            A narrated workflow is a spoken walk through a task: open the dialog, Tab to the button, hear its name, press Enter, hear the result. I read every step aloud, the way
            a screen reader announces it, and if any step has no name, I find it, and I say so. Out loud.
          </Say>
          <Beat>Hold three seconds in the stillness before continuing. Let the lorem genie line run flat and fast, then stop hard before &quot;That is your page.&quot;</Beat>
          <Context>
            The held Act III frame, the eyes-closed test as the deck&apos;s proof. Lorem genie is what a page sounds like when its controls have no names, or names that say
            nothing: a screen reader announces the role and has nothing useful to give it.
          </Context>
        </>
      ),
      content: <WishThreeStage />,
    }),
    makeSlide({
      id: "cards-like-magic",
      title: "Cards, Like Magic",
      eyebrow: "Slide 6 · The Cards",
      lead: "And here is a list of cards, magically: every finding, with its fix.",
      notes: (
        <>
          <Say>
            Here is your list. Every finding, axe-core&apos;s and my own checks&apos;, with its impact, the element it hit, and the fix, in plain language. No spec required. I know
            you were not going to read the spec.
          </Say>
          <Say>
            Top card: make the div a button, with the same handler and the same word, Save, and the browser gives you focus, the role and the keyboard for free. If you have the
            Toolkit, every finding is a card like this one, ready to work, and the card keeps the record of the fix, so it does not get lost between my scan and your sprint,
            which, let us be honest, is where fixes go to die.
          </Say>
          <Beat>Read the top card at the opening zoom, then zoom out to the whole list.</Beat>
          <Context>
            The product&apos;s proof: the scan turned into a list of cards, and with the Toolkit into cards that keep the record. The Toolkit is a companion open-source tool from
            the same maker that keeps a team&apos;s work as cards.
          </Context>
        </>
      ),
      content: <CardsLikeMagicStage />,
    }),
    makeSlide({
      id: SLIDE7_ID,
      title: "Three Wishes Granted",
      eyebrow: "Slide 7 · The Gift",
      lead: "Three wishes granted, part of the journey to accessible HTML. You receive the benefits of HTML content reaching a wider audience, with flexible consumption and predictable workflows.",
      notes: (
        <>
          <Say>
            Look at that. Same page, scanned again against the first scan: four fixed, nothing critical, nothing serious. Not one div pretending to be a button. Honestly, I
            almost miss them.
          </Say>
          <Say>
            One more gift, on the house. Everything you just watched is HTML and CSS: no images, no video, no slideware. The button in the corner opens the presentation engine on GitHub. Take it, and build something a screen reader can love. I will be in the bottle, listening.
          </Say>
          <Beat>End on the shine, not on the button.</Beat>
          <Context>
            Payoff scene: the page from slide 3 scanned again against the first scan, nothing critical or serious left, the four cards fixed, and the bottle clean on its shelf. A
            rescan shows what it can check, not that the page is fully accessible. The Copy names what a reader gains on the journey to accessible HTML, not what the scan proves: content that assistive technology, zoom and reflow can all use, and pages that behave predictably, in the sense of WCAG&apos;s Predictable guideline. The button opens the presentation
            engine&apos;s repository, as the other connected decks&apos; payoffs do.
          </Context>
        </>
      ),
      content: <BeautifulHtmlStage />,
    }),
  ],
};
