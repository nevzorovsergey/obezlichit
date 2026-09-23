// Подмена текста в потоке команд страницы: коды глифов в Tj/TJ заменяются кодами того же шрифта.
// Шрифт, кегль, положение и порядок текстового слоя остаются исходными; разница ширины
// компенсируется числом в TJ, поэтому соседний текст не сдвигается (ADR-0131 п. 2).
import { decodePDFRawStream, PDFArray, PDFDict, PDFName, PDFRawStream, type PDFDocument, type PDFObject, type PDFPage } from "pdf-lib";
import { fontInfo, type FontInfo } from "./fonts";
import { lex, textShows, type TextShow, type Token } from "./lexer";

export interface Glyph { code: string; uni: string; show: number }
interface Unit { code?: string; num?: number; glyph?: Glyph }

export interface PageModel {
  page: PDFPage;
  fonts: Map<string, FontInfo>;
  bytes: Uint8Array;
  toks: Token[];
  shows: Array<TextShow & { units: Unit[] }>;
  glyphs: Glyph[];
  /** текст страницы без пробельных символов и карта его символов на глифы */
  flat: string;
  flatMap: number[];
}

const lookupIn = (doc: PDFDocument) => (o: PDFObject | undefined) => (o ? doc.context.lookup(o) : undefined);

function contentBytes(doc: PDFDocument, page: PDFPage): Uint8Array {
  const c = page.node.Contents();
  const parts = c instanceof PDFArray ? c.asArray().map((r) => doc.context.lookup(r)) : [c];
  const chunks = parts.filter((p): p is PDFRawStream => p instanceof PDFRawStream).map((p) => decodePDFRawStream(p).decode());
  const total = chunks.reduce((s, x) => s + x.length + 1, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const ch of chunks) { out.set(ch, o); o += ch.length; out[o++] = 10; }
  return out;
}

export function pageModel(doc: PDFDocument, page: PDFPage): PageModel {
  const lookup = lookupIn(doc);
  const fonts = new Map<string, FontInfo>();
  const fd = page.node.Resources()?.lookup(PDFName.of("Font"));
  if (fd instanceof PDFDict) for (const [name, ref] of fd.entries()) fonts.set(name.asString().slice(1), fontInfo(ref, lookup));
  const bytes = contentBytes(doc, page);
  const toks = lex(bytes);
  const glyphs: Glyph[] = [];
  const shows = textShows(toks).map((s, si) => {
    const fi = s.font ? fonts.get(s.font) : undefined;
    const units: Unit[] = [];
    for (const it of s.items) {
      if (it.t === "num") { units.push({ num: it.v }); continue; }
      const L = (fi?.codeLen ?? 1) * 2;
      for (let o = 0; o < it.v.length; o += L) {
        const code = it.v.slice(o, o + L);
        const g: Glyph = { code, uni: fi?.map.get(code) ?? "�", show: si };
        units.push({ code, glyph: g });
        glyphs.push(g);
      }
    }
    return { ...s, units };
  });
  const flatChars: string[] = [];
  const flatMap: number[] = [];
  glyphs.forEach((g, gi) => { for (const ch of g.uni) if (!/\s/.test(ch)) { flatChars.push(ch); flatMap.push(gi); } });
  return { page, fonts, bytes, toks, shows, glyphs, flat: flatChars.join(""), flatMap };
}

const nospace = (s: string): string => s.replace(/\s+/g, "");

/** Вхождения значения на странице — диапазоны индексов глифов. */
export function locate(m: PageModel, value: string): Array<[number, number]> {
  const needle = nospace(value);
  const out: Array<[number, number]> = [];
  if (!needle) return out;
  for (let at = m.flat.indexOf(needle); at >= 0; at = m.flat.indexOf(needle, at + 1))
    out.push([m.flatMap[at]!, m.flatMap[at + needle.length - 1]!]);
  return out;
}

/** Символы, доступные во всех шрифтах, которыми набраны вхождения значения. */
export function coverOf(models: PageModel[], value: string): Set<string> | undefined {
  let cover: Set<string> | undefined;
  for (const m of models) for (const [g0, g1] of locate(m, value)) for (let k = g0; k <= g1; k++) {
    const s = m.shows[m.glyphs[k]!.show]!;
    const fi = s.font ? m.fonts.get(s.font) : undefined;
    if (!fi) continue;
    const chars = new Set(fi.rev.keys());
    cover = cover ? new Set([...cover].filter((c) => chars.has(c))) : chars;
  }
  return cover;
}

export interface RewriteReport { replaced: number; notFound: string[]; unencodable: string[]; widened: number }

