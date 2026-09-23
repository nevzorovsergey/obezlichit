// Превью страницы: canvas pdf.js, подсветка найденных значений и прозрачный текстовый слой,
// на котором пользователь выделяет пропущенное. pdf.js — в этом же потоке, без своего воркера.
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import * as pdfjsWorker from "pdfjs-dist/legacy/build/pdf.worker.mjs";

(globalThis as unknown as { pdfjsWorker: unknown }).pdfjsWorker = pdfjsWorker;

type Doc = Awaited<ReturnType<typeof pdfjs.getDocument>["promise"]>;
const cache = new Map<Uint8Array, Promise<Doc>>();

function open(bytes: Uint8Array): Promise<Doc> {
  let p = cache.get(bytes);
  if (!p) {
    p = pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0, useSystemFonts: true }).promise;
    cache.set(bytes, p);
  }
  return p;
}

export async function pageCount(bytes: Uint8Array): Promise<number> {
  return (await open(bytes)).numPages;
}

/** Нарисовать страницу в контейнер; подсветить элементы текста, где встречаются значения. */
export async function renderPage(container: HTMLElement, bytes: Uint8Array, pageNo: number, values: string[], selectable: boolean): Promise<void> {
  const doc = await open(bytes);
  const page = await doc.getPage(pageNo);
  const base = page.getViewport({ scale: 1 });
  const width = container.clientWidth || 600;
  const viewport = page.getViewport({ scale: width / base.width });
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(viewport.width * ratio);
  canvas.height = Math.floor(viewport.height * ratio);
  canvas.setAttribute("aria-hidden", "true");
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  await page.render({ canvasContext: ctx, viewport, canvas }).promise;
  container.replaceChildren(canvas);
  container.style.aspectRatio = `${viewport.width} / ${viewport.height}`;

  const content = await page.getTextContent();
  const vals = values.map((v) => v.replace(/\s+/g, " ").trim()).filter((v) => v.length >= 3);
  const boxes: Array<[number, number]> = []; // доли ширины элемента: [начало, конец]
  for (const it of content.items) {
    if (!("str" in it) || it.str.trim().length < 2) continue;
    const str = it.str.replace(/\s+/g, " ");
    boxes.length = 0;
    for (const v of vals) {
      // значение внутри элемента — подсветить только его часть; элемент — кусок значения — целиком
      for (let at = str.indexOf(v); at >= 0; at = str.indexOf(v, at + 1)) boxes.push([at / str.length, (at + v.length) / str.length]);
      if (str.trim().length >= 3 && v.includes(str.trim())) boxes.push([0, 1]);
    }
    if (!boxes.length) continue;
    const [, b, , d, e, f] = it.transform as number[];
    const h = Math.hypot(b!, d!) || it.height;
    for (const [x0, x1] of boxes) {
    const r = viewport.convertToViewportRectangle([e! + it.width * x0, f! - h * 0.2, e! + it.width * x1, f! + h * 0.85]);
    const box = document.createElement("div");
    box.className = "hl";
    Object.assign(box.style, {
      left: `${Math.min(r[0]!, r[2]!)}px`, top: `${Math.min(r[1]!, r[3]!)}px`,
      width: `${Math.abs(r[2]! - r[0]!)}px`, height: `${Math.abs(r[3]! - r[1]!)}px`,
    });
    container.append(box);
    }
  }
  if (selectable) {
    const layer = document.createElement("div");
    layer.className = "textLayer";
    container.append(layer);
    layer.style.setProperty("--scale-factor", String(viewport.scale));
    await new pdfjs.TextLayer({ textContentSource: content, container: layer, viewport }).render();
  }
}

export function forget(bytes: Uint8Array): void {
  void cache.get(bytes)?.then((d) => d.destroy());
  cache.delete(bytes);
}
