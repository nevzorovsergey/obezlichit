// Обезличивание комплекта файлов: одна таблица подмен на все файлы, загруженные вместе
// (постановление и акт получают одинаковые УИН и ГРЗ). План хранит исходные байты: применять
// его можно сколько угодно раз — после правок пользователя каждый раз с чистых документов.
import { PDFDict, PDFDocument, PDFName, PDFString } from "pdf-lib";
import { detect, type Kind } from "./detect/detect";
import { replaceCodes, type CodesReport } from "./graphics/codes";
import { pixelateImages, type ImagesReport } from "./graphics/images";
import { coverOf, pageModel, rewritePage, type Fallback, type RewriteReport } from "./pdf/rewrite";
import { makeFallback } from "./pdf/fallback";
import { extractText } from "./pdf/text";
import { cryptoRng, keyOf, plateLike, Synth, type Rng } from "./synth/generate";

export const VERSION = "0.1.0";
export const MARKER_KEY = "TonnapravaDepersonalized";

export interface InputFile { name: string; bytes: Uint8Array }

export type SubKind = Kind | "manual";
export type DocType = "resolution" | "act" | "other";

export interface Substitution {
  key: string;
  kind: SubKind;
  /** исходное значение в первом встреченном написании */
  original: string;
  /** все написания значения в файлах комплекта (ГРЗ латиницей и кириллицей и т. п.) */
  variants: string[];
  replacement: string;
  count: number;
  /** пользователь может снять ложную находку */
  enabled: boolean;
  /** символы, которые есть во всех шрифтах вхождений; нет — без ограничений */
  cover?: string[];
}

export interface PlanFile { name: string; bytes: Uint8Array; text: string; pages: number; hasText: boolean; docType: DocType }

export interface Plan { files: PlanFile[]; substitutions: Map<string, Substitution> }

const NUMERIC = new Set(["uin", "inn", "ogrn", "kpp", "sts", "case", "shpi", "index"]);

export function docTypeOf(text: string): DocType {
  if (/ПОСТАНОВЛЕНИЕ/i.test(text)) return "resolution";
  if (/(^|[^А-Яа-яЁё])Акт(?![а-яё])/.test(text)) return "act";
  return "other";
}

async function modelsOf(files: PlanFile[]) {
  const out = [];
  for (const f of files) {
    const doc = await PDFDocument.load(f.bytes, { updateMetadata: false });
    out.push(...doc.getPages().map((p) => pageModel(doc, p)));
  }
  return out;
}

export async function makePlan(inputs: InputFile[], rng: Rng = cryptoRng()): Promise<Plan> {
  const files: PlanFile[] = [];
  const finds = [];
  for (const f of inputs) {
    const text = await extractText(f.bytes);
    const doc = await PDFDocument.load(f.bytes, { updateMetadata: false });
    files.push({ name: f.name, bytes: f.bytes, text, pages: doc.getPageCount(), hasText: text.trim().length > 0, docType: docTypeOf(text) });
    finds.push(...detect(text));
  }
  const models = await modelsOf(files);
  const synth = new Synth(rng);
  const substitutions = new Map<string, Substitution>();
  for (const x of finds) {
    const key = keyOf(x.kind, x.value);
    const s = substitutions.get(key);
    if (s) { s.count++; if (!s.variants.includes(x.value)) s.variants.push(x.value); continue; }
    const variants = [...new Set(finds.filter((y) => keyOf(y.kind, y.value) === key).map((y) => y.value))];
    let cover: Set<string> | undefined;
    for (const v of variants) {
      const c = coverOf(models, v);
      if (c) cover = cover ? new Set([...cover].filter((ch) => c.has(ch))) : c;
    }
    substitutions.set(key, {
      key, kind: x.kind, original: x.value, variants: [x.value], replacement: synth.generate(x, cover),
      count: 1, enabled: true, ...(cover ? { cover: [...cover] } : {}),
    });
  }
  return { files, substitutions };
}

