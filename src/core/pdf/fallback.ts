// Запасной шрифт — Liberation Serif (SIL OFL 1.1), метрически совместимый с Times New Roman,
// которым набраны постановления. Встраивается урезанным и только если в шрифте документа
// не хватает букв подмены. Полужирное значение набирается полужирным.
import fontkit from "@pdf-lib/fontkit";
import { PDFName, type PDFDocument, type PDFFont } from "pdf-lib";
import type { Fallback } from "./rewrite";

export interface FallbackFonts { regular: Uint8Array; bold: Uint8Array }

let fonts: FallbackFonts | undefined;
let loader: (() => Promise<FallbackFonts>) | undefined;

/** Байты шрифтов: на странице их подкладывает сборка; в Node читаются из `assets/fonts`. */
export function setFallbackFonts(f: FallbackFonts): void { fonts = f; }
/** Отложенная загрузка — шрифты нужны редко, страница грузит их только по требованию. */
export function setFallbackLoader(fn: () => Promise<FallbackFonts>): void { loader = fn; }

async function load(): Promise<FallbackFonts> {
  if (fonts) return fonts;
  if (loader) return (fonts = await loader());
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const { dirname, join } = await import("node:path");
  const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "assets", "fonts");
  const read = (n: string): Uint8Array => new Uint8Array(readFileSync(join(dir, n)));
  fonts = { regular: read("LiberationSerif-Regular.ttf"), bold: read("LiberationSerif-Bold.ttf") };
  return fonts;
}

export async function makeFallback(doc: PDFDocument): Promise<Fallback> {
  doc.registerFontkit(fontkit);
  const f = await load();
  // оба начертания готовятся заранее (embedFont асинхронный), урезаются при сохранении
  const regular = await doc.embedFont(f.regular, { subset: true });
  const bold = await doc.embedFont(f.bold, { subset: true });
  const pick = (b: boolean): PDFFont => (b ? bold : regular);
  const name = (b: boolean): string => (b ? "FObzB" : "FObz");
  const attached = new Set<string>();
  return {
    name,
    encode: (text, b) => pick(b).encodeText(text).toString().slice(1, -1),
    width: (text, b) => pick(b).widthOfTextAtSize(text, 1000),
    attach: (page, b) => {
      const key = `${page.ref.toString()}:${b}`;
      if (attached.has(key)) return;
      page.node.setFontDictionary(PDFName.of(name(b)), pick(b).ref);
      attached.add(key);
    },
  };
}
