// Две сборки: размещённая страница (dist/) и автономный HTML одним файлом (dist-single/).
import { createHash } from "node:crypto";
import { defineConfig, type Plugin } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import pkg from "./package.json" with { type: "json" };

const single = process.env.OBEZ_SINGLE === "1";

const CSP_BASE = [
  "default-src 'none'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self' data:",
  // главное обещание страницы: из её кода не уходит ни одного сетевого запроса
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "manifest-src 'self'",
];

/** CSP в <meta>: для размещённой страницы скрипты — только свои файлы, для автономной — по хэшам. */
function csp(): Plugin {
  return {
    name: "obez-csp",
    apply: "build",
    enforce: "post",
    generateBundle(_, bundle) {
      for (const f of Object.values(bundle)) {
        if (f.type !== "asset" || !f.fileName.endsWith(".html")) continue;
        let html = String(f.source);
        const hashes = single
          ? [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].filter((m) => m[1]!.trim()).map((m) => `'sha256-${createHash("sha256").update(m[1]!).digest("base64")}'`)
          : [];
        const policy = [...CSP_BASE, `script-src ${single ? hashes.join(" ") : "'self'"}`, `worker-src ${single ? "blob:" : "'self'"}`].join("; ");
        html = html.replace("<!--CSP-->", `<meta http-equiv="Content-Security-Policy" content="${policy}">`);
        f.source = html;
      }
    },
  };
}

/** Service Worker размещённой страницы: кэширует все файлы сборки, дальше страница работает без сети. */
function sw(): Plugin {
  return {
    name: "obez-sw",
    apply: "build",
    generateBundle(_, bundle) {
      if (single) return;
      const files = ["./", ...Object.keys(bundle).map((n) => `./${n}`)];
      const version = createHash("sha256").update(files.join("|") + pkg.version).digest("hex").slice(0, 12);
      this.emitFile({
        type: "asset",
        fileName: "sw.js",
        source: `const C="obez-${version}";const F=${JSON.stringify(files)};
self.addEventListener("install",e=>e.waitUntil(caches.open(C).then(c=>c.addAll(F)).then(()=>self.skipWaiting())));
self.addEventListener("activate",e=>e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==C).map(x=>caches.delete(x)))).then(()=>self.clients.claim())));
self.addEventListener("fetch",e=>{if(e.request.method!=="GET"||new URL(e.request.url).origin!==location.origin)return;e.respondWith(caches.match(e.request,{ignoreSearch:true}).then(r=>r||fetch(e.request)))});`,
      });
    },
  };
}

export default defineConfig({
  root: "web",
  base: "./",
  define: {
    __SINGLE__: JSON.stringify(single),
    __VERSION__: JSON.stringify(pkg.version),
    __STANDALONE_SHA__: JSON.stringify(process.env.STANDALONE_SHA ?? ""),
  },
  // автономный файл открывают с диска (origin null): там Chrome не запускает модульный воркер из blob,
  // поэтому в нём воркер — классический скрипт
  worker: { format: single ? "iife" : "es" },
  build: {
    outDir: single ? "../dist-single" : "../dist",
    emptyOutDir: true,
    target: "es2022",
    assetsInlineLimit: single ? 100_000_000 : 4096,
    chunkSizeWarningLimit: 4000,
  },
  plugins: [...(single ? [viteSingleFile()] : []), sw(), csp()],
});
