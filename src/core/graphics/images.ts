// Фото машины и кроп номера: на снимках читаются ГРЗ и надписи собственника на кабине,
// поэтому изображения пикселизуются целиком (ADR-0131 п. 3). Декодирование — чистый JS:
// DCT через jpeg-js, Flate с PNG-предиктором — своим разбором строк.
import { PDFArray, PDFDict, PDFName, PDFNumber, PDFRawStream, PDFRef, type PDFDocument, type PDFObject, type PDFPage } from "pdf-lib";
import jpeg from "jpeg-js";
import { decompressSync } from "fflate";

export type ImageKind = "plate" | "photo";

export interface ImagesReport { pixelated: number; replaced: number }

interface Raw { w: number; h: number; comps: 1 | 3; px: Uint8Array }

export function classify(w: number, h: number): ImageKind | null {
  const r = w / h;
  if (w <= 320 && r >= 2.2 && r <= 3.2) return "plate";
  if (w >= 400 && h >= 250) return "photo";
  return null;
}

const num = (o: PDFObject | undefined): number | undefined => (o instanceof PDFNumber ? o.asNumber() : undefined);

/** Снять PNG-предиктор (Predictor ≥ 10) со строк распакованного Flate. */
export function unpredict(data: Uint8Array, w: number, comps: number): Uint8Array {
  const stride = w * comps;
  const rows = Math.floor(data.length / (stride + 1));
  const out = new Uint8Array(rows * stride);
  for (let y = 0; y < rows; y++) {
    const f = data[y * (stride + 1)]!;
    const src = y * (stride + 1) + 1;
    for (let x = 0; x < stride; x++) {
      const raw = data[src + x]!;
      const a = x >= comps ? out[y * stride + x - comps]! : 0;
      const b = y > 0 ? out[(y - 1) * stride + x]! : 0;
      const c = x >= comps && y > 0 ? out[(y - 1) * stride + x - comps]! : 0;
      let v: number;
      switch (f) {
        case 1: v = raw + a; break;
        case 2: v = raw + b; break;
        case 3: v = raw + ((a + b) >> 1); break;
        case 4: { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v = raw + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); break; }
        default: v = raw;
      }
      out[y * stride + x] = v & 255;
    }
  }
  return out;
}

function decode(doc: PDFDocument, s: PDFRawStream): Raw | null {
  const d = s.dict;
  const w = num(d.get(PDFName.of("Width"))), h = num(d.get(PDFName.of("Height")));
  if (!w || !h || num(d.get(PDFName.of("BitsPerComponent"))) !== 8) return null;
  const filter = d.lookup(PDFName.of("Filter"));
  const fname = filter instanceof PDFArray ? filter.lookup(0)?.toString() : filter?.toString();
  if (fname === "/DCTDecode") {
    const img = jpeg.decode(s.contents, { useTArray: true, formatAsRGBA: false });
    const comps = img.data.length / (img.width * img.height) === 1 ? 1 : 3;
    return { w: img.width, h: img.height, comps, px: comps === 3 && img.data.length === img.width * img.height * 4 ? dropAlpha(img.data) : img.data };
  }
  const cs = d.lookup(PDFName.of("ColorSpace"));
  let comps: number | undefined = cs?.toString() === "/DeviceGray" ? 1 : cs?.toString() === "/DeviceRGB" ? 3 : undefined;
  if (cs instanceof PDFArray && cs.lookup(0)?.toString() === "/ICCBased") {
    const icc = doc.context.lookup(cs.get(1));
    comps = icc instanceof PDFRawStream ? num(icc.dict.get(PDFName.of("N"))) : undefined;
  }
  if (comps !== 1 && comps !== 3) return null;
  if (fname !== "/FlateDecode") return null;
  let data: Uint8Array = decompressSync(s.contents);
  const parms = d.lookup(PDFName.of("DecodeParms"));
  const pred = parms instanceof PDFDict ? num(parms.get(PDFName.of("Predictor"))) : undefined;
  if (pred && pred >= 10) data = unpredict(data, w, comps);
  if (data.length < w * h * comps) return null;
  return { w, h, comps, px: data.subarray(0, w * h * comps) };
}

function dropAlpha(rgba: Uint8Array): Uint8Array {
  const out = new Uint8Array((rgba.length / 4) * 3);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) { out[j] = rgba[i]!; out[j + 1] = rgba[i + 1]!; out[j + 2] = rgba[i + 2]!; }
  return out;
}

export function pixelate(img: Raw, block: number): Raw {
  const { w, h, comps, px } = img;
  const out = new Uint8Array(px.length);
  for (let by = 0; by < h; by += block) for (let bx = 0; bx < w; bx += block) {
    const acc = new Array<number>(comps).fill(0);
    let cnt = 0;
    const ye = Math.min(by + block, h), xe = Math.min(bx + block, w);
    for (let y = by; y < ye; y++) for (let x = bx; x < xe; x++, cnt++) for (let k = 0; k < comps; k++) acc[k]! += px[(y * w + x) * comps + k]!;
    for (let y = by; y < ye; y++) for (let x = bx; x < xe; x++) for (let k = 0; k < comps; k++) out[(y * w + x) * comps + k] = Math.round(acc[k]! / cnt);
  }
  return { ...img, px: out };
}

/** Пикселизовать фото и кропы номера страницы; нераскодируемые — заменить серой заливкой. */
export function pixelateImages(doc: PDFDocument, page: PDFPage, done: Set<string>, report: ImagesReport): void {
  const xo = page.node.Resources()?.lookup(PDFName.of("XObject"));
  if (!(xo instanceof PDFDict)) return;
  for (const [, ref] of xo.entries()) {
    if (!(ref instanceof PDFRef) || done.has(ref.toString())) continue;
    const s = doc.context.lookup(ref);
    if (!(s instanceof PDFRawStream) || s.dict.get(PDFName.of("Subtype"))?.toString() !== "/Image") continue;
    const w = num(s.dict.get(PDFName.of("Width"))) ?? 0, h = num(s.dict.get(PDFName.of("Height"))) ?? 0;
    const kind = classify(w, h);
    if (!kind) continue;
    done.add(ref.toString());
    const raw = decode(doc, s);
    const out: Raw = raw ? pixelate(raw, kind === "plate" ? 12 : Math.max(10, Math.round(w / 50))) : { w, h, comps: 1, px: new Uint8Array(w * h).fill(160) };
    const stream = doc.context.flateStream(out.px, {
      Type: "XObject", Subtype: "Image", Width: out.w, Height: out.h, BitsPerComponent: 8,
      ColorSpace: out.comps === 1 ? "DeviceGray" : "DeviceRGB",
    });
    doc.context.assign(ref, stream);
    if (raw) report.pixelated++; else report.replaced++;
  }
}

