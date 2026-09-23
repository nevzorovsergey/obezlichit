// Шрифты страницы: коды ↔ Юникод (ToUnicode) и ширины глифов. Работает поверх объектов pdf-lib.
import { decodePDFRawStream, PDFArray, PDFDict, PDFName, PDFNumber, PDFRawStream, type PDFObject } from "pdf-lib";

export interface FontInfo {
  name: string;
  codeLen: 1 | 2;
  /** hex-код → строка Юникода */
  map: Map<string, string>;
  /** символ → hex-код (первый из подходящих) */
  rev: Map<string, string>;
  hasToUnicode: boolean;
  width(codeHex: string): number;
}

const utf16be = (h: string): string => {
  const units: number[] = [];
  for (let i = 0; i + 4 <= h.length; i += 4) units.push(parseInt(h.slice(i, i + 4), 16));
  return String.fromCharCode(...units);
};

export function parseToUnicode(text: string): { map: Map<string, string>; codeLen: 1 | 2 } {
  const map = new Map<string, string>();
  const cs = text.match(/begincodespacerange\s*<([0-9A-Fa-f]+)>/);
  const codeLen: 1 | 2 = cs && cs[1]!.length >= 4 ? 2 : 1;
  for (const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g))
    for (const m of block[1]!.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) map.set(m[1]!.toUpperCase(), utf16be(m[2]!));
  for (const block of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const m of block[1]!.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(?:<([0-9A-Fa-f]+)>|\[([^\]]*)\])/g)) {
      const lo = parseInt(m[1]!, 16), hi = parseInt(m[2]!, 16), w = m[1]!.length;
      const key = (c: number): string => c.toString(16).toUpperCase().padStart(w, "0");
      if (m[3]) {
        const base = m[3];
        // по спецификации увеличивается последний байт назначения
        const head = base.slice(0, -4), last = parseInt(base.slice(-4), 16);
        for (let c = lo; c <= hi; c++) map.set(key(c), utf16be(head + (last + c - lo).toString(16).padStart(4, "0")));
      } else {
        const arr = [...m[4]!.matchAll(/<([0-9A-Fa-f]+)>/g)].map((x) => utf16be(x[1]!));
        for (let c = lo; c <= hi; c++) { const v = arr[c - lo]; if (v !== undefined) map.set(key(c), v); }
      }
    }
  }
  return { map, codeLen };
}

type Lookup = (o: PDFObject | undefined) => PDFObject | undefined;

const streamText = (s: PDFObject | undefined): string | null => {
  if (!(s instanceof PDFRawStream)) return null;
  const bytes = decodePDFRawStream(s).decode();
  let out = "";
  for (let i = 0; i < bytes.length; i += 8192) out += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return out;
};

export function fontInfo(fontObj: PDFObject, lookup: Lookup): FontInfo {
  const f = lookup(fontObj);
  if (!(f instanceof PDFDict)) throw new Error("шрифт — не словарь");
  const get = (d: PDFDict, k: string): PDFObject | undefined => lookup(d.get(PDFName.of(k)));
  const subtype = get(f, "Subtype")?.toString();
  const tu = streamText(get(f, "ToUnicode"));
  const parsed = tu ? parseToUnicode(tu) : { map: new Map<string, string>(), codeLen: (subtype === "/Type0" ? 2 : 1) as 1 | 2 };
  const widths = new Map<number, number>();
  let dw = 0;
  const n = (o: PDFObject | undefined): number => (o instanceof PDFNumber ? o.asNumber() : 0);
  if (subtype === "/Type0") {
    const dfs = get(f, "DescendantFonts");
    const df = dfs instanceof PDFArray ? lookup(dfs.get(0)) : undefined;
    if (df instanceof PDFDict) {
      const dwo = get(df, "DW");
      dw = dwo ? n(dwo) : 1000;
      const W = get(df, "W");
      if (W instanceof PDFArray) {
        const a = W.asArray().map((x) => lookup(x));
        for (let i = 0; i < a.length;) {
          const c0 = n(a[i]);
          const next = a[i + 1];
          if (next instanceof PDFArray) { next.asArray().forEach((w, k) => widths.set(c0 + k, n(lookup(w)))); i += 2; }
          else { const c1 = n(next), w = n(a[i + 2]); for (let c = c0; c <= c1; c++) widths.set(c, w); i += 3; }
        }
      }
    }
  } else {
    const fc = n(get(f, "FirstChar"));
    const W = get(f, "Widths");
    if (W instanceof PDFArray) W.asArray().forEach((w, k) => widths.set(fc + k, n(lookup(w))));
  }
  const rev = new Map<string, string>();
  for (const [code, str] of parsed.map) if (str.length === 1 && !rev.has(str)) rev.set(str, code);
  return {
    name: (get(f, "BaseFont")?.toString() ?? "").replace(/^\//, ""),
    codeLen: parsed.codeLen,
    map: parsed.map,
    rev,
    hasToUnicode: tu !== null,
    width: (codeHex) => widths.get(parseInt(codeHex, 16)) ?? dw,
  };
}

