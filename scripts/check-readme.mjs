// Сверяет README.md с кодом: инструменты, эндпоинты, переменные окружения, тесты, скрипты.
import { readFileSync, existsSync, readdirSync } from "node:fs";

const read = (p) => readFileSync(p, "utf8");
const readme = read("README.md");
const code = read("src/index.ts");
const pkg = JSON.parse(read("package.json"));
const problems = [];

const tools = [...code.matchAll(/\{\s*name: "([a-z0-9_]+)",\s*description:/g)].map((m) => m[1]);
if (tools.length === 0) problems.push("в src/index.ts не найден ни один инструмент");
for (const t of tools) {
  if (!readme.includes("`" + t + "`")) problems.push(`инструмент ${t} не описан в таблице инструментов`);
  if (!new RegExp("^\\| " + t + "\\b", "m").test(readme)) problems.push(`инструмент ${t} отсутствует в таблице весов`);
}

for (const m of code.matchAll(/"(\/api\/v3\/[A-Za-z0-9/]+)"/g)) {
  if (!readme.includes(m[1])) problems.push(`эндпоинт ${m[1]} не упомянут в README`);
}

for (const m of code.matchAll(/process\.env\.([A-Z_]+)|numEnv\("([A-Z_]+)"/g)) {
  const v = m[1] ?? m[2];
  if (!readme.includes(v)) problems.push(`переменная окружения ${v} не описана в README`);
}

const testFiles = existsSync("tests") ? readdirSync("tests").filter((f) => f.endsWith(".mjs")) : [];
for (const f of testFiles) {
  if (!readme.includes("tests/" + f)) problems.push(`тест tests/${f} не упомянут в README`);
}
for (const m of readme.matchAll(/(?:tests|scripts|docs)\/[A-Za-z0-9._-]+\.(?:mjs|md)/g)) {
  if (!existsSync(m[0])) problems.push(`README ссылается на несуществующий файл ${m[0]}`);
}

for (const m of readme.matchAll(/npm run ([a-z:-]+)/g)) {
  if (!pkg.scripts?.[m[1]]) problems.push(`README упоминает npm run ${m[1]}, но такого скрипта нет в package.json`);
}

if (problems.length) {
  console.error("README не совпадает с кодом:\n- " + problems.join("\n- "));
  process.exit(1);
}
console.log(`README совпадает с кодом: инструментов ${tools.length}, тестов ${testFiles.length}`);
