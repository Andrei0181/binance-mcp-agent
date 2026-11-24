import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import axios from "axios";

const BASE_URL = process.env.BINANCE_BASE_URL ?? "https://api.binance.com";
const TIMEOUT_MS = 5000;
const rawTtl = process.env.CACHE_TTL_MS;
const CACHE_TTL_MS = rawTtl !== undefined && Number.isFinite(Number(rawTtl)) ? Number(rawTtl) : 2000;
const numEnv = (name: string, def: number) => {
  const v = process.env[name];
  return v !== undefined && v !== "" && Number.isFinite(Number(v)) ? Number(v) : def;
};
const WEIGHT_GUARD_LIMIT = numEnv("WEIGHT_GUARD_LIMIT", 5500); // 0 отключает порог
const WEIGHT_WINDOW_MS = numEnv("WEIGHT_WINDOW_MS", 60000);
const SYMBOL_RE = /^[A-Z0-9]{5,20}$/;
const INTERVALS = ["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "8h", "12h", "1d", "3d", "1w", "1M"];

const symbolProp = {
  type: "string",
  description: "Торговая пара в верхнем регистре (например, BTCUSDT, ETHUSDT)",
};

const TOOLS = [
  {
    name: "get_market_price",
    description: "Текущая цена торговой пары на Binance",
    inputSchema: { type: "object", properties: { symbol: symbolProp }, required: ["symbol"] },
  },
  {
    name: "get_24h_stats",
    description: "Статистика за 24 часа: изменение цены, high/low, объём",
    inputSchema: { type: "object", properties: { symbol: symbolProp }, required: ["symbol"] },
  },
  {
    name: "get_klines",
    description: "Свечи (OHLCV) торговой пары",
    inputSchema: {
      type: "object",
      properties: {
        symbol: symbolProp,
        interval: { type: "string", enum: INTERVALS, description: "Таймфрейм, по умолчанию 1h" },
        limit: { type: "number", description: "Количество свечей 1-100, по умолчанию 24" },
      },
      required: ["symbol"],
    },
  },
  {
    name: "get_order_book",
    description: "Стакан заявок: лучшие bid/ask",
    inputSchema: {
      type: "object",
      properties: {
        symbol: symbolProp,
        limit: { type: "number", description: "Глубина 1-50, по умолчанию 10" },
      },
      required: ["symbol"],
    },
  },
  {
    name: "get_avg_price",
    description: "Средняя цена пары за последние минуты",
    inputSchema: { type: "object", properties: { symbol: symbolProp }, required: ["symbol"] },
  },
  {
    name: "get_server_time",
    description: "Время сервера Binance и расхождение с локальными часами",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "check_symbol",
    description: "Существует ли пара и в каком она статусе",
    inputSchema: { type: "object", properties: { symbol: symbolProp }, required: ["symbol"] },
  },
  {
    name: "get_recent_trades",
    description: "Последние сделки пары (цена, объём, сторона агрессора)",
    inputSchema: {
      type: "object",
      properties: {
        symbol: symbolProp,
        limit: { type: "number", description: "Количество сделок 1-50, по умолчанию 10" },
      },
      required: ["symbol"],
    },
  },
  {
    name: "validate_signal",
    description: "Проверка свежести сигнала: возраст, неблагоприятный дрейф цены относительно цены исполнения (ask для buy, bid для sell) и спред",
    inputSchema: {
      type: "object",
      properties: {
        symbol: symbolProp,
        side: { type: "string", enum: ["buy", "sell"], description: "Сторона сигнала" },
        signal_price: { type: "number", description: "Цена сигнала" },
        signal_timestamp_ms: { type: "number", description: "Время сигнала в миллисекундах Unix" },
        max_age_s: { type: "number", description: "Максимальный возраст сигнала в секундах, по умолчанию 60" },
        max_drift_pct: { type: "number", description: "Максимальный неблагоприятный дрейф в процентах, по умолчанию 0.1" },
        max_spread_pct: { type: "number", description: "Максимальный спред в процентах от mid, по умолчанию 0.1" },
      },
      required: ["symbol", "side", "signal_price", "signal_timestamp_ms"],
    },
  },
];

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };
const ok = (text: string): ToolResult => ({ content: [{ type: "text", text }] });
const fail = (text: string): ToolResult => ({ content: [{ type: "text", text }], isError: true });

function clamp(v: unknown, def: number, min: number, max: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.trunc(n))) : def;
}

class RateLimitError extends Error {}
let usedWeight = 0;
let usedSeenAt = 0;
let blockedUntil = 0;

function guard() {
  const now = Date.now();
  if (blockedUntil > now) {
    throw new RateLimitError(
      "Binance ограничил запросы (HTTP 429/418), повторите через " + Math.ceil((blockedUntil - now) / 1000) + " с."
    );
  }
  if (WEIGHT_GUARD_LIMIT > 0 && usedWeight >= WEIGHT_GUARD_LIMIT && now - usedSeenAt < WEIGHT_WINDOW_MS) {
    throw new RateLimitError(
      "Использовано " + usedWeight + " веса запросов за минуту (порог " + WEIGHT_GUARD_LIMIT +
        "), повторите через " + Math.ceil((WEIGHT_WINDOW_MS - (now - usedSeenAt)) / 1000) + " с."
    );
  }
}

