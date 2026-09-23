// Запасной шрифт: DejaVu Serif (свободная лицензия Bitstream Vera), встраивается урезанным —
// только если в шрифте документа не хватает букв подмены.
import fontkit from "@pdf-lib/fontkit";
import { PDFName, type PDFDocument, type PDFPage } from "pdf-lib";
import type { Fallback } from "./rewrite";

let fontBytes: Uint8Array | undefined;

/** Байты шрифта: в Node — из пакета, на странице их подкладывает сборка (setFallbackFont). */
export function setFallbackFont(bytes: Uint8Array): void { fontBytes = bytes; }

async function loadFont(): Promise<Uint8Array> {
  if (fontBytes) return fontBytes;
  const { readFileSync } = await import("node:fs");
  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  fontBytes = new Uint8Array(readFileSync(require.resolve("dejavu-fonts-ttf/ttf/DejaVuSerif.ttf")));
  return fontBytes;
}

export async function makeFallback(doc: PDFDocument): Promise<Fallback> {
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(await loadFont(), { subset: true });
  const name = "FObz";
  const attached = new Set<PDFPage>();
  return {
    name,
    encode: (text) => font.encodeText(text).toString().slice(1, -1),
    width: (text) => font.widthOfTextAtSize(text, 1000),
    attach: (page) => { if (!attached.has(page)) { page.node.setFontDictionary(PDFName.of(name), font.ref); attached.add(page); } },
  };
}
