"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion, useTransform, type MotionValue } from "motion/react";
import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import { motionTokens } from "../lib/motion-tokens";
import styles from "./metric-ticker.module.css";

export interface TickerMetric {
  /** Stable id; updates are matched by id. */
  id: string;
  label: string;
  value: number;
  /** Number format for the value, such as currency, percent or a unit like millisecond. */
  format?: Intl.NumberFormatOptions;
  /** How the change is shown: relative to the previous value, as the raw difference in the metric's own format, or not at all. */
  delta?: "percent" | "absolute" | "none";
  /** Which direction is good news. Latency and churn are better going down. */
  positive?: "up" | "down";
  /** Recent values, oldest first, for the sparkline. Leave it out and the ticker keeps its own history from the values it sees. */
  history?: readonly number[];
  /** Short context in the expanded view, such as Last 30 minutes. */
  caption?: string;
}

export interface MetricTickerProps {
  metrics: readonly TickerMetric[];
  /** What happens when the metrics do not fit: a slow marquee that keeps drifting under the pointer, or plain horizontal scrolling. */
  overflow?: "marquee" | "scroll";
  /** Marquee speed in pixels per second. */
  speed?: number;
  /** How long a change stays emphasised before the delta settles, in milliseconds. */
  flashDuration?: number;
  /** Points kept for the sparkline when history is not passed. */
  historyLength?: number;
  locale?: string;
  /** Fixed grid-template-columns for the strip. Each metric then keeps its slot whatever its value is. */
  columns?: string;
  /** Accessible name of the strip. */
  label?: string;
  className?: string;
  style?: CSSProperties;
}

type Change = { delta: number; ratio: number; tick: number };
type Tape = { metrics: readonly TickerMetric[]; history: Record<string, number[]>; changes: Record<string, Change>; tick: number };

const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
const PANEL_WIDTH = 248;

type Part = { key: string; digit: number } | { key: string; text: string };

function partsOf(formatter: Intl.NumberFormat, value: number): Part[] {
  const parts = formatter.formatToParts(value);
  let place = parts.reduce((count, part) => count + (part.type === "integer" ? part.value.length : 0), 0);
  let fraction = 0;
  return parts.flatMap((part, index): Part[] => {
    if (part.type === "integer") return [...part.value].map(char => ({ key: `i${--place}`, digit: Number(char) }));
    if (part.type === "fraction") return [...part.value].map(char => ({ key: `f${fraction++}`, digit: Number(char) }));
    return [{ key: part.type === "group" ? `g${place}` : part.type === "literal" ? `l${index}` : part.type, text: part.value }];
  });
}

function Glyph({ position, digit }: { position: MotionValue<number>; digit: number }) {
  const offset = useTransform(position, current => ((((digit - current) % 10) + 15) % 10) - 5);
  const y = useTransform(offset, current => `${current}em`);
  const opacity = useTransform(offset, current => Math.max(0, 1 - Math.abs(current) * 1.2));
  return <motion.span className={styles.glyph} style={{ y, opacity }}>{digit}</motion.span>;
}

function Wheel({ digit, direction, delay, reduceMotion }: { digit: number; direction: number; delay: number; reduceMotion: boolean }) {
  const position = useMotionValue(digit);
  const wheel = useRef({ digit, target: digit });
  useEffect(() => {
    const state = wheel.current;
    if (state.digit === digit) return;
    state.target += direction < 0 ? -((state.digit - digit + 10) % 10) : (digit - state.digit + 10) % 10;
    state.digit = digit;
    if (reduceMotion) { position.jump(state.target); return; }
    const controls = animate(position, state.target, { ...motionTokens.spring.smooth, delay });
    return () => controls.stop();
  }, [delay, digit, direction, position, reduceMotion]);
  return <span className={styles.wheel}>
    <span className={styles.sizer}>0</span>
    {DIGITS.map(item => <Glyph key={item} position={position} digit={item} />)}
  </span>;
}

const columnPresence = { initial: { width: 0, opacity: 0 }, animate: { width: "auto", opacity: 1 }, exit: { width: 0, opacity: 0 } };