function observe(headers: any, status?: number) {
  const used = Number(headers?.["x-mbx-used-weight-1m"]);
  if (headers?.["x-mbx-used-weight-1m"] !== undefined && Number.isFinite(used)) {
    usedWeight = used;
    usedSeenAt = Date.now();
  }
  if (status === 429 || status === 418) {
    const ra = Number(headers?.["retry-after"]);
    blockedUntil = Date.now() + (Number.isFinite(ra) && ra > 0 ? ra : 60) * 1000;
  }
}

const cache = new Map<string, { expires: number; data: Promise<any> }>();

async function api(path: string, params: Record<string, string | number>, useCache = true) {
  const request = async () => {
    guard();
    try {
      const r = await axios.get(BASE_URL + path, { params, timeout: TIMEOUT_MS });
      observe(r.headers);
      return r.data;
    } catch (e: any) {
      if (e.response) observe(e.response.headers, e.response.status);
      throw e;
    }
  };
  if (!useCache || CACHE_TTL_MS <= 0) return request();

  const key = `${path}?${JSON.stringify(params)}`;
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expires > now) return hit.data;

  if (cache.size >= 200) for (const [k, v] of cache) if (v.expires <= now) cache.delete(k);
  const data = request();
  cache.set(key, { expires: now + CACHE_TTL_MS, data });
  data.catch(() => {
    if (cache.get(key)?.data === data) cache.delete(key); // ошибки не кешируем
  });
  return data;
}

function posNum(v: unknown, def: number): number {
  const n = Number(v);
  return v !== undefined && v !== null && Number.isFinite(n) && n > 0 ? n : def;
}

async function serverTime(): Promise<ToolResult> {
  try {
    const t0 = Date.now();
    const d = await api("/api/v3/time", {}, false);
    const t1 = Date.now();
    const drift = Math.round(d.serverTime - (t0 + t1) / 2);
    return ok(
      `Время сервера Binance: ${new Date(d.serverTime).toISOString()}, ` +
        `расхождение с локальными часами: ${drift} мс (задержка запроса ${t1 - t0} мс)`
    );
  } catch (error: any) {
    return fail(error instanceof RateLimitError ? error.message : "Ошибка сети или таймаут API: " + error.message);
  }
}

