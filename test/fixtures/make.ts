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