/** Digits roll right to left: the ones settle first and each higher place follows a beat later, like a mechanical counter. */
function RollingNumber({ value, formatter, reduceMotion }: { value: number; formatter: Intl.NumberFormat; reduceMotion: boolean }) {
  const [state, setState] = useState({ value, direction: 1 });
  if (state.value !== value) setState({ value, direction: value >= state.value ? 1 : -1 });
  const parts = partsOf(formatter, value);
  const digits = parts.filter(part => "digit" in part).length;
  let seen = 0;
  return <span className={styles.number} aria-hidden="true">
    <AnimatePresence initial={false}>
      {parts.map(part => {
        const transition = reduceMotion ? { duration: 0 } : motionTokens.spring.morph;
        if (!("digit" in part)) return <motion.span key={part.key} className={styles.symbol} {...columnPresence} transition={transition}>{part.text}</motion.span>;
        const delay = (digits - 1 - seen++) * .025;
        return <motion.span key={part.key} className={styles.column} {...columnPresence} transition={transition}><Wheel digit={part.digit} direction={state.direction} delay={delay} reduceMotion={reduceMotion} /></motion.span>;
      })}
    </AnimatePresence>
  </span>;
}

type Formats = { value: Intl.NumberFormat; delta: Intl.NumberFormat; scale: number; suffix: string };

/** Changes read in the metric's own terms: a relative percent by default, points for a rate, or the raw difference with its unit. */
function useFormatters(metrics: readonly TickerMetric[], locale: string) {
  const signature = metrics.map(metric => `${metric.id}:${metric.delta ?? ""}:${JSON.stringify(metric.format ?? {})}`).join("|");
  return useMemo(() => {
    const map = new Map<string, Formats>();
    for (const metric of metrics) {
      const options: Intl.NumberFormatOptions = { maximumFractionDigits: 0, ...metric.format, numberingSystem: "latn" };
      const value = new Intl.NumberFormat(locale, options);
      if (metric.delta !== "absolute") map.set(metric.id, { value, delta: new Intl.NumberFormat(locale, { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1, numberingSystem: "latn" }), scale: 1, suffix: "" });
      else if (options.style === "percent") {
        const digits = value.resolvedOptions().maximumFractionDigits ?? 1;
        map.set(metric.id, { value, delta: new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits, numberingSystem: "latn" }), scale: 100, suffix: " pts" });
      } else map.set(metric.id, { value, delta: new Intl.NumberFormat(locale, { ...options, signDisplay: "never" }), scale: 1, suffix: "" });
    }
    return map;
    // The formatters only depend on each metric's format, not on its value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locale, signature]);
}

