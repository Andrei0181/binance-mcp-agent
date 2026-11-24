// Офлайн-тест новых инструментов: get_avg_price, get_server_time, check_symbol.
import http from "node:http";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const hits = [];
const mock = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  hits.push(req.url);
  const sym = u.searchParams.get("symbol");
  res.setHeader("content-type", "application/json");
  if (sym === "INVALIDCOIN") { res.writeHead(400); return res.end(JSON.stringify({ code: -1121, msg: "Invalid symbol." })); }
  if (u.pathname === "/api/v3/avgPrice") return res.end(JSON.stringify({ mins: 5, price: "100.25", closeTime: 1 }));
  if (u.pathname === "/api/v3/time") return res.end(JSON.stringify({ serverTime: Date.now() + 40 }));
  if (u.pathname === "/api/v3/exchangeInfo") {
    if (sym === "GHOSTUSDT") return res.end(JSON.stringify({ symbols: [] }));
    return res.end(JSON.stringify({ symbols: [{ symbol: sym, status: "TRADING", baseAsset: "BTC", quoteAsset: "USDT", isSpotTradingAllowed: true }] }));
  }
  res.writeHead(404); res.end("{}");
});
await new Promise((r) => mock.listen(0, r));
const base = `http://127.0.0.1:${mock.address().port}`;

const client = new Client({ name: "test-extra", version: "1.0.0" });
await client.connect(new StdioClientTransport({
  command: "node", args: ["build/index.js"], env: { ...process.env, BINANCE_BASE_URL: base },
}));
const call = (name, args) => client.callTool({ name, arguments: args });
const text = (r) => r.content[0].text;

let r = await call("get_avg_price", { symbol: "btcusdt" });
assert.match(text(r), /BTCUSDT за 5 мин: 100.25/); assert.ok(!r.isError);
r = await call("get_avg_price", { symbol: "INVALIDCOIN" });
assert.equal(r.isError, true); assert.match(text(r), /-1121/);

r = await call("get_server_time", {});
assert.match(text(r), /Время сервера Binance: \d{4}-\d\d-\d\dT/); assert.ok(!r.isError);
const drift = Number(text(r).match(/расхождение с локальными часами: (-?\d+) мс/)[1]);
assert.ok(Math.abs(drift - 40) < 200, `ожидали около 40 мс, получили ${drift}`);

r = await call("check_symbol", { symbol: "BTCUSDT" });
assert.match(text(r), /статус TRADING/); assert.match(text(r), /спот-торговля разрешена/);
r = await call("check_symbol", { symbol: "GHOSTUSDT" });
assert.equal(r.isError, true); assert.match(text(r), /не найдена/);
r = await call("check_symbol", { symbol: "INVALIDCOIN" });
assert.equal(r.isError, true); assert.match(text(r), /-1121/);

const before = hits.length;
for (const tool of ["get_avg_price", "check_symbol"]) {
  r = await call(tool, { symbol: "BTC&x=1" });
  assert.equal(r.isError, true);
  r = await call(tool, {});
  assert.equal(r.isError, true);
}
assert.equal(hits.length, before, "невалидные символы не должны доходить до API");

await client.close(); mock.close();
console.log("Новые инструменты: все проверки пройдены");
