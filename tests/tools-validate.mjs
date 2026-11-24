// Офлайн-тест validate_signal на локальной заглушке Binance.
import http from "node:http";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

let hits = [];
const mock = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  hits.push(u.pathname);
  const sym = u.searchParams.get("symbol");
  res.setHeader("content-type", "application/json");
  if (sym === "INVALIDCOIN") { res.writeHead(400); return res.end(JSON.stringify({ code: -1121, msg: "Invalid symbol." })); }
  if (u.pathname === "/api/v3/ticker/bookTicker") {
    if (sym === "WIDEUSDT") return res.end(JSON.stringify({ symbol: sym, bidPrice: "100.00", bidQty: "1", askPrice: "101.00", askQty: "1" }));
    return res.end(JSON.stringify({ symbol: sym, bidPrice: "100.00", bidQty: "1", askPrice: "100.08", askQty: "1" }));
  }
  res.writeHead(404); res.end("{}");
});
await new Promise((r) => mock.listen(0, r));
const base = `http://127.0.0.1:${mock.address().port}`;

const client = new Client({ name: "test-validate", version: "1.0.0" });
await client.connect(new StdioClientTransport({ command: "node", args: ["build/index.js"], env: { ...process.env, BINANCE_BASE_URL: base } }));
const call = (args) => client.callTool({ name: "validate_signal", arguments: args });
const parse = (r) => JSON.parse(r.content[0].text);
const now = () => Date.now();

// 1. Свежий сигнал на покупку без неблагоприятного дрейфа: валиден, числа это числа
let r = await call({ symbol: "btcusdt", side: "buy", signal_price: 100.05, signal_timestamp_ms: now() - 5000 });
assert.ok(!r.isError); let o = parse(r);
assert.equal(o.is_valid, true); assert.deepEqual(o.reasons, []);
assert.equal(typeof o.adverse_move_pct, "number"); assert.equal(typeof o.spread_pct, "number"); assert.equal(typeof o.age_s, "number");
assert.equal(o.execution_price, 100.08, "для buy исполнение по ask");
assert.ok(Math.abs(o.adverse_move_pct - 0.03) < 0.001, String(o.adverse_move_pct));
assert.ok(Math.abs(o.spread_pct - 0.08) < 0.001);

// 2. buy: цена ушла вверх против сигнала
r = await call({ symbol: "BTCUSDT", side: "buy", signal_price: 99.5, signal_timestamp_ms: now() - 1000 });
o = parse(r); assert.equal(o.is_valid, false); assert.ok(o.reasons.some((x) => x.includes("против сигнала"))); assert.ok(o.adverse_move_pct > 0.5);

// 3. sell: исполнение по bid; дрейф против продавца и в его пользу
r = await call({ symbol: "BTCUSDT", side: "sell", signal_price: 100.5, signal_timestamp_ms: now() - 1000 });
o = parse(r); assert.equal(o.execution_price, 100.0); assert.equal(o.is_valid, false); assert.ok(o.adverse_move_pct > 0.4);
r = await call({ symbol: "BTCUSDT", side: "sell", signal_price: 99.95, signal_timestamp_ms: now() - 1000 });
o = parse(r); assert.ok(o.adverse_move_pct < 0, "в пользу продавца знак отрицательный"); assert.equal(o.is_valid, true);

// 4. Возраст: по умолчанию 60 с, настраивается
r = await call({ symbol: "BTCUSDT", side: "buy", signal_price: 100.05, signal_timestamp_ms: now() - 120000 });
o = parse(r); assert.equal(o.is_valid, false); assert.ok(o.reasons.some((x) => x.includes("возраст")));
r = await call({ symbol: "BTCUSDT", side: "buy", signal_price: 100.05, signal_timestamp_ms: now() - 120000, max_age_s: 300 });
assert.equal(parse(r).is_valid, true);

// 5. Широкий спред
r = await call({ symbol: "WIDEUSDT", side: "buy", signal_price: 101, signal_timestamp_ms: now() - 1000 });
o = parse(r); assert.equal(o.is_valid, false); assert.ok(o.reasons.some((x) => x.includes("спред")));
r = await call({ symbol: "WIDEUSDT", side: "buy", signal_price: 101, signal_timestamp_ms: now() - 1000, max_spread_pct: 2 });
assert.equal(parse(r).is_valid, true);

// 6. Время в будущем
r = await call({ symbol: "BTCUSDT", side: "buy", signal_price: 100.05, signal_timestamp_ms: now() + 60000 });
o = parse(r); assert.equal(o.is_valid, false); assert.ok(o.reasons.some((x) => x.includes("в будущем")));

// 7. Некорректные входные данные: ошибка без обращения к бирже
hits = [];
for (const args of [
  { symbol: "BTCUSDT", side: "hold", signal_price: 100, signal_timestamp_ms: now() },
  { symbol: "BTCUSDT", side: "buy", signal_price: -1, signal_timestamp_ms: now() },
  { symbol: "BTCUSDT", side: "buy", signal_price: "abc", signal_timestamp_ms: now() },
  { symbol: "BTCUSDT", side: "buy", signal_price: 100, signal_timestamp_ms: Math.floor(now() / 1000) },
  { symbol: "BTCUSDT", side: "buy", signal_price: 100 },
  { symbol: "BTC&x=1", side: "buy", signal_price: 100, signal_timestamp_ms: now() },
  { side: "buy", signal_price: 100, signal_timestamp_ms: now() },
]) {
  r = await call(args);
  assert.equal(r.isError, true, JSON.stringify(args));
}
assert.equal(hits.length, 0, "некорректные входы не должны доходить до биржи");

// 8. Неизвестная пара: ошибка Binance -1121
r = await call({ symbol: "INVALIDCOIN", side: "buy", signal_price: 100, signal_timestamp_ms: now() });
assert.equal(r.isError, true); assert.match(r.content[0].text, /-1121/);

// 9. bookTicker не кешируется: два быстрых вызова это два запроса к бирже
hits = [];
await call({ symbol: "BTCUSDT", side: "buy", signal_price: 100.05, signal_timestamp_ms: now() });
await call({ symbol: "BTCUSDT", side: "buy", signal_price: 100.05, signal_timestamp_ms: now() });
assert.equal(hits.filter((h) => h.endsWith("bookTicker")).length, 2, "проверка свежести не должна использовать кеш");

await client.close(); mock.close();
console.log("validate_signal: все проверки пройдены");
