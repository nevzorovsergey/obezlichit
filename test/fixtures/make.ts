// Синтетические PDF для тестов. Настоящих документов в репозитории нет и не будет.
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument } from "pdf-lib";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ttf = (name: string): Uint8Array => readFileSync(require.resolve(`dejavu-fonts-ttf/ttf/${name}`));

/** Строки текста одним шрифтом Identity-H с ToUnicode (как акт АПВГК из Oracle AS-PDF). */
export async function identityPdf(lines: string[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(ttf("DejaVuSerif.ttf"), { subset: true });
  const page = doc.addPage([595, 842]);
  lines.forEach((text, i) => page.drawText(text, { x: 30, y: 780 - i * 14, size: 8, font }));
  return doc.save({ useObjectStreams: false });
}

/** Постановление с векторным QR (модули — залитые прямоугольники, как у LibreOffice). */
export async function pdfWithQr(lines: string[], qrData: string): Promise<Uint8Array> {
  const QRCode = (await import("qrcode")).default;
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(ttf("DejaVuSerif.ttf"), { subset: true });
  const page = doc.addPage([595, 842]);
  lines.forEach((text, i) => page.drawText(text, { x: 30, y: 780 - i * 14, size: 8, font }));
  const q = QRCode.create(qrData, { errorCorrectionLevel: "M" });
  const n = q.modules.size, m = 100 / n;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++)
    if (q.modules.get(r, c)) page.drawRectangle({ x: 400 + c * m, y: 600 - (r + 1) * m, width: m, height: m, borderWidth: 0 });
  return doc.save({ useObjectStreams: false });
}

/** Страница с фото (JPEG) и кропом номера (Flate + PNG-предиктор Sub, как в актах АПВГК). */
export async function pdfWithImages(): Promise<Uint8Array> {
  const jpeg = (await import("jpeg-js")).default;
  const { concatTransformationMatrix, drawObject, popGraphicsState, pushGraphicsState, PDFName } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  // «фото» 480×300 — шахматка 4×4 px: после пикселизации клетки сливаются в серое
  const w = 480, h = 300, rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = ((x >> 2) + (y >> 2)) % 2 ? 250 : 5; rgba.set([v, v, v, 255], (y * w + x) * 4); }
  const jpg = await doc.embedJpg(jpeg.encode({ data: rgba, width: w, height: h }, 95).data);
  page.drawImage(jpg, { x: 30, y: 400, width: 240, height: 150 });
  // «кроп номера» 216×84 в оттенках серого, каждая строка — фильтр PNG Sub
  const pw = 216, ph = 84, rows = new Uint8Array(ph * (pw + 1));
  for (let y = 0; y < ph; y++) {
    rows[y * (pw + 1)] = 1;
    let prev = 0;
    for (let x = 0; x < pw; x++) { const v = ((x >> 2) + (y >> 2)) % 2 ? 240 : 10; rows[y * (pw + 1) + 1 + x] = (v - prev) & 255; prev = v; }
  }
  const ref = doc.context.register(doc.context.flateStream(rows, { Type: "XObject", Subtype: "Image", Width: pw, Height: ph, BitsPerComponent: 8, ColorSpace: "DeviceGray", DecodeParms: { Predictor: 15, Colors: 1, Columns: pw } }));
  page.node.setXObject(PDFName.of("Plate"), ref);
  page.pushOperators(pushGraphicsState(), concatTransformationMatrix(216, 0, 0, 84, 300, 300), drawObject("Plate"), popGraphicsState());
  return doc.save({ useObjectStreams: false });
}
