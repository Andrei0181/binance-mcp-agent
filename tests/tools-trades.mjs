// Офлайн-тест get_recent_trades на локальной заглушке Binance.
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
  if (u.pathname === "/api/v3/trades") {
    const n = Number(u.searchParams.get("limit"));
    return res.end(JSON.stringify(Array.from({ length: n }, (_, i) => ({
      id: i, price: "100.5", qty: "0.01", quoteQty: "1.005", time: 1700000000000 + i * 1000, isBuyerMaker: i % 2 === 0, isBestMatch: true,
    }))));
  }
  res.writeHead(404); res.end("{}");
});
await new Promise((r) => mock.listen(0, r));
const base = `http://127.0.0.1:${mock.address().port}`;

const client = new Client({ name: "test-trades", version: "1.0.0" });
await client.connect(new StdioClientTransport({
  command: "node", args: ["build/index.js"], env: { ...process.env, BINANCE_BASE_URL: base },
}));
const call = (args) => client.callTool({ name: "get_recent_trades", arguments: args });
const text = (r) => r.content[0].text;

let r = await call({ symbol: "btcusdt", limit: 4 });
assert.ok(!r.isError); assert.match(text(r), /BTCUSDT \(4\)/);
assert.match(text(r), /продажа 0.01 @ 100.5/); assert.match(text(r), /покупка 0.01 @ 100.5/);

r = await call({ symbol: "BTCUSDT" });
assert.match(text(r), /\(10\)/, "по умолчанию 10 сделок");
r = await call({ symbol: "BTCUSDT", limit: 9999 });
assert.match(text(r), /\(50\)/, "limit ограничивается 50");
assert.ok(hits.at(-1).includes("limit=50"));

r = await call({ symbol: "INVALIDCOIN" });
assert.equal(r.isError, true); assert.match(text(r), /-1121/);

const before = hits.length;
for (const args of [{}, { symbol: "BTC&limit=1" }, { symbol: "../x" }]) {
  r = await call(args);
  assert.equal(r.isError, true);
}
assert.equal(hits.length, before, "невалидные символы не должны доходить до API");

await client.close(); mock.close();
console.log("get_recent_trades: все проверки пройдены");
