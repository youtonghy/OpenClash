"use client";

import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import { motion, useMotionValue, useReducedMotion, useSpring } from "motion/react";
import { bytes } from "@/lib/api";
import { t } from "@/lib/i18n";
import type { Connection } from "@/lib/mihomo";
import { motionTokens } from "../../lib/motion-tokens";
import { CITIES, HQ, N, REGIONS, exitCity, publishTotals, pushTx, resetFeed } from "./globe-data";
import { GlobeEngine, type Focus } from "./globe-engine";
import styles from "./revenue-globe.module.css";

const { spring, duration } = motionTokens;
const TIP_WIDTH = 216;
const ARC_WINDOW = 3.5;
const MAX_ARCS = 4;
const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";
const subscribeReduced = (onChange: () => void) => {
  const query = window.matchMedia(REDUCED_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
};
const usePrefersReducedMotion = () => useSyncExternalStore(subscribeReduced, () => window.matchMedia(REDUCED_QUERY).matches, () => false);
const percent = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);
const sizeOf = (connection: Connection) => connection.upload + connection.download;

function summarize(connections: Connection[]) {
  const traffic = new Array<number>(N).fill(0);
  const counts = new Array<number>(N).fill(0);
  let unknown = 0;
  for (const connection of connections) {
    const city = exitCity(connection.chains?.[0] ?? "DIRECT");
    if (city === null) { unknown += 1; continue; }
    traffic[city] += sizeOf(connection);
    counts[city] += 1;
  }
  const regions = REGIONS.map((_, r) => CITIES.reduce((sum, city, i) => sum + (i !== HQ && city.region === r ? traffic[i] : 0), 0));
  const top = CITIES.map((_, i) => i).filter(i => i !== HQ && counts[i] > 0).sort((a, b) => traffic[b] - traffic[a]).slice(0, 5);
  const proxied = regions.reduce((sum, value) => sum + value, 0);
  return { traffic, counts, regions, top, proxied, direct: traffic[HQ], unknown, places: CITIES.filter((_, i) => i !== HQ && counts[i] > 0).length };
}

