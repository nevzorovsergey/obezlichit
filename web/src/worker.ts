// Всё обезличивание — в этом воркере: главный поток занят только интерфейсом.
// pdf.js работает здесь же, в том же потоке («fake worker»), без вложенных воркеров.
import * as pdfjsWorker from "pdfjs-dist/legacy/build/pdf.worker.mjs";
import { PDFDict, PDFDocument, PDFName, PDFRawStream } from "pdf-lib";
import { addManual, applyPlan, makePlan, originalsOf, type Plan, type Substitution } from "../../src/core/obezlichit";
import { setFallbackLoader } from "../../src/core/pdf/fallback";
import { pageModel } from "../../src/core/pdf/rewrite";
import { codeClusters, decodeCluster, filledRectPaths } from "../../src/core/graphics/codes";
import { classify } from "../../src/core/graphics/images";
import { selfcheck } from "../../src/core/selfcheck";
import type { FileInfo, Request, Response, SubView } from "./protocol";

(globalThis as unknown as { pdfjsWorker: unknown }).pdfjsWorker = pdfjsWorker;

// запасной шрифт — отдельный модуль, грузится только если в шрифте документа не хватило букв
setFallbackLoader(async () => (await import("./fallback-fonts")).fonts());

const MAX_BYTES = 20 * 1024 * 1024;
const MAX_PAGES = 30;

let plan: Plan | null = null;

const view = (s: Substitution): SubView => ({
  key: s.key, kind: s.kind, original: s.original, variants: s.variants, replacement: s.replacement, count: s.count, enabled: s.enabled,
});

async function inspect(bytes: Uint8Array): Promise<{ codes: number; photos: number }> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  let codes = 0, photos = 0;
  const seen = new Set<string>();
  for (const p of doc.getPages()) {
    codes += codeClusters(filledRectPaths(pageModel(doc, p).toks)).filter((c) => decodeCluster(c)).length;
    const xo = p.node.Resources()?.lookup(PDFName.of("XObject"));
    if (xo instanceof PDFDict) for (const [, ref] of xo.entries()) {
      const s = doc.context.lookup(ref);
      if (!(s instanceof PDFRawStream) || seen.has(ref.toString())) continue;
      seen.add(ref.toString());
      const w = s.dict.lookup(PDFName.of("Width"))?.toString(), h = s.dict.lookup(PDFName.of("Height"))?.toString();
      if (w && h && classify(Number(w), Number(h))) photos++;
    }
  }
  return { codes, photos };
}

async function handle(req: Request): Promise<Response> {
  switch (req.type) {
    case "analyze": {
      const infos: FileInfo[] = [];
      const ok: Array<{ name: string; bytes: Uint8Array }> = [];
      for (const f of req.files) {
        const info: FileInfo = { name: f.name, pages: 0, docType: "other", codes: 0, photos: 0 };
        try {
          if (f.bytes.length > MAX_BYTES) { info.error = "too_big"; infos.push(info); continue; }
          const doc = await PDFDocument.load(f.bytes, { updateMetadata: false });
          info.pages = doc.getPageCount();
          if (info.pages > MAX_PAGES) { info.error = "too_big"; infos.push(info); continue; }
          Object.assign(info, await inspect(f.bytes));
          ok.push(f);
        } catch (e) {
          info.error = /encrypt/i.test(String(e)) ? "encrypted" : "unreadable";
        }
        infos.push(info);
      }
      plan = ok.length ? await makePlan(ok) : null;
      for (const pf of plan?.files ?? []) {
        const info = infos.find((i) => i.name === pf.name && !i.error)!;
        info.docType = pf.docType;
        if (!pf.hasText) info.error = "no_text";
      }
      if (plan) plan.files = plan.files.filter((f) => f.hasText);
      return { type: "analyzed", files: infos, subs: plan ? [...plan.substitutions.values()].map(view) : [] };
    }
    case "update": {
      for (const u of req.subs) {
        const s = plan?.substitutions.get(u.key);
        if (s) { s.replacement = u.replacement; s.enabled = u.enabled; }
      }
      return { type: "updated" };
    }
    case "manual": {
      const s = plan ? await addManual(plan, req.value) : null;
      return { type: "manual", sub: s ? view(s) : null };
    }
    case "apply": {
      if (!plan) return { type: "error", message: "nothing" };
      const outs = await applyPlan(plan, { keepPhotos: req.keepPhotos });
      const originals = originalsOf(plan);
      const results = [];
      for (const o of outs) results.push({ name: o.name, docType: o.docType, bytes: o.bytes, report: o.report, check: await selfcheck(o.bytes, originals) });
      return { type: "applied", results };
    }
    case "reset": plan = null; return { type: "updated" };
  }
}

self.onmessage = async (ev: MessageEvent<{ id: number; req: Request }>) => {
  const { id, req } = ev.data;
  try {
    const res = await handle(req);
    const transfer = res.type === "applied" ? res.results.map((r) => r.bytes.buffer as ArrayBuffer) : [];
    (self as unknown as Worker).postMessage({ id, res }, transfer);
  } catch (e) {
    (self as unknown as Worker).postMessage({ id, res: { type: "error", message: String(e) } satisfies Response });
  }
};