async function callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
  if (name === "get_server_time") return serverTime();

  const raw = args.symbol;
  if (typeof raw !== "string" || raw.trim() === "") return fail("Ошибка: не указан параметр symbol.");
  const symbol = raw.trim().toUpperCase();
  if (!SYMBOL_RE.test(symbol)) {
    return fail("Ошибка: symbol должен состоять из 5-20 латинских букв/цифр (например, BTCUSDT).");
  }

  try {
    switch (name) {
      case "get_market_price": {
        const d = await api("/api/v3/ticker/price", { symbol });
        return ok(`Актуальная цена для пары ${d.symbol}: ${d.price}`);
      }
      case "get_24h_stats": {
        const d = await api("/api/v3/ticker/24hr", { symbol });
        return ok(
          `${d.symbol} за 24ч: последняя ${d.lastPrice}, изменение ${d.priceChangePercent}%, ` +
            `high ${d.highPrice}, low ${d.lowPrice}, объём ${d.volume}, объём в котируемой ${d.quoteVolume}`
        );
      }
      case "get_klines": {
        const interval = typeof args.interval === "string" ? args.interval : "1h";
        if (!INTERVALS.includes(interval)) return fail(`Ошибка: interval должен быть одним из: ${INTERVALS.join(", ")}.`);
        const limit = clamp(args.limit, 24, 1, 100);
        const rows: any[][] = await api("/api/v3/klines", { symbol, interval, limit });
        const lines = rows.map(
          (k) => `${new Date(k[0]).toISOString()} O:${k[1]} H:${k[2]} L:${k[3]} C:${k[4]} V:${k[5]}`
        );
        return ok(`Свечи ${symbol} ${interval} (${rows.length}):\n${lines.join("\n")}`);
      }
      case "get_order_book": {
        const limit = clamp(args.limit, 10, 1, 50);
        const d = await api("/api/v3/depth", { symbol, limit });
        const fmt = (side: [string, string][]) => side.map(([p, q]) => `${p} x ${q}`).join("\n");
        return ok(`Стакан ${symbol}\nBids:\n${fmt(d.bids)}\nAsks:\n${fmt(d.asks)}`);
      }
      case "get_avg_price": {
        const d = await api("/api/v3/avgPrice", { symbol });
        return ok(`Средняя цена ${symbol} за ${d.mins} мин: ${d.price}`);
      }
      case "validate_signal": {
        const side = args.side;
        if (side !== "buy" && side !== "sell") return fail("Ошибка: side должен быть buy или sell.");
        const signalPrice = Number(args.signal_price);
        const signalTs = Number(args.signal_timestamp_ms);
        if (!Number.isFinite(signalPrice) || signalPrice <= 0) return fail("Ошибка: signal_price должен быть положительным числом.");
        if (!Number.isFinite(signalTs) || signalTs <= 0) return fail("Ошибка: signal_timestamp_ms должен быть положительным числом.");
        if (signalTs < 1e11) return fail("Ошибка: signal_timestamp_ms должен быть в миллисекундах (значение похоже на секунды).");
        const maxAge = posNum(args.max_age_s, 60);
        const maxDrift = posNum(args.max_drift_pct, 0.1);
        const maxSpread = posNum(args.max_spread_pct, 0.1);

        const d = await api("/api/v3/ticker/bookTicker", { symbol }, false); // всегда свежие bid/ask
        const bid = Number(d.bidPrice);
        const ask = Number(d.askPrice);
        if (!(bid > 0) || !(ask > 0)) return fail("Ошибка: биржа вернула некорректные bid/ask.");
        const mid = (bid + ask) / 2;
        const spreadPct = ((ask - bid) / mid) * 100;
        const executionPrice = side === "buy" ? ask : bid;
        const adverseMovePct = side === "buy"
          ? ((ask - signalPrice) / signalPrice) * 100
          : ((signalPrice - bid) / signalPrice) * 100;
        const now = Date.now();
        const ageS = (now - signalTs) / 1000;

        const reasons: string[] = [];
        if (ageS < -5) reasons.push("время сигнала в будущем (проверь часы или единицы времени)");
        if (ageS > maxAge) reasons.push("возраст сигнала " + ageS.toFixed(1) + " с больше допустимых " + maxAge + " с");
        if (adverseMovePct > maxDrift) reasons.push("цена ушла против сигнала на " + adverseMovePct.toFixed(4) + "% (допустимо " + maxDrift + "%)");
        if (spreadPct > maxSpread) reasons.push("спред " + spreadPct.toFixed(4) + "% больше допустимых " + maxSpread + "%");

        const r4 = (v: number) => Math.round(v * 1e6) / 1e6;
        return ok(JSON.stringify({
          symbol, side,
          signal_price: signalPrice,
          execution_price: executionPrice,
          bid, ask, mid: r4(mid),
          adverse_move_pct: r4(adverseMovePct),
          spread_pct: r4(spreadPct),
          age_s: Math.round(ageS * 10) / 10,
          limits: { max_age_s: maxAge, max_drift_pct: maxDrift, max_spread_pct: maxSpread },
          reasons,
          is_valid: reasons.length === 0,
          checked_at_ms: now,
        }, null, 2));
      }
      case "get_recent_trades": {
        const limit = clamp(args.limit, 10, 1, 50);
        const rows: any[] = await api("/api/v3/trades", { symbol, limit });
        const lines = rows.map(
          (t) =>
            `${new Date(t.time).toISOString()} ${t.isBuyerMaker ? "продажа" : "покупка"} ${t.qty} @ ${t.price}`
        );
        return ok(`Последние сделки ${symbol} (${rows.length}):\n${lines.join("\n")}`);
      }
      case "check_symbol": {
        const d = await api("/api/v3/exchangeInfo", { symbol });
        const info = d.symbols?.[0];
        if (!info) return fail(`Ошибка: пара ${symbol} не найдена.`);
        return ok(
          `${info.symbol}: статус ${info.status}, базовый актив ${info.baseAsset}, ` +
            `котируемый актив ${info.quoteAsset}, спот-торговля ${info.isSpotTradingAllowed ? "разрешена" : "запрещена"}`
        );
      }
      default:
        return fail(`Инструмент ${name} не найден.`);
    }
  } catch (error: any) {
    if (error instanceof RateLimitError) return fail(error.message);
    const code = error.response?.data?.code;
    if (code === -1121) return fail(`Ошибка Binance (-1121): Пара ${symbol} не существует.`);
    if (code !== undefined) return fail(`Ошибка Binance (${code}): ${error.response.data.msg}`);
    return fail(`Ошибка сети или таймаут API: ${error.message}`);
  }
}

const server = new Server({ name: "binance-mcp-agent", version: "1.6.0" }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  if (!TOOLS.some((t) => t.name === req.params.name)) {
    throw new Error(`Инструмент ${req.params.name} не найден.`);
  }
  return callTool(req.params.name, (req.params.arguments ?? {}) as Record<string, unknown>);
});

async function run() {
  await server.connect(new StdioServerTransport());
  console.error("Binance Public MCP Server успешно запущен на stdio каналах!");
}
run().catch((err) => {
  console.error("Критическая ошибка запуска:", err);
  process.exit(1);
});
