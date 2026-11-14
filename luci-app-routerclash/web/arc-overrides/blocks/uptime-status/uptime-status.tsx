"use client";

import { memo, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type Ref } from "react";
import { AnimatePresence, LayoutGroup, motion, useIsPresent, useMotionValue, useReducedMotion, useSpring } from "motion/react";
import { TriangleAlert } from "lucide-react";
import { t } from "@/lib/i18n";
import { AnimatedCounter } from "../../animated-counter/animated-counter";
import { Badge } from "../../badge/badge";
import { motionTokens } from "../../lib/motion-tokens";
import { BAR_HEIGHT, DIP, SLOTS, STATUS_LABEL, clockOf, uptimeOf, type RoundStatus, type UptimeRound, type UptimeService } from "./uptime-data";
import styles from "./uptime-status.module.css";

const { spring, duration, ease } = motionTokens;
const enterEase = [...ease.enter] as [number, number, number, number];
const standardEase = [...ease.standard] as [number, number, number, number];
/** The round tooltip trails the pointer by a short, critically damped beat and retargets on every move. */
const follow = { visualDuration: .16, bounce: 0 };
const TIP_W = 256;
const LAST = SLOTS - 1;
const clamp = (value: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, value));
const cx = (...names: (string | false | undefined)[]) => names.filter(Boolean).join(" ");
const describe = (round: UptimeRound) => t(`${round.ok}/${round.total} 个节点可用`, `${round.ok} of ${round.total} nodes up`);
/** Short histories sit at the right edge, so the latest round always lines up across rows. */
const slotsOf = (rounds: UptimeRound[]): (UptimeRound | null)[] => [...Array<null>(Math.max(0, SLOTS - rounds.length)).fill(null), ...rounds.slice(-SLOTS)];
const isHealthy = (service: UptimeService) => service.rounds.at(-1)?.status === "operational";

/** Measured content width. ResizeObserver reports once on observe, so the first measure needs no effect-time state. */
function useWidth<T extends HTMLElement>(fallback: number) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => { const next = Math.round(entry.contentRect.width); if (next) setWidth(next); });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/** Outgoing copies are hidden from assistive tech while they leave. The ref lets popLayout measure the leaving copy. */
function Phrase({ children, reduce, ref }: { children: ReactNode; reduce: boolean; ref?: Ref<HTMLSpanElement> }) {
  const present = useIsPresent();
  return <motion.span ref={ref} className={styles.swapText} aria-hidden={present ? undefined : true}
    initial={reduce ? { opacity: 0 } : { opacity: 0, y: "0.3em" }} animate={{ opacity: 1, y: "0em" }}
    exit={reduce ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, y: "-0.25em", transition: { duration: duration.fast, ease: standardEase } }}
    transition={reduce ? { duration: 0 } : { duration: duration.standard, ease: enterEase }}>{children}</motion.span>;
}

/** Changing copy rises in while the old line lifts away out of flow. */
function Swap({ text, className }: { text: string; className?: string }) {
  const reduce = !!useReducedMotion();
  return <span className={cx(styles.swap, className)}><AnimatePresence mode="popLayout" initial={false}><Phrase key={text} reduce={reduce}>{text}</Phrase></AnimatePresence></span>;
}

/** Severity as a small bar that dips like the round bars, so the legend and tooltip share one shape. */
function StatusMark({ status }: { status: RoundStatus }) {
  const height = Math.round(14 * DIP[status]);
  return <svg className={styles.mark} data-status={status} width="8" height="14" viewBox="0 0 8 14" aria-hidden="true"><rect x="0" y={14 - height} width="8" height={height} rx="1.5" /></svg>;
}

/** A check whose two strokes travel into an exclamation mark: the short stroke shrinks to the dot, the long one stands up. */
const GLYPH = { ok: [[6.1, 10.3, 8.8, 13], [8.8, 13, 14, 7.4]], warn: [[10, 14.1, 10, 14.1], [10, 5.8, 10, 10.9]] };
function StatusGlyph({ degraded }: { degraded: boolean }) {
  const reduce = useReducedMotion();
  const lines = degraded ? GLYPH.warn : GLYPH.ok;
  return <svg className={styles.glyph} viewBox="0 0 20 20" aria-hidden="true">
    <circle cx="10" cy="10" r="10" />
    {lines.map(([x1, y1, x2, y2], index) => <motion.line key={index} initial={false} animate={{ x1, y1, x2, y2 }} transition={reduce ? { duration: 0 } : { ...spring.morph, delay: index * .04 }} />)}
  </svg>;
}

