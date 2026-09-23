// Самопроверка готового файла: исходных значений нет ни в тексте, ни во внутренних потоках,
// ни в заново прочитанных кодах, ни в метаданных; старых ревизий внутри нет (ADR-0131 п. 4).
import { PDFDict, PDFDocument, PDFHexString, PDFString } from "pdf-lib";
import { decompressSync } from "fflate";
import { codeClusters, decodeCluster, filledRectPaths } from "./graphics/codes";
import { pageModel } from "./pdf/rewrite";
import { extractText } from "./pdf/text";

export type Where = "text" | "streams" | "codes" | "metadata" | "revisions";

export interface CheckResult {
  ok: boolean;
  checked: Record<Where, number>;
  /** найденные остатки: где и какое исходное значение (по индексу в списке `originals`) */
  leaks: Array<{ where: Where; value: number; page?: number }>;
}

const norm = (s: string): string => s.replace(/\s+/g, " ");
const digits = (s: string): string => s.replace(/\D/g, "");

/** Варианты написания исходного значения, которые ищутся в файле. */
function variants(v: string): string[] {
  const out = new Set([norm(v).trim()]);
  if (/^[\d\s]+$/.test(v) && digits(v).length >= 6) out.add(digits(v));
  return [...out].filter((x) => x.length >= 4);
}

export async function selfcheck(bytes: Uint8Array, originals: string[]): Promise<CheckResult> {
  const leaks: CheckResult["leaks"] = [];
  const vs = originals.map(variants);
  const hitIn = (hay: string, where: Where, page?: number): void => {
    vs.forEach((list, i) => { if (list.some((v) => hay.includes(v))) leaks.push({ where, value: i, ...(page !== undefined ? { page } : {}) }); });
  };

  // 1. текстовый слой — как его видит внешний читатель
  const text = await extractText(bytes);
  const t = norm(text);
  hitIn(t + " " + digits(text), "text");

  // 2. каждый поток прямо из байтов файла, включая объекты вне текущей ревизии
  let streams = 0;
  const raw = latin1(bytes);
  const parts: string[] = [raw];
  for (let at = raw.indexOf("stream"); at >= 0; at = raw.indexOf("stream", at + 6)) {
    let s0 = at + 6;
    if (raw.charCodeAt(s0) === 13) s0++;
    if (raw.charCodeAt(s0) === 10) s0++;
    const e = raw.indexOf("endstream", s0);
    if (e < 0) break;
    try { parts.push(latin1(decompressSync(bytes.subarray(s0, e)))); streams++; } catch { /* не Flate */ }
    at = e;
  }
  const blob = parts.join("\n");
  vs.forEach((list, i) => {
    // в потоках кириллица закодирована кодами шрифта; здесь ловятся цифры, латиница и UTF-16BE
    const enc = list.flatMap((v) => [v, utf16be(v)]).filter((v) => /^[\x00-\xff]+$/.test(v));
    if (enc.some((v) => blob.includes(v))) leaks.push({ where: "streams", value: i });
  });

  // 3. коды — заново прочитанные
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  let codes = 0;
  doc.getPages().forEach((p, pi) => {
    for (const c of codeClusters(filledRectPaths(pageModel(doc, p).toks))) {
      const d = decodeCluster(c);
      codes++;
      if (d) hitIn(norm(d.data) + " " + digits(d.data), "codes", pi);
    }
  });

  // 4. метаданные: строки словаря Info и XMP
  const info = doc.context.lookup(doc.context.trailerInfo.Info);
  let meta = 0;
  if (info instanceof PDFDict) for (const [, v] of info.entries()) {
    if (v instanceof PDFString || v instanceof PDFHexString) { meta++; hitIn(v.decodeText(), "metadata"); }
  }
  if (doc.catalog.get(doc.context.obj("Metadata") as never)) leaks.push({ where: "metadata", value: -1 });

  // 5. одна ревизия: иначе в файле остаётся прежний текст
  const eofs = raw.match(/%%EOF/g)?.length ?? 0;
  if (eofs > 1) leaks.push({ where: "revisions", value: -1 });

  return { ok: leaks.length === 0, checked: { text: 1, streams, codes, metadata: meta, revisions: eofs }, leaks };
}

function latin1(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode(...b.subarray(i, i + 8192));
  return s;
}

function utf16be(s: string): string {
  let out = "";
  for (const ch of s) { const c = ch.charCodeAt(0); out += String.fromCharCode(c >> 8, c & 255); }
  return out;
}
