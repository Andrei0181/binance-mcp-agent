// Офлайн-тест защиты от лимитов на заглушке Binance: заголовок веса, пороги, 429 и 418.
import http from "node:http";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

let hits = 0;
let used = 10;
const mock = http.createServer((req, res) => {
  hits++;
  const u = new URL(req.url, "http://x");
  const sym = u.searchParams.get("symbol");
  res.setHeader("content-type", "application/json");
  res.setHeader("x-mbx-used-weight-1m", String(used));
  if (sym === "LIMITED") { res.setHeader("retry-after", "2"); res.writeHead(429); return res.end(JSON.stringify({ code: -1003, msg: "Too many requests." })); }
  if (sym === "BANNED") { res.setHeader("retry-after", "1"); res.writeHead(418); return res.end(JSON.stringify({ code: -1003, msg: "IP banned." })); }
  res.end(JSON.stringify({ symbol: sym, price: "100.5" }));
});
await new Promise((r) => mock.listen(0, r));
const base = `http://127.0.0.1:${mock.address().port}`;

async function start(env) {
  const client = new Client({ name: "test-guard", version: "1.0.0" });
  await client.connect(new StdioClientTransport({
    command: "node", args: ["build/index.js"], env: { ...process.env, BINANCE_BASE_URL: base, CACHE_TTL_MS: "0", ...env },
  }));
  return client;
}
const price = (c, symbol) => c.callTool({ name: "get_market_price", arguments: { symbol } });
const text = (r) => r.content[0].text;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1. Порог веса: после ответа с весом выше порога следующие вызовы не доходят до биржи
let c = await start({ WEIGHT_GUARD_LIMIT: "100", WEIGHT_WINDOW_MS: "600" });
used = 50; hits = 0;
await price(c, "BTCUSDT"); await price(c, "BTCUSDT");
assert.equal(hits, 2, "ниже порога запросы проходят");
used = 120;
let r = await price(c, "BTCUSDT");
assert.ok(!r.isError); assert.equal(hits, 3);
r = await price(c, "BTCUSDT");
assert.equal(r.isError, true); assert.match(text(r), /порог 100/);
assert.equal(hits, 3, "при превышении порога запрос на биржу не уходит");
await sleep(700);
used = 10;
r = await price(c, "BTCUSDT");
assert.ok(!r.isError); assert.equal(hits, 4, "после окна наблюдение устаревает, запросы возобновляются");
await c.close();

// 2. Порог отключён
c = await start({ WEIGHT_GUARD_LIMIT: "0" });
used = 9999; hits = 0;
for (let i = 0; i < 3; i++) { r = await price(c, "BTCUSDT"); assert.ok(!r.isError); }
assert.equal(hits, 3, "WEIGHT_GUARD_LIMIT=0 отключает порог");
await c.close();

// 3. HTTP 429 с Retry-After
c = await start({});
used = 10; hits = 0;
r = await price(c, "LIMITED");
assert.equal(r.isError, true); assert.equal(hits, 1);
r = await price(c, "BTCUSDT");
assert.equal(r.isError, true); assert.match(text(r), /429\/418/);
assert.equal(hits, 1, "в период блокировки запросы не уходят на биржу");
await sleep(2300);
r = await price(c, "BTCUSDT");
assert.ok(!r.isError); assert.equal(hits, 2, "после Retry-After запросы возобновляются");
await c.close();

// 4. HTTP 418
c = await start({});
hits = 0;
r = await price(c, "BANNED");
assert.equal(r.isError, true);
r = await price(c, "BTCUSDT");
assert.equal(r.isError, true); assert.match(text(r), /429\/418/); assert.equal(hits, 1);
await sleep(1200);
r = await price(c, "BTCUSDT");
assert.ok(!r.isError);
await c.close();

mock.close();
console.log("Защита от лимитов: все проверки пройдены");