/** Заменить на странице пары «исходное → подмена» (длинные — первыми). */
export function rewritePage(doc: PDFDocument, m: PageModel, pairs: Array<[string, string]>, report: RewriteReport, hitsBy: Map<string, number> = new Map()): void {
  const used = new Set<number>();
  type Edit = { show: number; glyphs: Glyph[]; text: string };
  const edits: Edit[] = [];
  for (const [orig, repl] of [...pairs].sort((a, b) => b[0].length - a[0].length)) {
    let hits = 0;
    for (const [g0, g1] of locate(m, orig)) {
      if ([...Array(g1 - g0 + 1).keys()].some((k) => used.has(g0 + k))) continue;
      for (let k = g0; k <= g1; k++) used.add(k);
      // по операторам показа (строкам); операторы из одних пробелов не трогаем
      const segs: Array<{ show: number; glyphs: Glyph[] }> = [];
      for (let k = g0; k <= g1; k++) {
        const g = m.glyphs[k]!;
        if (segs.at(-1)?.show !== g.show) segs.push({ show: g.show, glyphs: [] });
        segs.at(-1)!.glyphs.push(g);
      }
      const real = segs.filter((sg) => sg.glyphs.some((g) => !/^\s*$/.test(g.uni)));
      split(repl, real).forEach((text, i) => edits.push({ ...real[i]!, text }));
      hits++;
    }
    hitsBy.set(orig, (hitsBy.get(orig) ?? 0) + hits);
  }
  if (!edits.length) return;
  const touched = new Set<number>();
  for (const e of edits) {
    const s = m.shows[e.show]!;
    const fi = s.font ? m.fonts.get(s.font) : undefined;
    if (!fi) continue;
    const i0 = s.units.findIndex((u) => u.glyph === e.glyphs[0]);
    const i1 = s.units.findIndex((u) => u.glyph === e.glyphs.at(-1));
    const span = s.units.slice(i0, i1 + 1);
    const tc = (s.Tc * 1000) / (s.size || 1);
    const tw = (s.Tw * 1000) / (s.size || 1);
    const wOf = (code: string): number => fi.width(code) + tc + (fi.codeLen === 1 && code === "20" ? tw : 0);
    const oldW = span.reduce((a, u) => a + (u.num !== undefined ? -u.num : wOf(u.code!)), 0);
    // Пробела в урезанном шрифте может не быть: тогда он ставится сдвигом в TJ — извлечение текста
    // восстанавливает пробел по зазору. Код "" означает такой пробел-сдвиг.
    const GAP = 280;
    const codes: string[] = [];
    for (const ch of e.text) {
      const c = fi.rev.get(ch);
      if (c !== undefined) codes.push(c);
      else if (ch === " ") codes.push("");
      else report.unencodable.push(`${ch} (${fi.name})`);
    }
    const wOfC = (c: string): number => (c === "" ? GAP : wOf(c));
    const newW = codes.reduce((a, c) => a + wOfC(c), 0);
    if (newW > oldW * 1.02) report.widened++;
    // Шире — поджать межбуквенно. Уже — слегка разрядить (до 40/1000 кегля на промежуток),
    // остаток отдать пробелам между словами подмены: зазор в конце pdf.js читает как лишний пробел.
    const gaps = Math.max(0, codes.length - 1);
    const step = gaps ? (newW > oldW ? (newW - oldW) / gaps : -Math.min((oldW - newW) / gaps, 40)) : 0;
    const spaceCode = fi.rev.get(" ") ?? "";
    const spaces = codes.filter((c, k) => c === spaceCode && k > 0 && k < gaps).length;
    let rest = oldW - (newW - step * gaps); // > 0 — не хватает ширины
    const perSpace = rest > 0 && spaces ? rest / spaces : 0;
    if (perSpace) rest = 0;
    const units: Unit[] = [];
    codes.forEach((code, k) => {
      units.push(code === "" ? { num: -GAP } : { code });
      if (k >= gaps) return;
      const extra = perSpace && code === spaceCode && k > 0 ? -perSpace : 0;
      if (step || extra) units.push({ num: step + extra });
    });
    units.push({ num: -rest });
    s.units.splice(i0, i1 - i0 + 1, ...units);
    touched.add(e.show);
    report.replaced++;
  }
  // сериализация изменённых операторов в TJ и сборка потока заново
  const splices = [...touched].map((si) => {
    const s = m.shows[si]!;
    let body = "[";
    let run = "";
    const flush = (): void => { if (run) { body += `<${run}>`; run = ""; } };
    for (const u of s.units) {
      if (u.num !== undefined) { flush(); if (Math.abs(u.num) > 0.001) body += ` ${+u.num.toFixed(3)} `; }
      else run += u.code;
    }
    flush();
    body += "] TJ";
    const pre = s.op === "'" ? "T* " : s.op === '"' ? `${s.aw![0]} Tw ${s.aw![1]} Tc T* ` : "";
    return { a: m.toks[s.first]!.start, b: m.toks[s.opTok]!.end, text: pre + body };
  }).sort((x, y) => y.a - x.a);
  let out = m.bytes;
  for (const sp of splices) {
    const ins = Uint8Array.from([...sp.text].map((c) => c.charCodeAt(0)));
    const next = new Uint8Array(out.length - (sp.b - sp.a) + ins.length);
    next.set(out.subarray(0, sp.a), 0);
    next.set(ins, sp.a);
    next.set(out.subarray(sp.b), sp.a + ins.length);
    out = next;
  }
  const ref = doc.context.register(doc.context.flateStream(out));
  m.page.node.set(PDFName.of("Contents"), ref);
}

/** Раскладка подмены по строкам исходника: по доле исходных глифов, по словам. */
function split(repl: string, segs: Array<{ glyphs: Glyph[] }>): string[] {
  if (segs.length <= 1) return [repl];
  const words = repl.split(" ");
  const total = segs.reduce((a, s) => a + s.glyphs.length, 0);
  const out: string[] = [];
  let wi = 0;
  segs.forEach((sg, k) => {
    if (k === segs.length - 1) { out.push(words.slice(wi).join(" ")); return; }
    const cap = (sg.glyphs.length / total) * repl.length;
    let s = "";
    while (wi < words.length && (!s || s.length + 1 + words[wi]!.length <= cap + 2)) s += (s ? " " : "") + words[wi++];
    out.push(s);
  });
  return out;
}