/** The recent values drawn as a line with a soft area under it. The line draws itself in when the panel opens. */
function Spark({ values, tone, reduceMotion }: { values: number[]; tone: "up" | "down" | "flat"; reduceMotion: boolean }) {
  const width = 216, height = 56, pad = 4;
  if (values.length < 2) return <svg className={styles.spark} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" />;
  const min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
  const points = values.map((value, index) => [index / (values.length - 1) * width, pad + (1 - (value - min) / span) * (height - pad * 2)] as const);
  const line = points.map(([x, y], index) => `${index ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const area = `${line} L${width} ${height} L0 ${height} Z`;
  const last = points[points.length - 1] ?? [0, 0];
  return <svg className={styles.spark} data-tone={tone} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
    <motion.path className={styles.sparkArea} d={area} initial={reduceMotion ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: motionTokens.duration.considered, ease: motionTokens.ease.standard, delay: reduceMotion ? 0 : .12 }} />
    <motion.path className={styles.sparkLine} d={line} initial={reduceMotion ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: motionTokens.duration.considered, ease: motionTokens.ease.enter }} />
    <motion.circle className={styles.sparkDot} cx={last[0]} cy={last[1]} r={3} initial={reduceMotion ? false : { scale: 0 }} animate={{ scale: 1 }} transition={reduceMotion ? { duration: 0 } : { ...motionTokens.spring.snappy, delay: .42 }} />
  </svg>;
}

export function MetricTicker({
  metrics,
  overflow = "marquee",
  speed = 32,
  flashDuration = 1600,
  historyLength = 24,
  locale = "en-US",
  columns,
  label = "Live metrics",
  className,
  style,
}: MetricTickerProps) {
  const reduceMotion = !!useReducedMotion();
  const panelId = useId();
  const formatters = useFormatters(metrics, locale);

  // History and the latest change per metric, derived as new values arrive.
  const [tape, setTape] = useState<Tape>(() => ({ metrics, history: Object.fromEntries(metrics.map(metric => [metric.id, [metric.value]])), changes: {}, tick: 0 }));
  if (tape.metrics !== metrics) {
    const tick = tape.tick + 1;
    const history = { ...tape.history };
    const changes = { ...tape.changes };
    const before = new Map(tape.metrics.map(metric => [metric.id, metric.value]));
    for (const metric of metrics) {
      const previous = before.get(metric.id);
      if (previous === undefined || previous === metric.value) { history[metric.id] ??= [metric.value]; continue; }
      history[metric.id] = [...(history[metric.id] ?? [previous]), metric.value].slice(-historyLength);
      changes[metric.id] = { delta: metric.value - previous, ratio: previous ? (metric.value - previous) / Math.abs(previous) : 0, tick };
    }
    setTape({ metrics, history, changes, tick });
  }

  // A change is loud for a moment, then settles to a quiet reading of the last move.
  // Every update schedules its own settle, so a steady stream still lets older changes calm down.
  const [settled, setSettled] = useState(0);
  const settleTimers = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(() => {
    if (tape.tick === 0) return;
    const tick = tape.tick;
    const set = settleTimers.current;
    const timer = setTimeout(() => { set.delete(timer); setSettled(current => Math.max(current, tick)); }, flashDuration);
    set.add(timer);
  }, [flashDuration, tape.tick]);
  useEffect(() => {
    const set = settleTimers.current;
    return () => { set.forEach(clearTimeout); set.clear(); };
  }, []);

  // Which metric is open: hover and focus open it for a moment, a click or tap pins it.
  const [hovered, setHovered] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const open = pinned ?? focused ?? hovered;
  const [keyboardFocus, setKeyboardFocus] = useState(false);
  // Hover closes after a short grace period, so the pointer can travel from a metric down into its panel.
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const anchorEl = useRef<HTMLElement | null>(null);
  const hoverOn = (id: string, element?: HTMLElement) => { clearTimeout(hoverTimer.current); if (element) anchorEl.current = element; setHovered(id); };
  const hoverOff = () => { clearTimeout(hoverTimer.current); hoverTimer.current = setTimeout(() => setHovered(null), 160); };
  useEffect(() => () => clearTimeout(hoverTimer.current), []);
  // A pinned panel closes on a press anywhere outside the ticker, or on Escape.
  useEffect(() => {
    if (!pinned) return;
    const onDown = (event: globalThis.PointerEvent) => { if (!root.current?.contains(event.target as Node)) setPinned(null); };
    const onKey = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape") setPinned(null); };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDown); document.removeEventListener("keydown", onKey); };
  }, [pinned]);

  const root = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const group = useRef<HTMLUListElement>(null);
  const [overflowing, setOverflowing] = useState(false);
  useLayoutEffect(() => {
    const port = viewport.current, list = group.current;
    if (!port || !list || typeof ResizeObserver === "undefined") return;
    const measure = () => setOverflowing(list.scrollWidth > port.clientWidth + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(port); observer.observe(list);
    return () => observer.disconnect();
  }, []);
  const marquee = overflowing && overflow === "marquee" && !reduceMotion;

  // Marquee: one loop eases the speed toward its target. Hover and click never pause it (the open panel follows the drifting metric); only keyboard focus holds it still.
  const offset = useMotionValue(0);
  const drive = useRef({ speed: 0, target: 0, drag: null as null | { x: number; last: number; time: number; velocity: number; moved: boolean; id: number }, visible: true, width: 0, seek: null as null | number });
  const x = useTransform(offset, value => {
    const width = drive.current.width;
    return width ? -(((value % width) + width) % width) : 0;
  });
  const holding = focused !== null && keyboardFocus;
  useEffect(() => { drive.current.target = holding ? 0 : speed; }, [holding, speed]);
  useEffect(() => {
    if (!marquee) { offset.set(0); return; }
    const state = drive.current;
    const list = group.current;
    const measure = () => { state.width = (list?.offsetWidth ?? 0); };
    measure();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    if (list) observer?.observe(list);
    const intersection = typeof IntersectionObserver !== "undefined" ? new IntersectionObserver(([entry]) => { state.visible = !!entry?.isIntersecting; }) : null;
    if (viewport.current) intersection?.observe(viewport.current);
    let frame = 0, last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(.05, (now - last) / 1000);
      last = now;
      // Keep the offset inside one lap, so a metric changing width never shifts the strip by more than that change.
      if (state.width && (offset.get() >= state.width || offset.get() < 0)) offset.set(((offset.get() % state.width) + state.width) % state.width);
      if (state.visible && !document.hidden && !state.drag) {
        if (state.seek !== null) {
          // Bring a focused metric into view on the shortest path.
          const gap = state.seek - offset.get();
          offset.set(offset.get() + gap * (1 - Math.exp(-dt * 12)));
          if (Math.abs(gap) < .5) state.seek = null;
          state.speed = 0;
        } else {
          state.speed += (state.target - state.speed) * (1 - Math.exp(-dt * (state.target ? 2.2 : 6)));
          if (Math.abs(state.speed) > .01) offset.set(offset.get() + state.speed * dt);
        }
      }
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(frame); observer?.disconnect(); intersection?.disconnect(); };
  }, [marquee, offset]);

  // Drag the marquee with a finger or mouse; release hands the flick back to the loop, which eases it into the steady drift.
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!marquee || event.button !== 0) return;
    drive.current.drag = { x: event.clientX, last: event.clientX, time: performance.now(), velocity: 0, moved: false, id: event.pointerId };
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = drive.current.drag;
    if (!drag || drag.id !== event.pointerId) return;
    if (!drag.moved && Math.abs(event.clientX - drag.x) < 5) return;
    if (!drag.moved) { drag.moved = true; event.currentTarget.setPointerCapture(event.pointerId); }
    const now = performance.now();
    const dx = event.clientX - drag.last;
    drag.velocity = drag.velocity * .6 + (-dx / Math.max(1, now - drag.time) * 1000) * .4;
    drag.last = event.clientX; drag.time = now;
    offset.set(offset.get() - dx);
  };
  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    const state = drive.current;
    const drag = state.drag;
    if (!drag || drag.id !== event.pointerId) return;
    state.drag = null;
    if (drag.moved) {
      state.speed = Math.max(-1600, Math.min(1600, drag.velocity));
      suppressClick.current = true;
      setTimeout(() => { suppressClick.current = false; }, 0);
    }
  };
  const suppressClick = useRef(false);

  // Arrow keys move between metrics; focus pulls a metric into view.
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const [active, setActive] = useState<string | null>(null);
  const tabStop = active ?? metrics[0]?.id ?? null;
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const keys: Record<string, number> = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: metrics.length - 1 };
    if (event.key === "Escape") { setPinned(null); setFocused(null); return; }
    if (!(event.key in keys)) return;
    event.preventDefault();
    const next = metrics[(keys[event.key]! + metrics.length) % metrics.length];
    if (next) buttons.current.get(next.id)?.focus();
  };
  const reveal = useCallback((id: string) => {
    const button = buttons.current.get(id), port = viewport.current;
    if (!button || !port) return;
    const item = button.parentElement as HTMLElement;
    if (marquee) {
      const width = drive.current.width || 1;
      const current = ((offset.get() % width) + width) % width;
      let target = item.offsetLeft - 24;
      if (target - current > width / 2) target -= width;
      if (current - target > width / 2) target += width;
      drive.current.seek = offset.get() + (target - current);
    } else if (item.offsetLeft < port.scrollLeft || item.offsetLeft + item.offsetWidth > port.scrollLeft + port.clientWidth) {
      port.scrollTo({ left: item.offsetLeft - 16, behavior: reduceMotion ? "auto" : "smooth" });
    }
  }, [marquee, offset, reduceMotion]);

  // The floating panel follows the open metric every frame while it is open: it tracks a drifting strip exactly
  // and glides when the open metric changes, so it reads as one panel moving rather than two swapping.
  const panelX = useMotionValue(0);
  const panelOrigin = useMotionValue("50% 0px");
  const openRef = useRef(open);
  useLayoutEffect(() => { openRef.current = open; }, [open]);
  const isOpen = open !== null;
  useLayoutEffect(() => {
    if (!isOpen) return;
    // The first placement happens before paint with no time step; later frames use their rAF timestamps.
    let frame = 0, first = true, last = -1;
    const place = (now: number) => {
      const id = openRef.current;
      // Anchor to the element that opened it: in a marquee that can be the repeated copy of a metric.
      const held = anchorEl.current;
      const button = held?.isConnected && held.dataset.metric === id ? held : id ? buttons.current.get(id) : undefined, box = root.current;
      if (button && box) {
        const rect = button.getBoundingClientRect(), outer = box.getBoundingClientRect();
        const width = Math.min(PANEL_WIDTH, outer.width);
        const center = rect.left + rect.width / 2 - outer.left;
        const left = Math.max(0, Math.min(outer.width - width, rect.left - outer.left));
        const dt = last < 0 ? 0 : Math.min(.05, (now - last) / 1000);
        if (first || reduceMotion) { panelX.jump(left); panelOrigin.set(`${Math.max(12, Math.min(width - 12, center - left)).toFixed(1)}px 0px`); }
        else panelX.set(panelX.get() + (left - panelX.get()) * (1 - Math.exp(-dt * 16)));
        first = false;
      }
      last = now;
      frame = requestAnimationFrame(place);
    };
    place(-1);
    last = -1;
    return () => cancelAnimationFrame(frame);
  }, [isOpen, panelOrigin, panelX, reduceMotion]);

  const openMetric = open ? metrics.find(metric => metric.id === open) : undefined;

  const renderItems = (copy: boolean) => metrics.map((metric, index) => {
    const format = formatters.get(metric.id);
    if (!format) return null;
    const change = tape.changes[metric.id];
    const direction = change ? Math.sign(change.delta) : 0;
    const good = direction === 0 ? "flat" : (direction > 0) === ((metric.positive ?? "up") === "up") ? "good" : "bad";
    const flashing = !!change && change.tick > settled;
    const deltaAmount = change ? Math.abs(metric.delta === "absolute" ? change.delta : change.ratio) * format.scale : 0;
    const deltaText = change ? `${format.delta.format(deltaAmount)}${format.suffix}` : "";
    const spoken = `${metric.label}, ${format.value.format(metric.value)}${change && direction && metric.delta !== "none" ? `, ${direction > 0 ? "up" : "down"} ${deltaText}` : ""}`;
    return <li key={metric.id} className={styles.item} data-open={open === metric.id || undefined}>
      <button
        ref={copy ? undefined : node => { if (node) buttons.current.set(metric.id, node); else buttons.current.delete(metric.id); }}
        type="button"
        data-metric={metric.id}
        className={styles.button}
        tabIndex={copy ? -1 : tabStop === metric.id ? 0 : -1}
        aria-label={copy ? undefined : spoken}
        aria-expanded={copy ? undefined : open === metric.id}
        aria-controls={copy || open !== metric.id ? undefined : panelId}
        onPointerEnter={event => { if (event.pointerType === "mouse") hoverOn(metric.id, event.currentTarget); }}
        onPointerLeave={event => { if (event.pointerType === "mouse") hoverOff(); }}
        onFocus={event => { if (copy) return; setKeyboardFocus(event.currentTarget.matches(":focus-visible")); anchorEl.current = event.currentTarget; setActive(metric.id); setFocused(metric.id); reveal(metric.id); }}
        onBlur={() => setFocused(current => current === metric.id ? null : current)}
        onClick={event => { if (suppressClick.current) return; anchorEl.current = event.currentTarget; setPinned(current => current === metric.id ? null : metric.id); }}
        onKeyDown={event => onKeyDown(event, index)}
      >
        <span className={styles.label}>{metric.label}</span>
        <span className={styles.reading}>
          <span className={styles.value}><RollingNumber value={metric.value} formatter={format.value} reduceMotion={reduceMotion} /></span>
          {metric.delta !== "none" && <span className={styles.delta} data-tone={good} data-flash={flashing || undefined} data-empty={!change || undefined}>
            <span className={styles.deltaIcon}>
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.span key={direction} className={styles.deltaGlyph} initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: direction > 0 ? 5 : -5 }} animate={{ opacity: 1, y: 0 }} exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: direction > 0 ? -5 : 5 }} transition={reduceMotion ? { duration: 0 } : motionTokens.spring.snappy}>
                  {direction > 0 ? <ArrowUp size={12} strokeWidth={2.25} /> : direction < 0 ? <ArrowDown size={12} strokeWidth={2.25} /> : <Minus size={12} strokeWidth={2.25} />}
                </motion.span>
              </AnimatePresence>
            </span>
            <span className={styles.deltaText}><RollingNumber value={deltaAmount} formatter={format.delta} reduceMotion={reduceMotion} />{format.suffix && <span className={styles.symbol}>{format.suffix}</span>}</span>
            {change && !reduceMotion && <motion.span key={change.tick} className={styles.pulse} initial={{ opacity: .9, scale: .8 }} animate={{ opacity: 0, scale: 1.25 }} transition={{ duration: .7, ease: motionTokens.ease.enter }} />}
          </span>}
        </span>
      </button>
    </li>;
  });

  const history = openMetric ? (openMetric.history ? [...openMetric.history] : tape.history[openMetric.id] ?? []) : [];
  const openFormat = openMetric ? formatters.get(openMetric.id) : undefined;
  const openChange = openMetric ? tape.changes[openMetric.id] : undefined;
  const trend = history.length > 1 ? Math.sign((history[history.length - 1] ?? 0) - (history[0] ?? 0)) : 0;
  const trendTone = trend === 0 ? "flat" : (trend > 0) === ((openMetric?.positive ?? "up") === "up") ? "up" : "down";

  return <div
    ref={root}
    className={[styles.ticker, className].filter(Boolean).join(" ")}
    style={style}
    role="region"
    aria-label={label}
    onPointerLeave={event => { if (event.pointerType === "mouse") hoverOff(); }}
  >
    <div
      ref={viewport}
      className={styles.viewport}
      data-mode={marquee ? "marquee" : overflowing ? "scroll" : "fit"}
      data-fixed={columns ? "" : undefined}
      style={columns ? { "--ticker-columns": columns } as CSSProperties : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <div className={styles.fader}>
        <motion.div className={styles.track} style={{ x }}>
          <ul ref={group} className={styles.group}>{renderItems(false)}</ul>
          {marquee && <ul className={styles.group} aria-hidden="true">{renderItems(true)}</ul>}
        </motion.div>
      </div>
    </div>
    <AnimatePresence>
      {openMetric && openFormat && <motion.div
        key="panel"
        id={panelId}
        className={styles.panel}
        style={{ x: panelX, transformOrigin: panelOrigin }}
        initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -6, scale: .96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -4, scale: .98, transition: { duration: motionTokens.duration.exit, ease: motionTokens.ease.standard } }}
        transition={reduceMotion ? { duration: 0 } : { ...motionTokens.spring.morph, opacity: { duration: motionTokens.duration.fast } }}
        onPointerEnter={event => { if (event.pointerType === "mouse") hoverOn(openMetric.id); }}
        onPointerLeave={event => { if (event.pointerType === "mouse") hoverOff(); }}
      >
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div key={openMetric.id} className={styles.panelBody} initial={reduceMotion ? { opacity: 0 } : { opacity: 0, filter: `blur(${motionTokens.blur.subtle}px)` }} animate={{ opacity: 1, filter: "blur(0px)" }} exit={reduceMotion ? { opacity: 0 } : { opacity: 0, filter: `blur(${motionTokens.blur.subtle}px)` }} transition={{ duration: reduceMotion ? 0 : motionTokens.duration.fast }}>
            <div className={styles.panelHead}>
              <span className={styles.panelLabel}>{openMetric.caption ?? `Last ${history.length} updates`}</span>
              {openChange && <span className={styles.panelChange} data-tone={trendTone}>{trend > 0 ? "Trending up" : trend < 0 ? "Trending down" : "Flat"}</span>}
            </div>
            <Spark values={history} tone={trendTone} reduceMotion={reduceMotion} />
            <dl className={styles.range}>
              <div><dt>Low</dt><dd>{openFormat.value.format(Math.min(...history))}</dd></div>
              <div><dt>High</dt><dd>{openFormat.value.format(Math.max(...history))}</dd></div>
            </dl>
          </motion.div>
        </AnimatePresence>
      </motion.div>}
    </AnimatePresence>
  </div>;
}

export default MetricTicker;
