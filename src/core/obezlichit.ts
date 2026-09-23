// Обезличивание комплекта файлов: одна таблица подмен на все файлы, загруженные вместе
// (постановление и акт получают одинаковые УИН и ГРЗ).
import { PDFDict, PDFDocument, PDFName, PDFString } from "pdf-lib";
import { detect, type Find, type Kind } from "./detect/detect";
import { replaceCodes, type CodesReport } from "./graphics/codes";
import { coverOf, pageModel, rewritePage, type PageModel, type RewriteReport } from "./pdf/rewrite";
import { extractText } from "./pdf/text";
import { cryptoRng, keyOf, plateLike, Synth, type Rng } from "./synth/generate";

export const VERSION = "0.1.0";
export const MARKER_KEY = "TonnapravaDepersonalized";

export interface InputFile { name: string; bytes: Uint8Array }

export interface Substitution {
  key: string;
  kind: Kind;
  /** исходное значение в первом встреченном написании */
  original: string;
  replacement: string;
  count: number;
}

export interface Plan {
  files: Array<{ name: string; doc: PDFDocument; models: PageModel[]; finds: Find[]; hasText: boolean }>;
  substitutions: Map<string, Substitution>;
}

export async function makePlan(inputs: InputFile[], rng: Rng = cryptoRng()): Promise<Plan> {
  const files = [];
  for (const f of inputs) {
    const doc = await PDFDocument.load(f.bytes, { updateMetadata: false });
    const models = doc.getPages().map((p) => pageModel(doc, p));
    const text = await extractText(f.bytes);
    files.push({ name: f.name, doc, models, finds: detect(text), hasText: text.trim().length > 0 });
  }
  const allModels = files.flatMap((f) => f.models);
  const synth = new Synth(rng);
  const substitutions = new Map<string, Substitution>();
  for (const f of files) for (const x of f.finds) {
    const key = keyOf(x.kind, x.value);
    const s = substitutions.get(key);
    if (s) { s.count++; continue; }
    const variants = files.flatMap((ff) => ff.finds).filter((y) => keyOf(y.kind, y.value) === key).map((y) => y.value);
    let cover: Set<string> | undefined;
    for (const v of new Set(variants)) {
      const c = coverOf(allModels, v);
      if (c) cover = cover ? new Set([...cover].filter((ch) => c.has(ch))) : c;
    }
    substitutions.set(key, { key, kind: x.kind, original: x.value, replacement: synth.generate(x, cover), count: 1 });
  }
  return { files, substitutions };
}

export interface OutputFile { name: string; bytes: Uint8Array; report: RewriteReport & { codes: CodesReport } }

export async function applyPlan(plan: Plan): Promise<OutputFile[]> {
  const out: OutputFile[] = [];
  for (const f of plan.files) {
    const report: RewriteReport = { replaced: 0, notFound: [], unencodable: [], widened: 0 };
    const pairs = new Map<string, string>();
    for (const x of f.finds) {
      const s = plan.substitutions.get(keyOf(x.kind, x.value));
      if (!s) continue;
      pairs.set(x.value, x.kind === "plate" ? plateLike(s.replacement, x.value) : s.replacement);
    }
    // коды: данные прогоняются через ту же таблицу подмен, включая написание «только цифры»
    const codePairs = [...plan.substitutions.values()].flatMap((s) => {
      const variants = new Set([s.original, ...f.finds.filter((x) => keyOf(x.kind, x.value) === s.key).map((x) => x.value)]);
      const numeric = ["uin", "inn", "ogrn", "kpp", "sts", "case", "shpi", "index"].includes(s.kind);
      return [...variants].flatMap((v): Array<[string, string]> => numeric ? [[v, s.replacement], [v.replace(/\D/g, ""), s.replacement.replace(/\D/g, "")]] : [[v, s.replacement]]);
    }).sort((a, b) => b[0].length - a[0].length);
    const substitute = (data: string): string => codePairs.reduce((d, [o, r]) => (o.length >= 4 ? d.split(o).join(r) : d), data);
    const codes: CodesReport = { redrawn: 0, removed: 0 };
    const models = f.models.map((m) => {
      const next = replaceCodes(m.bytes, m.toks, substitute, codes);
      if (!next) return m;
      m.page.node.set(PDFName.of("Contents"), f.doc.context.register(f.doc.context.flateStream(next)));
      return pageModel(f.doc, m.page);
    });
    const hits = new Map<string, number>();
    for (const m of models) rewritePage(f.doc, m, [...pairs.entries()], report, hits);
    report.notFound = [...pairs.keys()].filter((k) => !hits.get(k));
    scrubMetadata(f.doc);
    out.push({ name: f.name, bytes: await f.doc.save({ useObjectStreams: false, updateFieldAppearances: false }), report: { ...report, codes } });
  }
  return out;
}

/** Удалить сведения об авторе и XMP, поставить маркер для «Тонны права» (ADR-0131 п. 5). */
export function scrubMetadata(doc: PDFDocument): void {
  const ctx = doc.context;
  let info = ctx.lookup(ctx.trailerInfo.Info);
  if (!(info instanceof PDFDict)) {
    info = ctx.obj({});
    ctx.trailerInfo.Info = ctx.register(info as PDFDict);
  }
  const d = info as PDFDict;
  for (const k of ["Author", "Subject", "Keywords", "Creator"]) d.delete(PDFName.of(k));
  d.set(PDFName.of(MARKER_KEY), PDFString.of(`obezlichit/${VERSION}`));
  doc.catalog.delete(PDFName.of("Metadata"));
}
