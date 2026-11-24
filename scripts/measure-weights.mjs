// Измеряет реальный вес запросов Spot REST по заголовку x-mbx-used-weight-1m
// и сохраняет результат в docs/rate-limits.md.
import { writeFile, mkdir } from "node:fs/promises";

const BASE = process.env.BINANCE_BASE_URL ?? "https://api.binance.com";
const HEADER = "x-mbx-used-weight-1m";

async function hit(path) {
  const res = await fetch(`${BASE}${path}`);
  const used = res.headers.get(HEADER);
  if (res.status >= 400) throw new Error(`${path}: HTTP ${res.status}`);
  if (used === null) throw new Error(`${path}: нет заголовка ${HEADER}`);
  return { used: Number(used), body: await res.json() };
}

const targets = [
  "/api/v3/ticker/price?symbol=BTCUSDT",
  "/api/v3/ticker/24hr?symbol=BTCUSDT",
  "/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=24",
  "/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=100",
  "/api/v3/depth?symbol=BTCUSDT&limit=10",
  "/api/v3/depth?symbol=BTCUSDT&limit=50",
  "/api/v3/depth?symbol=BTCUSDT&limit=100",
  "/api/v3/avgPrice?symbol=BTCUSDT",
  "/api/v3/time",
  "/api/v3/exchangeInfo?symbol=BTCUSDT",
  "/api/v3/trades?symbol=BTCUSDT&limit=10",
  "/api/v3/ticker/bookTicker?symbol=BTCUSDT",
];

const info = await hit("/api/v3/exchangeInfo?symbol=BTCUSDT");
const rows = [];
for (const path of targets) {
  let weight = null;
  for (let attempt = 0; attempt < 3 && weight === null; attempt++) {
    const before = await hit("/api/v3/ping"); // базовая линия
    const after = await hit(path);
    const d = after.used - before.used;
    if (d > 0) weight = d; // d <= 0: окно в 1 минуту сбросилось, повторяем
  }
  rows.push({ path, weight: weight ?? "не удалось измерить" });
}

const md = [
  "# Лимиты и веса Spot REST (измерено)",
  "",
  `Дата измерения: ${new Date().toISOString()}`,
  `Хост: ${BASE}`,
  `Метод: разница заголовка ${HEADER} до и после запроса.`,
  "",
  "| Запрос | Вес |",
  "|---|---|",
  ...rows.map((r) => `| \`${r.path}\` | ${r.weight} |`),
  "",
  "## rateLimits из exchangeInfo",
  "",
  "```json",
  JSON.stringify(info.body.rateLimits, null, 2),
  "```",
  "",
].join("\n");

await mkdir("docs", { recursive: true });
await writeFile("docs/rate-limits.md", md);
console.log(md);
