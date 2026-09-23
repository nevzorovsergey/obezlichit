// obezlichit — обезличивание PDF в Node (тот же код, что на странице).
//   npm run cli -- постановление.pdf акт.pdf -o out/ [--show]
// Файлы одного комплекта передаются вместе: у них будет общая таблица подмен.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { applyPlan, makePlan, originalsOf } from "./core/obezlichit";
import { selfcheck } from "./core/selfcheck";

const args = process.argv.slice(2);
const show = args.includes("--show");
const oi = args.indexOf("-o");
const outDir = oi >= 0 ? args[oi + 1]! : "obezlichit-out";
const files = args.filter((a, i) => a.endsWith(".pdf") && args[i - 1] !== "-o");
if (!files.length) {
  console.error("Использование: obezlichit файл.pdf [файл.pdf …] [-o каталог] [--show]");
  process.exit(2);
}

const mask = (v: string): string => (show ? v : v.length <= 4 ? "•••" : v.slice(0, 2) + "•".repeat(Math.min(8, v.length - 4)) + v.slice(-2));

const plan = await makePlan(files.map((f) => ({ name: basename(f), bytes: new Uint8Array(readFileSync(f)) })));
for (const f of plan.files) if (!f.hasText) console.error(`${f.name}: текста в файле нет (скан или фото) — пока не поддерживается`);
console.log("Подмены:");
for (const s of plan.substitutions.values()) console.log(`  ${s.kind.padEnd(9)} ×${String(s.count).padEnd(3)} ${mask(s.original)} → ${s.replacement}`);

const out = await applyPlan(plan);
const originals = originalsOf(plan);
mkdirSync(outDir, { recursive: true });
const counters = new Map<string, number>();
let ok = true;
for (const o of out) {
  const stem = o.docType === "resolution" ? "postanovlenie" : o.docType === "act" ? "akt" : "dokument";
  const n = (counters.get(stem) ?? 0) + 1;
  counters.set(stem, n);
  const name = `${stem}-${n}.pdf`;
  const check = await selfcheck(o.bytes, originals);
  ok &&= check.ok;
  const r = o.report;
  console.log(`${o.name} → ${name}: заменено ${r.replaced}, коды ${r.codes.redrawn}, фото ${r.images.pixelated}` +
    (r.unencodable.length ? `, нет глифов: ${r.unencodable.length}` : "") +
    ` · самопроверка: ${check.ok ? "чисто" : "НАЙДЕНЫ ОСТАТКИ " + JSON.stringify(check.leaks)}`);
  if (check.ok) writeFileSync(join(outDir, name), o.bytes);
}
process.exit(ok ? 0 : 1);
