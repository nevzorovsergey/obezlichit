// Текст документа в порядке чтения — через pdf.js (как его видят сервисы, разбирающие PDF).
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

export async function extractText(bytes: Uint8Array): Promise<string> {
  const doc = await getDocument({ data: bytes.slice(), verbosity: 0, isEvalSupported: false }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    pages.push(content.items.map((it) => ("str" in it ? it.str + (it.hasEOL ? "\n" : "") : "")).join(""));
  }
  await doc.destroy();
  return pages.join("\n");
}
