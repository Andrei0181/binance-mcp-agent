// Офлайн-тест кеша: попадания, срок жизни, ошибки, объединение параллельных запросов, отключение.
import http from "node:http";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

let hits = [];
const mock = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  hits.push(u.pathname + "?" + u.searchParams.get("symbol"));
  const sym = u.searchParams.get("symbol");
  setTimeout(() => {
    res.setHeader("content-type", "application/json");
    if (sym === "INVALIDCOIN") { res.writeHead(400); return res.end(JSON.stringify({ code: -1121, msg: "Invalid symbol." })); }
    if (u.pathname === "/api/v3/time") return res.end(JSON.stringify({ serverTime: Date.now() }));
    return res.end(JSON.stringify({ symbol: sym, price: "100.5" }));
  }, 50);
});
await new Promise((r) => mock.listen(0, r));
const base = `http://127.0.0.1:${mock.address().port}`;

async function start(ttl) {
  const client = new Client({ name: "test-cache", version: "1.0.0" });
  await client.connect(new StdioClientTransport({
    command: "node", args: ["build/index.js"], env: { ...process.env, BINANCE_BASE_URL: base, CACHE_TTL_MS: String(ttl) },
  }));
  return client;
}
const price = (c, symbol) => c.callTool({ name: "get_market_price", arguments: { symbol } });
const count = (p) => hits.filter((h) => h.startsWith(p)).length;

let c = await start(400);

await price(c, "BTCUSDT"); await price(c, "BTCUSDT");
assert.equal(count("/api/v3/ticker/price"), 1, "повторный запрос должен идти из кеша");

await price(c, "ETHUSDT");
assert.equal(count("/api/v3/ticker/price"), 2, "другая пара кешируется отдельно");

await new Promise((r) => setTimeout(r, 500));
await price(c, "BTCUSDT");
assert.equal(count("/api/v3/ticker/price"), 3, "после истечения TTL запрос идёт на биржу");

hits = [];
await Promise.all([price(c, "SOLUSDT"), price(c, "SOLUSDT"), price(c, "SOLUSDT")]);
assert.equal(hits.length, 1, "параллельные одинаковые запросы объединяются");

hits = [];
let r1 = await price(c, "INVALIDCOIN"); let r2 = await price(c, "INVALIDCOIN");
assert.equal(r1.isError, true); assert.equal(r2.isError, true);
assert.equal(hits.length, 2, "ошибки не кешируются");

hits = [];
await c.callTool({ name: "get_server_time", arguments: {} });
await c.callTool({ name: "get_server_time", arguments: {} });
assert.equal(hits.length, 2, "get_server_time не кешируется");
await c.close();

c = await start(0);
hits = [];
await price(c, "BTCUSDT"); await price(c, "BTCUSDT");
assert.equal(hits.length, 2, "CACHE_TTL_MS=0 отключает кеш");
await c.close();

mock.close();
console.log("Кеш: все проверки пройдены");
