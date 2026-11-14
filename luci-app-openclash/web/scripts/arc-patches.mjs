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
    edits: [
      { find: `lo: 0, hi: 1 });`, replace: `lo: model.lo, hi: model.hi });` },
      // Optional weights turn a ridge into a profile over the axis: its height follows the summed weight near each
      // value instead of how often the value occurs, and weighted ridges share one scale instead of each being
      // normalised to its own total. The statistics and the "at or below" share are weighted to match.
      {
        find: `  values: number[];\n}`,
        replace: `  values: number[];\n  /** Weight of each value, such as bytes or milliseconds. Ridges with weights are scaled by their summed weight, so their heights compare across rows. */\n  weights?: number[];\n}`,
      },
      {
        find: `n: number; sorted: number[] };`,
        replace: `n: number; sorted: number[]; mass: number[]; total: number; weighted: boolean };`,
      },
      {
        find:
          `function statsOf(values: number[]): Stats {\n` +
          `  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);\n` +
          `  return { sorted, n: sorted.length, min: sorted[0] ?? 0, max: sorted[sorted.length - 1] ?? 0, q1: quantile(sorted, .25), median: quantile(sorted, .5), q3: quantile(sorted, .75) };\n` +
          `}`,
        replace:
          `function statsOf(values: number[], weights?: number[]): Stats {\n` +
          `  const pairs = values.map((value, i) => [value, weights ? weights[i] ?? 0 : 1] as const).filter(([value, weight]) => Number.isFinite(value) && weight > 0).sort((a, b) => a[0] - b[0]);\n` +
          `  const sorted = pairs.map(pair => pair[0]), mass = pairs.map(pair => pair[1]), total = mass.reduce((sum, weight) => sum + weight, 0);\n` +
          `  const at = (q: number) => { if (!weights) return quantile(sorted, q); let sum = 0; for (let i = 0; i < sorted.length; i++) { sum += mass[i]!; if (sum >= q * total) return sorted[i]!; } return sorted[sorted.length - 1] ?? 0; };\n` +
          `  return { sorted, mass, total, weighted: !!weights, n: sorted.length, min: sorted[0] ?? 0, max: sorted[sorted.length - 1] ?? 0, q1: at(.25), median: at(.5), q3: at(.75) };\n` +
          `}\n` +
          `const shareBelow = (stats: Stats, x: number) => { let sum = 0; stats.sorted.forEach((value, i) => { if (value <= x) sum += stats.mass[i]!; }); return stats.total ? sum / stats.total : 0; };`,
      },
      {
        find: `const norm = 1 / (Math.max(1, stats.n) * bandwidth`,
        replace: `const norm = 1 / ((stats.weighted ? 1 : Math.max(1, stats.n)) * bandwidth`,
      },
      {
        find: `for (const value of stats.sorted) { const u = (x - value) / bandwidth; if (u > -5 && u < 5) sum += Math.exp(-.5 * u * u); }`,
        replace: `stats.sorted.forEach((value, k) => { const u = (x - value) / bandwidth; if (u > -5 && u < 5) sum += stats.mass[k]! * Math.exp(-.5 * u * u); });`,
      },
      { find: `statsOf(entry.values)`, replace: `statsOf(entry.values, entry.weights)` },
      {
        find: `below: activeStats.n ? activeStats.sorted.filter(value => value <= cursor.value).length / activeStats.n : 0`,
        replace: `below: shareBelow(activeStats, cursor.value)`,
      },
      {
        find: `tipStats?.n ? tipStats.sorted.filter(value => value <= held.value!).length / tipStats.n : 0;`,
        replace: `tipStats ? shareBelow(tipStats, held.value) : 0;`,
      },
    ],
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
