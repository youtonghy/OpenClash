import { t } from "@/lib/i18n";

export type RoundStatus = "operational" | "degraded" | "outage";
/** One test round: every node of the group that was probed at about the same time. */
export type UptimeRound = { status: RoundStatus; time: number; ok: number; total: number; delay?: number };
export type UptimeService = { id: string; name: string; detail: string; rounds: UptimeRound[] };

/** mihomo keeps the last ten results per node, so a strip never holds more rounds than this. */
export const SLOTS = 10;
export const STATUS_LABEL: Record<RoundStatus, string> = { operational: t("正常", "Healthy"), degraded: t("部分异常", "Degraded"), outage: t("全部超时", "All timed out") };
export const BAR_HEIGHT = 34;
export const DIP: Record<RoundStatus | "unknown", number> = { operational: 1, degraded: .64, outage: .34, unknown: .16 };

export const uptimeOf = (rounds: UptimeRound[]) => {
  const total = rounds.reduce((sum, round) => sum + round.total, 0);
  return total ? Math.round(rounds.reduce((sum, round) => sum + round.ok, 0) / total * 1e4) / 100 : 0;
};
export const clockOf = (time: number) => new Date(time).toLocaleTimeString();
