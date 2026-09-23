// Сборка: сначала автономный HTML, его SHA-256 — в подвал размещённой страницы; файл кладётся рядом.
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";

const run = (cmd, env = {}) => execSync(cmd, { stdio: "inherit", env: { ...process.env, ...env } });
run("npx vite build", { OBEZ_SINGLE: "1" });
const single = readFileSync("dist-single/index.html");
const sha = createHash("sha256").update(single).digest("hex");
run("npx vite build", { STANDALONE_SHA: sha });
copyFileSync("dist-single/index.html", "dist/obezlichit.html");
writeFileSync("dist/obezlichit.html.sha256", `${sha}  obezlichit.html\n`);
console.log(`obezlichit.html  ${(single.length / 1024 / 1024).toFixed(2)} МБ  sha256 ${sha}`);