/** Where live traffic exits: a dotted globe with arcs from each exit back home, built on the Arc revenue globe. */
export function TrafficGlobe({ connections }: { connections: Connection[] }) {
  const reduce = usePrefersReducedMotion();
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const [focus, setFocus] = useState<Focus>(null);
  const [tip, setTip] = useState<{ city: number | null; shown: boolean }>({ city: null, shown: false });
  const [announcement, setAnnouncement] = useState("");
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<GlobeEngine | null>(null);
  const seen = useRef(new Map<string, number>());
  const anchorX = useMotionValue(0);
  const anchorY = useMotionValue(0);
  const tipX = useSpring(anchorX, spring.responsive);
  const tipY = useSpring(anchorY, spring.responsive);
  const motionOff = useReducedMotion();
  const live = useMemo(() => summarize(connections), [connections]);

  useEffect(() => {
    const canvas = canvasRef.current, host = hostRef.current;
    if (!canvas || !host) return;
    let lastTip = { city: null as number | null, shown: false };
    resetFeed();
    const engine = new GlobeEngine(canvas, host, reduce, {
      tick: () => {},
      frame: () => {},
      mode: () => {},
      hover: () => {},
      focus: next => {
        setFocus(next);
        setAnnouncement(!next ? t("已取消选择", "Selection cleared") : next.kind === "city" ? CITIES[next.index].name : REGIONS[next.index].name);
      },
      anchor: (city, x, y, shown) => {
        const width = host.clientWidth;
        const nextX = Math.min(Math.max(x, TIP_WIDTH / 2 + 12), width - TIP_WIDTH / 2 - 12);
        const nextY = Math.max(y, 132);
        const appearing = shown && (!lastTip.shown || lastTip.city === null);
        if (appearing) { anchorX.jump(nextX); anchorY.jump(nextY); tipX.jump(nextX); tipY.jump(nextY); }
        else if (shown) { anchorX.set(nextX); anchorY.set(nextY); }
        if (city !== lastTip.city || shown !== lastTip.shown) { lastTip = { city, shown }; setTip(lastTip); }
      },
    });
    engineRef.current = engine;
    return () => { engine.destroy(); engineRef.current = null; };
  }, [reduce, anchorX, anchorY, tipX, tipY]);

  // Each update becomes a few arcs per place: one for new traffic plus one per new connection.
  useEffect(() => {
    publishTotals(live.traffic, live.counts, live.regions, live.top);
    const engine = engineRef.current;
    if (!engine) return;
    const growth = new Array<number>(N).fill(0);
    const fresh = new Array<number>(N).fill(0);
    const next = new Map<string, number>();
    for (const connection of connections) {
      const size = sizeOf(connection);
      const before = seen.current.get(connection.id);
      next.set(connection.id, size);
      const city = exitCity(connection.chains?.[0] ?? "DIRECT");
      if (city === null) continue;
      growth[city] += size - (before ?? 0);
      if (before === undefined) fresh[city] += 1;
    }
    seen.current = next;
    const clock = engine.live;
    pushTx(clock, growth.flatMap((amount, city) => {
      const arcs = Math.min(MAX_ARCS, fresh[city] + (amount > 0 ? 1 : 0));
      return Array.from({ length: arcs }, () => ({ t: clock + Math.random() * ARC_WINDOW, city, amount: Math.max(1024, amount / arcs) }));
    }));
  }, [connections, live]);

  const engine = () => engineRef.current;
  const select = (next: Focus) => engine()?.select(next);
  const isFocused = (kind: "city" | "region", index: number) => focus?.kind === kind && focus.index === index;
  const onGlobeKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const moves: Record<string, [number, number]> = { ArrowLeft: [1, 0], ArrowRight: [-1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (event.key in moves) { engine()?.nudge(...moves[event.key]); event.preventDefault(); }
    else if (event.key === "Escape") engine()?.clearFocus();
  };

  const total = live.proxied + live.direct;
  const tipCity = tip.city;
  const summary = t(`代理流量 ${bytes(live.proxied)}，直连 ${bytes(live.direct)}，经过 ${live.places} 个出口地区。`, `${bytes(live.proxied)} proxied and ${bytes(live.direct)} direct across ${live.places} exit places.`);
  const reveal = { duration: motionOff ? 0 : duration.fast };

  return <section className={styles.root} aria-labelledby={`${uid}-title`}>
    <header className={styles.header}>
      <div className={styles.heading}>
        <h2 id={`${uid}-title`} className={styles.title}>{t("流量地球", "Traffic globe")}</h2>
        <p className={styles.lede}>{t("根据节点名称判断出口地区，弧线从出口回到本地。拖动旋转，点击地区可飞过去。", "Exit places come from node names, and arcs travel from each exit back home. Drag to spin, pick a place to fly there.")}</p>
      </div>
      {live.unknown > 0 && <p className={styles.meta}>{t(`${live.unknown} 条连接的节点名没有地区信息`, `${live.unknown} connections use nodes with no place in their name`)}</p>}
    </header>

    <div className={styles.stage}>
      <div className={styles.viz}>
        <div ref={hostRef} className={styles.globe} role="region" aria-roledescription={t("可交互地球", "interactive globe")} aria-label={t("流量地球，方向键旋转，Esc 取消选择。", "Traffic globe. Arrow keys spin it, Escape clears the selection.")} aria-describedby={`${uid}-summary`} tabIndex={0} onKeyDown={onGlobeKey}>
          <canvas ref={canvasRef} className={styles.canvas} aria-hidden="true" />
          <motion.div className={styles.tip} style={{ x: tipX, y: tipY, width: TIP_WIDTH }} initial={false} animate={tip.shown && tipCity !== null ? { opacity: 1, scale: 1 } : { opacity: 0, scale: .96 }} transition={motionOff ? { duration: 0 } : { opacity: reveal, scale: spring.snappy }} aria-hidden="true">
            {tipCity !== null && <>
              <div className={styles.tipHead}>
                <span className={styles.tipName}>{CITIES[tipCity].name}</span>
                <span className={styles.tipMeta}>{tipCity === HQ ? t("直连流量", "Direct traffic") : REGIONS[CITIES[tipCity].region].name}</span>
              </div>
              <dl className={styles.tipStats}>
                <div><dt>{t("流量", "Traffic")}</dt><dd>{bytes(live.traffic[tipCity])}</dd></div>
                <div><dt>{t("连接", "Connections")}</dt><dd>{live.counts[tipCity]}</dd></div>
                <div><dt>{t("占比", "Share")}</dt><dd>{percent(live.traffic[tipCity], total)}%</dd></div>
              </dl>
            </>}
          </motion.div>
          <p id={`${uid}-summary`} className={styles.srOnly}>{summary}</p>
        </div>
      </div>

      <aside className={styles.panel} aria-label={t("流量概况", "Traffic summary")}>
        <div className={styles.kpi}>
          <span className={styles.kpiLabel}>{t("代理流量", "Proxied traffic")}</span>
          <span className={styles.kpiValue}><span className={styles.ticker}>{bytes(live.proxied)}</span></span>
          <div className={styles.stats}>
            <div className={styles.stat}><span className={styles.statLabel}>{t("直连", "Direct")}</span><span className={styles.statValue}><span className={styles.ticker}>{bytes(live.direct)}</span></span></div>
            <div className={styles.stat}><span className={styles.statLabel}>{t("出口地区", "Exit places")}</span><span className={styles.statValue}><span className={styles.ticker}>{live.places}</span></span></div>
          </div>
        </div>

        <div className={styles.group}>
          <div className={styles.groupHead}><h3>{t("区域", "Regions")}</h3><span>{t("占代理流量", "Share of proxied")}</span></div>
          <ul className={styles.list}>
            {REGIONS.map((region, r) => <li key={region.id}>
              <button type="button" className={styles.row} aria-pressed={isFocused("region", r)} onClick={() => select({ kind: "region", index: r })}>
                <span className={styles.rowHead}>
                  <span className={styles.rowName}>{region.name}<span className={styles.rowMeta}>{percent(live.regions[r], live.proxied)}%</span></span>
                  <span className={styles.rowValue}><span className={styles.ticker}>{bytes(live.regions[r])}</span></span>
                </span>
                <span className={styles.bar} aria-hidden="true"><span className={styles.track}><motion.span className={styles.fill} initial={false} animate={{ scaleX: live.proxied ? live.regions[r] / live.proxied : 0 }} transition={motionOff ? { duration: 0 } : spring.smooth} /></span></span>
              </button>
            </li>)}
          </ul>
        </div>

        <div className={styles.group}>
          <div className={styles.groupHead}><h3>{t("主要出口", "Top exits")}</h3><span>{t("当前连接", "Live")}</span></div>
          {live.top.length === 0
            ? <p className={styles.meta}>{t("暂无经过代理的连接", "No proxied connections yet")}</p>
            : <ol className={styles.list}>
                {live.top.map(i => <li key={i}>
                  <button type="button" className={`${styles.row} ${styles.cityRow}`} aria-pressed={isFocused("city", i)} onClick={() => select({ kind: "city", index: i })} onFocus={() => engine()?.peek(i)} onBlur={() => engine()?.peek(null)} onPointerMove={() => engine()?.peek(i)} onPointerLeave={() => engine()?.peek(null)}>
                    <span className={styles.rowName}>{CITIES[i].name}<span className={styles.rowMeta}>{t(`${live.counts[i]} 条连接`, `${live.counts[i]} connections`)}</span></span>
                    <span className={styles.rowValue}><span className={styles.ticker}>{bytes(live.traffic[i])}</span></span>
                  </button>
                </li>)}
              </ol>}
        </div>
      </aside>
    </div>
    <p className={styles.srOnly} aria-live="polite">{announcement}</p>
  </section>;
}
