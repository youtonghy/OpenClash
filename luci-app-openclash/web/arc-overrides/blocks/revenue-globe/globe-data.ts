import { t } from "@/lib/i18n";

export type City = { name: string; country: string; lat: number; lon: number; tz: number; region: number; weight: number };
export type Tx = { id: number; t: number; city: number; amount: number };
export type Snapshot = {
  t: number; total: number; count: number; lastHour: number;
  regions: number[]; cityRevenue: number[]; cityCount: number[]; top: number[];
};

export const REGIONS: { id: string; name: string }[] = [
  { id: "americas", name: t("美洲", "Americas") }, { id: "emea", name: t("欧洲、中东和非洲", "EMEA") }, { id: "apac", name: t("亚太", "Asia Pacific") },
];

// iso, zh, en, lat, lon, utc offset, region, name keywords, standalone codes. Earlier rows win, so places named inside others come first.
type Exit = [string, string, string, number, number, number, number, string, string];
const EXITS: Exit[] = [
  ["HK", "香港", "Hong Kong", 22.32, 114.17, 8, 2, "香港|港[0-9]|Hong ?Kong", "HK|HKG"],
  ["TW", "台湾", "Taiwan", 25.03, 121.57, 8, 2, "台湾|台灣|台北|Taiwan|Taipei", "TW|TWN"],
  ["JP", "日本", "Japan", 35.68, 139.69, 9, 2, "日本|东京|東京|大阪|Japan|Tokyo|Osaka", "JP|JPN"],
  ["SG", "新加坡", "Singapore", 1.35, 103.82, 8, 2, "新加坡|狮城|獅城|Singapore", "SG|SGP"],
  ["KR", "韩国", "South Korea", 37.57, 126.98, 9, 2, "韩国|韓國|首尔|首爾|春川|Korea|Seoul", "KR|KOR"],
  ["US", "美国", "United States", 37.77, -122.42, -8, 0, "美国|美國|洛杉矶|硅谷|西雅图|纽约|芝加哥|United States|America|Los Angeles|Seattle|New York", "US|USA"],
  ["CA", "加拿大", "Canada", 43.65, -79.38, -5, 0, "加拿大|多伦多|温哥华|Canada|Toronto|Vancouver", "CA|CAN"],
  ["MX", "墨西哥", "Mexico", 19.43, -99.13, -6, 0, "墨西哥|Mexico", "MX|MEX"],
  ["BR", "巴西", "Brazil", -23.55, -46.63, -3, 0, "巴西|圣保罗|Brazil|Sao Paulo", "BR|BRA"],
  ["AR", "阿根廷", "Argentina", -34.6, -58.38, -3, 0, "阿根廷|Argentina", "AR|ARG"],
  ["CL", "智利", "Chile", -33.45, -70.67, -4, 0, "智利|Chile", "CL|CHL"],
  ["GB", "英国", "United Kingdom", 51.51, -0.13, 0, 1, "英国|英國|伦敦|倫敦|United Kingdom|Britain|London", "UK|GB|GBR"],
  ["DE", "德国", "Germany", 50.11, 8.68, 1, 1, "德国|德國|法兰克福|Germany|Frankfurt", "DE|DEU"],
  ["FR", "法国", "France", 48.86, 2.35, 1, 1, "法国|法國|巴黎|France|Paris", "FR|FRA"],
  ["NL", "荷兰", "Netherlands", 52.37, 4.9, 1, 1, "荷兰|荷蘭|阿姆斯特丹|Netherlands|Amsterdam", "NL|NLD"],
  ["IE", "爱尔兰", "Ireland", 53.35, -6.26, 0, 1, "爱尔兰|愛爾蘭|Ireland|Dublin", "IE|IRL"],
  ["CH", "瑞士", "Switzerland", 47.38, 8.54, 1, 1, "瑞士|Switzerland|Zurich", "CH|CHE"],
  ["SE", "瑞典", "Sweden", 59.33, 18.07, 1, 1, "瑞典|Sweden|Stockholm", "SE|SWE"],
  ["NO", "挪威", "Norway", 59.91, 10.75, 1, 1, "挪威|Norway|Oslo", "NO|NOR"],
  ["FI", "芬兰", "Finland", 60.17, 24.94, 2, 1, "芬兰|芬蘭|Finland|Helsinki", "FI|FIN"],
  ["IT", "意大利", "Italy", 45.46, 9.19, 1, 1, "意大利|义大利|Italy|Milan", "IT|ITA"],
  ["ES", "西班牙", "Spain", 40.42, -3.7, 1, 1, "西班牙|Spain|Madrid", "ES|ESP"],
  ["PL", "波兰", "Poland", 52.23, 21.01, 1, 1, "波兰|波蘭|Poland|Warsaw", "PL|POL"],
  ["UA", "乌克兰", "Ukraine", 50.45, 30.52, 2, 1, "乌克兰|烏克蘭|Ukraine|Kyiv", "UA|UKR"],
  ["RU", "俄罗斯", "Russia", 55.76, 37.62, 3, 1, "俄罗斯|俄羅斯|莫斯科|Russia|Moscow", "RU|RUS"],
  ["TR", "土耳其", "Turkey", 41.01, 28.98, 3, 1, "土耳其|Turkey|Türkiye|Istanbul", "TR|TUR"],
  ["AE", "阿联酋", "UAE", 25.2, 55.27, 4, 1, "阿联酋|阿聯酋|迪拜|Dubai|Emirates", "AE|UAE|ARE"],
  ["IL", "以色列", "Israel", 32.09, 34.78, 2, 1, "以色列|Israel", "IL|ISR"],
  ["ZA", "南非", "South Africa", -26.2, 28.05, 2, 1, "南非|South Africa|Johannesburg", "ZA|ZAF"],
  ["NG", "尼日利亚", "Nigeria", 6.52, 3.38, 1, 1, "尼日利亚|Nigeria", "NG|NGA"],
  ["IN", "印度", "India", 19.08, 72.88, 5.5, 2, "印度(?!尼)|India|Mumbai", "IN|IND"],
  ["ID", "印尼", "Indonesia", -6.21, 106.85, 7, 2, "印尼|印度尼西亚|Indonesia|Jakarta", "ID|IDN"],
  ["MY", "马来西亚", "Malaysia", 3.14, 101.69, 8, 2, "马来西亚|馬來西亞|吉隆坡|Malaysia", "MY|MYS"],
  ["TH", "泰国", "Thailand", 13.76, 100.5, 7, 2, "泰国|泰國|曼谷|Thailand|Bangkok", "TH|THA"],
  ["VN", "越南", "Vietnam", 10.82, 106.63, 7, 2, "越南|胡志明|Vietnam", "VN|VNM"],
  ["PH", "菲律宾", "Philippines", 14.6, 120.98, 8, 2, "菲律宾|菲律賓|马尼拉|Philippines|Manila", "PH|PHL"],
  ["KH", "柬埔寨", "Cambodia", 11.56, 104.92, 7, 2, "柬埔寨|Cambodia", "KH|KHM"],
  ["KZ", "哈萨克斯坦", "Kazakhstan", 43.24, 76.89, 5, 2, "哈萨克|Kazakhstan", "KZ|KAZ"],
  ["AU", "澳大利亚", "Australia", -33.87, 151.21, 10, 2, "澳大利亚|澳洲|悉尼|墨尔本|Australia|Sydney|Melbourne", "AU|AUS"],
  ["NZ", "新西兰", "New Zealand", -36.85, 174.76, 12, 2, "新西兰|紐西蘭|New Zealand|Auckland", "NZ|NZL"],
  ["CN", "中国", "China", 31.23, 121.47, 8, 2, "中国|中國|上海|北京|广州|深圳|China|Shanghai|Beijing", "CN|CHN"],
];