/** Значение, выделенное пользователем на превью: подмена той же формы (цифры — случайные, буквы — «Т…»). */
export async function addManual(plan: Plan, value: string, rng: Rng = cryptoRng()): Promise<Substitution | null> {
  const v = value.replace(/\s+/g, " ").trim();
  if (v.length < 2) return null;
  const flat = v.replace(/\s+/g, "");
  const count = plan.files.reduce((n, f) => n + f.text.replace(/\s+/g, "").split(flat).length - 1, 0);
  if (!count) return null;
  const cover = coverOf(await modelsOf(plan.files), v);
  const letters = (upper: boolean): string[] => [...(upper ? "ТЕСОВ" : "тесов")].filter((c) => !cover || cover.has(c));
  const replacement = [...v].map((ch) => {
    if (/\d/.test(ch)) return String(Math.floor(rng() * 10));
    if (/[А-ЯЁ]/.test(ch)) { const l = letters(true); return l[Math.floor(rng() * l.length)] ?? "Т"; }
    if (/[а-яё]/.test(ch)) { const l = letters(false); return l[Math.floor(rng() * l.length)] ?? "т"; }
    return ch;
  }).join("");
  const s: Substitution = { key: "manual:" + v.toUpperCase(), kind: "manual", original: v, variants: [v], replacement, count, enabled: true, ...(cover ? { cover: [...cover] } : {}) };
  plan.substitutions.set(s.key, s);
  return s;
}

export interface ApplyOptions { keepPhotos?: boolean }

export interface OutputFile {
  name: string;
  docType: DocType;
  bytes: Uint8Array;
  report: RewriteReport & { codes: CodesReport; images: ImagesReport };
}

const needsFallback = (s: Substitution): boolean => !!s.cover && [...s.replacement].some((ch) => ch !== " " && !s.cover!.includes(ch));

export async function applyPlan(plan: Plan, opts: ApplyOptions = {}): Promise<OutputFile[]> {
  const out: OutputFile[] = [];
  const subs = [...plan.substitutions.values()].filter((s) => s.enabled);
  for (const f of plan.files) {
    const doc = await PDFDocument.load(f.bytes, { updateMetadata: false });
    const flatText = f.text.replace(/\s+/g, "");
    const present = (v: string): boolean => flatText.includes(v.replace(/\s+/g, ""));
    const mine = subs.filter((s) => s.variants.some(present));
    const report: RewriteReport = { replaced: 0, notFound: [], unencodable: [], widened: 0, fallback: 0 };
    const fallback: Fallback | undefined = mine.some(needsFallback) ? await makeFallback(doc) : undefined;
    const pairs = new Map<string, string>();
    for (const s of mine) for (const v of s.variants) if (present(v)) pairs.set(v, s.kind === "plate" ? plateLike(s.replacement, v) : s.replacement);
    // коды: данные прогоняются через ту же таблицу, включая написание «только цифры»
    const codePairs = subs.flatMap((s) => s.variants.flatMap((v): Array<[string, string]> =>
      NUMERIC.has(s.kind) ? [[v, s.replacement], [v.replace(/\D/g, ""), s.replacement.replace(/\D/g, "")]] : [[v, s.replacement]],
    )).sort((a, b) => b[0].length - a[0].length);
    const substitute = (data: string): string => codePairs.reduce((d, [o, r]) => (o.length >= 4 ? d.split(o).join(r) : d), data);
    const codes: CodesReport = { redrawn: 0, removed: 0 };
    const models = doc.getPages().map((p) => {
      const m = pageModel(doc, p);
      const next = replaceCodes(m.bytes, m.toks, substitute, codes);
      if (!next) return m;
      p.node.set(PDFName.of("Contents"), doc.context.register(doc.context.flateStream(next)));
      return pageModel(doc, p);
    });
    const images: ImagesReport = { pixelated: 0, replaced: 0 };
    if (!opts.keepPhotos) { const seen = new Set<string>(); for (const p of doc.getPages()) pixelateImages(doc, p, seen, images); }
    const hits = new Map<string, number>();
    for (const m of models) rewritePage(doc, m, [...pairs.entries()], report, hits, fallback);
    report.notFound = [...pairs.keys()].filter((k) => !hits.get(k));
    scrubMetadata(doc);
    out.push({ name: f.name, docType: f.docType, bytes: await doc.save({ useObjectStreams: false, updateFieldAppearances: false }), report: { ...report, codes, images } });
  }
  return out;
}

/** Все исходные значения включённых подмен — для самопроверки. */
export const originalsOf = (plan: Plan): string[] => [...plan.substitutions.values()].filter((s) => s.enabled).flatMap((s) => s.variants);

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
