// Local changes applied on top of the registry source. Every find string has to match exactly once, so a
// registry update that moves or rewrites one of these places fails the build instead of passing silently.
// Files that are rewritten as a whole live in ../arc-overrides.
export const patches = [
  {
    file: 'metric-ticker/metric-ticker.tsx',
    edits: [
      {
        find: `  /** How the change is shown: relative to the previous value, or as the raw difference in the metric's own format. */\n  delta?: "percent" | "absolute";\n`,
        replace: `  /** How the change is shown: relative to the previous value, as the raw difference in the metric's own format, or not at all. */\n  delta?: "percent" | "absolute" | "none";\n`,
      },
      {
        find: `  locale?: string;\n`,
        replace: `  locale?: string;\n  /** Fixed grid-template-columns for the strip. Each metric then keeps its slot whatever its value is. */\n  columns?: string;\n`,
      },
      { find: `  locale = "en-US",\n`, replace: `  locale = "en-US",\n  columns,\n` },
      { find: 'change && direction ? ', replace: 'change && direction && metric.delta !== "none" ? ' },
      {
        find: `<span className={styles.delta} data-tone={good} data-flash={flashing || undefined} data-empty={!change || undefined}>`,
        replace: `{metric.delta !== "none" && <span className={styles.delta} data-tone={good} data-flash={flashing || undefined} data-empty={!change || undefined}>`,
      },
      {
        find: `ease: motionTokens.ease.enter }} />}\n          </span>\n`,
        replace: `ease: motionTokens.ease.enter }} />}\n          </span>}\n`,
      },
      {
        find: `      data-mode={marquee ? "marquee" : overflowing ? "scroll" : "fit"}\n`,
        replace: `      data-mode={marquee ? "marquee" : overflowing ? "scroll" : "fit"}\n      data-fixed={columns ? "" : undefined}\n      style={columns ? { "--ticker-columns": columns } as CSSProperties : undefined}\n`,
      },
    ],
  },
  {
    file: 'metric-ticker/metric-ticker.module.css',
    edits: [
      {
        find: `.item { position: relative; display: flex; flex: 1 0 auto; scroll-snap-align: start; }\n`,
        replace:
          `.item { position: relative; display: flex; flex: 1 0 auto; scroll-snap-align: start; }\n` +
          `/* Fixed slots: the value sits left and the delta right, so neither moves as digits change. */\n` +
          `.viewport[data-fixed] .track { width: 100%; }\n` +
          `.viewport[data-fixed] .group { display: grid; flex: 1 0 100%; grid-template-columns: var(--ticker-columns); }\n` +
          `.viewport[data-fixed] .item { min-width: 0; }\n` +
          `.viewport[data-fixed] .button { min-width: 0; margin-inline: 2px; padding-inline: 10px; }\n` +
          `.viewport[data-fixed] .reading { justify-content: space-between; }\n`,
      },
    ],
  },
  {
    file: 'morph-select/morph-select.module.css',
    edits: [
      {
        find: `.options { position: relative; display: grid; gap: 2px; }`,
        replace: `.options { position: relative; display: grid; grid-template-columns: minmax(0, 1fr); gap: 2px; }`,
      },
      {
        find: `.group { display: grid; gap: 2px; }`,
        replace: `.group { display: grid; grid-template-columns: minmax(0, 1fr); gap: 2px; }`,
      },
    ],
  },
  {
    file: 'ridgeline/ridgeline.tsx',
    edits: [{ find: `lo: 0, hi: 1 });`, replace: `lo: model.lo, hi: model.hi });` }],
  },
  {
    // The tsconfig forbids parameter properties (erasableSyntaxOnly)
    file: 'blocks/revenue-globe/globe-engine.ts',
    edits: [
      {
        find: `constructor(private canvas: HTMLCanvasElement, private host: HTMLElement, private reduced: boolean, private events: EngineEvents) {\n`,
        replace:
          `private canvas: HTMLCanvasElement; private host: HTMLElement; private reduced: boolean; private events: EngineEvents;\n\n` +
          `  constructor(canvas: HTMLCanvasElement, host: HTMLElement, reduced: boolean, events: EngineEvents) {\n` +
          `    this.canvas = canvas; this.host = host; this.reduced = reduced; this.events = events;\n`,
      },
    ],
  },
  {
    file: 'blocks/uptime-status/uptime-status.module.css',
    edits: [
      { find: `width: min(100%, 1040px)`, replace: `width: 100%` },
      {
        find: `.root [data-status="outage"] { --state-color: var(--danger); }\n`,
        replace: `.root [data-status="outage"] { --state-color: var(--danger); }\n.root [data-status="unknown"] { --state-color: var(--border); }\n`,
      },
    ],
  },
]