/** The router has no coordinates of its own, so home is placed from the browser's time zone. */
const offset = -new Date().getTimezoneOffset() / 60;
const home: City = { name: t("本地", "Home"), country: "", lat: 30, lon: Math.max(-180, Math.min(180, offset * 15)), tz: offset, region: offset < -2 ? 0 : offset < 5 ? 1 : 2, weight: 1 };

export const CITIES: City[] = [home, ...EXITS.map(([iso, zh, en, lat, lon, tz, region]) => ({ name: t(zh, en), country: iso, lat, lon, tz, region, weight: 1 }))];
export const HQ = 0;
/** The engine stops its live clock at DAY, and a live feed has no end of day. */
export const DAY = Number.MAX_SAFE_INTEGER;
export const NOW = 0;
export const N = CITIES.length;

const matchers = EXITS.map(([, , , , , , , words, codes]) => ({ words: new RegExp(words, "i"), codes: new RegExp(`(?<![A-Za-z])(?:${codes})(?![A-Za-z])`) }));
const byIso = new Map(EXITS.map(([iso], index) => [iso, index + 1]));
const known = new Map<string, number | null>();

function locate(node: string) {
  const flag = node.match(/[\u{1F1E6}-\u{1F1FF}]{2}/u)?.[0];
  if (flag) {
    const iso = String.fromCharCode(...[...flag].map(letter => (letter.codePointAt(0) as number) - 0x1f1e6 + 65));
    const city = byIso.get(iso === "UK" ? "GB" : iso);
    if (city) return city;
  }
  const index = matchers.findIndex(({ words, codes }) => words.test(node) || codes.test(node));
  return index === -1 ? null : index + 1;
}

/** The place a node exits from, read from the flag or region in its name. Null when the name gives none away. */
export function exitCity(node: string): number | null {
  if (node === "DIRECT") return HQ;
  if (!known.has(node)) known.set(node, locate(node));
  return known.get(node) as number | null;
}

let feed: Tx[] = [];
let nextId = 0;
let snapshot: Snapshot = { t: 0, total: 0, count: 0, lastHour: 0, regions: REGIONS.map(() => 0), cityRevenue: new Array(N).fill(0), cityCount: new Array(N).fill(0), top: [] };

export function resetFeed() {
  feed = [];
  nextId = 0;
}

/** Queues arcs for the engine and drops the ones it has long since passed. */
export function pushTx(clock: number, arcs: { t: number; city: number; amount: number }[]) {
  feed = feed.filter(tx => tx.t > clock - 30).concat(arcs.map(arc => ({ ...arc, id: nextId++ }))).slice(-300);
}

export function publishTotals(bytes: number[], counts: number[], regions: number[], top: number[]) {
  snapshot = { ...snapshot, total: bytes.reduce((sum, value) => sum + value, 0), count: counts.reduce((sum, value) => sum + value, 0), regions, cityRevenue: bytes, cityCount: counts, top };
}

export const snapshotAt = (time: number, _pending?: unknown): Snapshot => ({ ...snapshot, t: time });

/** Visits every arc with a time in (from, to]. */
export function forEachTx(from: number, to: number, visit: (tx: Tx) => void) {
  for (const tx of feed) if (tx.t > from && tx.t <= to) visit(tx);
}

/** The largest arcs in the window before `t`, newest first. Used for the still frame. */
export function largestBefore(time: number, window: number, count: number) {
  return feed.filter(tx => tx.t > time - window && tx.t <= time && tx.city !== HQ).sort((a, b) => b.amount - a.amount).slice(0, count);
}