export function UptimeStatus({ services, footer }: { services: UptimeService[]; footer?: ReactNode }) {
  const titleId = useId();
  const unhealthy = services.filter(service => !isHealthy(service)).length;
  const latest = Math.max(...services.map(service => service.rounds.at(-1)?.time ?? 0));
  return <section className={styles.root} aria-labelledby={titleId}>
    <header className={styles.status} data-state={unhealthy ? "degraded" : "operational"}>
      <StatusGlyph degraded={unhealthy > 0} />
      <div className={styles.statusText}>
        <h2 id={titleId} className={styles.title}><Swap text={unhealthy ? t(`${unhealthy} 个策略组有异常节点`, `${unhealthy} groups have failing nodes`) : t("所有策略组运行正常", "All proxy groups are healthy")} /></h2>
        <p className={styles.statusDetail}><span>{t("节点可用性", "Node availability")}</span><span aria-hidden="true">·</span><Swap text={t(`最近一次测速 ${clockOf(latest)}`, `Last tested ${clockOf(latest)}`)} /></p>
      </div>
    </header>
    <UptimePanel services={services} footer={footer} />
  </section>;
}

type Tip = { service: string; slot: number; width: number };

function UptimePanel({ services, footer }: { services: UptimeService[]; footer?: ReactNode }) {
  const reduce = !!useReducedMotion();
  const groupId = useId(), headId = useId();
  const panelRef = useRef<HTMLElement>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  const [live, setLive] = useState("");
  const tipX = useMotionValue(0), tipY = useMotionValue(0);
  const springX = useSpring(tipX, follow), springY = useSpring(tipY, follow);
  const rows = useMemo(() => services.map(service => ({ service, slots: slotsOf(service.rounds), uptime: uptimeOf(service.rounds) })), [services]);

  function inspect(row: (typeof rows)[number], slot: number, strip: HTMLElement, center: number, keyboard: boolean) {
    const panel = panelRef.current;
    if (!panel) return;
    const outer = panel.getBoundingClientRect(), rect = strip.getBoundingClientRect();
    const width = Math.min(TIP_W, outer.width - 16);
    const x = Math.round(clamp(rect.left - outer.left + center - width / 2, 8, outer.width - width - 8)), y = Math.round(rect.top - outer.top - 8);
    tipX.set(x); tipY.set(y);
    // A tooltip that appears starts over its bar; only later moves glide.
    if (!tip) { springX.jump(x); springY.jump(y); }
    setTip({ service: row.service.id, slot, width });
    const round = row.slots[slot];
    if (keyboard) setLive(round ? `${clockOf(round.time)}: ${STATUS_LABEL[round.status]}, ${describe(round)}` : t("这一轮没有记录", "No test recorded for this round"));
  }

  const active = tip ? rows.find(row => row.service.id === tip.service) : undefined;
  const round = active && tip ? active.slots[tip.slot] : undefined;
  return <section ref={panelRef} className={styles.panel} aria-labelledby={headId}>
    <div className={styles.panelHead}>
      <div>
        <h3 id={headId}>{t("可用性", "Availability")}</h3>
        <p>{t(`每根柱是一轮测速，最多保留最近 ${SLOTS} 轮`, `Each bar is one test round, up to the last ${SLOTS}`)}</p>
      </div>
      <ul className={styles.legend} aria-label={t("图例", "Legend")}>
        {(["operational", "degraded", "outage"] as const).map(status => <li key={status}><StatusMark status={status} />{STATUS_LABEL[status]}</li>)}
      </ul>
    </div>
    <LayoutGroup id={groupId}>
      <div className={styles.rows}>
        {rows.map(row => <ServiceRow key={row.service.id} {...row} hover={tip?.service === row.service.id ? tip.slot : null} reduce={reduce}
          onInspect={(index, strip, center, keyboard) => inspect(row, index, strip, center, keyboard)} onLeave={() => setTip(null)} />)}
      </div>
    </LayoutGroup>
    <div className={styles.axis} aria-hidden="true"><span>{t("更早", "Earlier")}</span><span>{t("最新", "Latest")}</span></div>
    {footer}
    <AnimatePresence>
      {tip && active && <motion.div key="tip" className={styles.tip} aria-hidden="true" style={{ x: reduce ? tipX : springX, y: reduce ? tipY : springY, width: tip.width }}
        initial={{ opacity: 0, scale: .97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: .98, transition: { duration: duration.instant, ease: standardEase } }}
        transition={reduce ? { duration: 0 } : { duration: duration.fast, ease: enterEase }}>
        {round
          ? <>
              <div className={styles.tipHead}><span>{active.service.name} · {clockOf(round.time)}</span><span className={styles.num}>{Math.round(round.ok / round.total * 100)}%</span></div>
              <div className={styles.tipStatus}><StatusMark status={round.status} />{STATUS_LABEL[round.status]}</div>
              <p className={styles.tipEmpty}>{describe(round)}{round.delay ? t(`，中位延迟 ${round.delay} ms`, `, median ${round.delay} ms`) : ""}</p>
            </>
          : <p className={styles.tipEmpty}>{t("这一轮没有记录", "No test recorded for this round")}</p>}
      </motion.div>}
    </AnimatePresence>
    <p className={styles.srOnly} aria-live="polite">{live}</p>
  </section>;
}

function barLayout(width: number) {
  const gap = width < 420 ? 2 : 4, pitch = (width + gap) / SLOTS;
  return Array.from({ length: SLOTS }, (_, index) => { const x = Math.round(index * pitch); return { x, w: Math.max(1, Math.round((index + 1) * pitch - gap) - x) }; });
}

type Bar = { x: number; w: number };
const statusOf = (round: UptimeRound | null) => round?.status ?? "unknown";
/** Bars sit in a flipped group, so a bad round dips from the top by animating height alone. Memoized so hovering never re-renders the row. */
const Bars = memo(function Bars({ slots, bars, reduce }: { slots: (UptimeRound | null)[]; bars: Bar[]; reduce: boolean }) {
  return <g className={styles.bars}>
    {slots.map((round, index) => <motion.rect key={index} className={styles.bar} data-status={statusOf(round)} x={bars[index].x} y={0} width={bars[index].w} rx={2}
      initial={false} animate={{ height: Math.round(BAR_HEIGHT * DIP[statusOf(round)]) }} transition={reduce ? { duration: 0 } : spring.morph} />)}
  </g>;
});

type RowProps = { service: UptimeService; slots: (UptimeRound | null)[]; uptime: number; hover: number | null; reduce: boolean; onInspect: (slot: number, strip: HTMLElement, center: number, keyboard: boolean) => void; onLeave: () => void };

function ServiceRow({ service, slots, uptime, hover, reduce, onInspect, onLeave }: RowProps) {
  const summaryId = useId();
  const [stripRef, width] = useWidth<HTMLDivElement>(640);
  const bars = useMemo(() => barLayout(width), [width]);

  function inspect(slot: number, keyboard: boolean) {
    const strip = stripRef.current;
    if (!strip) return;
    const scale = strip.getBoundingClientRect().width / width;
    onInspect(slot, strip, (bars[slot].x + bars[slot].w / 2) * scale, keyboard);
  }
  const slotAt = (clientX: number, strip: HTMLElement) => { const rect = strip.getBoundingClientRect(); return clamp(Math.floor((clientX - rect.left) / rect.width * SLOTS), 0, LAST); };
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const current = hover ?? LAST;
    const moves: Record<string, number> = { ArrowLeft: current - 1, ArrowRight: current + 1, Home: 0, End: LAST };
    if (event.key === "Escape") return onLeave();
    if (!(event.key in moves)) return;
    event.preventDefault();
    inspect(clamp(moves[event.key], 0, LAST), true);
  }

  const lit = hover === null ? undefined : slots[hover];
  const healthy = isHealthy(service);
  return <div className={styles.row}>
    <div className={styles.rowHead}>
      <span className={styles.rowName}>{service.name}<span className={styles.rowDetail}>{service.detail}</span></span>
      {healthy ? <span className={styles.srOnly}>{STATUS_LABEL.operational}</span> : <Badge size="sm" tone="warning" icon={<TriangleAlert size={12} strokeWidth={2} />}>{t("异常", "Failing")}</Badge>}
      <span className={styles.rowUptime}><span className={styles.num}><AnimatedCounter value={uptime} decimals={1} suffix="%" /></span><span className={styles.rowUptimeLabel}>{t("可用", "up")}</span></span>
    </div>
    <div ref={stripRef} className={styles.strip} tabIndex={0} role="group" aria-label={t(`${service.name} 最近的测速结果`, `${service.name}, recent test rounds`)} aria-describedby={summaryId} data-active={lit ? "" : undefined}
      onPointerMove={event => inspect(slotAt(event.clientX, event.currentTarget), false)} onPointerDown={event => inspect(slotAt(event.clientX, event.currentTarget), false)}
      onPointerLeave={onLeave} onBlur={onLeave} onKeyDown={onKeyDown}
      onFocus={event => { if (event.currentTarget.matches(":focus-visible")) inspect(hover ?? LAST, true); }}>
      <svg width="100%" height={BAR_HEIGHT} viewBox={`0 0 ${width} ${BAR_HEIGHT}`} preserveAspectRatio="none" aria-hidden="true">
        <g transform={`matrix(1 0 0 -1 0 ${BAR_HEIGHT})`}>
          <Bars slots={slots} bars={bars} reduce={reduce} />
          {lit && hover !== null && <rect className={styles.bar} data-status={lit.status} data-lit="" x={bars[hover].x} y={0} width={bars[hover].w} height={Math.round(BAR_HEIGHT * DIP[lit.status])} rx={2} />}
        </g>
      </svg>
      <span id={summaryId} className={styles.srOnly}>{t(`可用率 ${uptime.toFixed(1)}%，方向键逐轮查看。`, `${uptime.toFixed(1)}% available. Use the arrow keys to inspect each round.`)}</span>
    </div>
  </div>;
}
