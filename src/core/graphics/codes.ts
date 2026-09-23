// QR-коды и штрихкоды в постановлениях нарисованы векторами — залитыми прямоугольниками.
// Модуль находит их кластеры прямо в потоке команд, читает (своя растеризация прямоугольников →
// jsQR / zxing), удаляет исходные контуры и рисует код заново с подменёнными данными.
import jsQR from "jsqr";
import { BarcodeFormat, BinaryBitmap, DecodeHintType, HybridBinarizer, MultiFormatReader, RGBLuminanceSource } from "@zxing/library";
import QRCode from "qrcode";
import bwipjs from "bwip-js";
import type { Token } from "../pdf/lexer";

type M = [number, number, number, number, number, number];
const mul = (a: M, b: M): M => [
  a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3],
  a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3],
  a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5],
];
const apply = (m: M, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

export type Box = [number, number, number, number]; // x0, y0, x1, y1 — в координатах страницы (y вверх)

export interface FilledPath { boxes: Box[]; from: number; to: number } // индексы токенов [from, to]

/** Залитые пути из прямоугольников: каждый подпуть — осевой прямоугольник. */
export function filledRectPaths(toks: Token[]): FilledPath[] {
  const out: FilledPath[] = [];
  let ctm: M = [1, 0, 0, 1, 0, 0];
  const stack: M[] = [];
  let nums: number[] = [];
  let start = -1;
  let subs: Array<Array<[number, number]>> = [];
  let rectOnly = true;
  const reset = (): void => { start = -1; subs = []; rectOnly = true; };
  toks.forEach((t, k) => {
    if (t.t === "num") { nums.push(t.v); if (start < 0) start = k; return; }
    if (t.t !== "op") { nums = []; return; }
    const n = nums;
    nums = [];
    switch (t.v) {
      case "q": stack.push(ctm); reset(); break;
      case "Q": ctm = stack.pop() ?? ctm; reset(); break;
      case "cm": if (n.length === 6) ctm = mul(n as M, ctm); reset(); break;
      case "re": {
        if (start < 0) start = k - 4;
        const [x, y, w, h] = n as [number, number, number, number];
        subs.push([apply(ctm, x, y), apply(ctm, x + w, y), apply(ctm, x + w, y + h), apply(ctm, x, y + h)]);
        break;
      }
      case "m": if (start < 0) start = k - 2; subs.push([apply(ctm, n[0]!, n[1]!)]); break;
      case "l": subs.at(-1)?.push(apply(ctm, n[0]!, n[1]!)); break;
      case "h": break;
      case "c": case "v": case "y": rectOnly = false; break;
      case "f": case "F": case "f*": {
        if (start >= 0 && rectOnly && subs.length) {
          const boxes: Box[] = [];
          let ok = true;
          for (const p of subs) {
            const xs = p.map((q) => q[0]), ys = p.map((q) => q[1]);
            const b: Box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
            // осевой прямоугольник: все вершины на границе рамки
            const onEdge = ([x, y]: [number, number]): boolean => Math.abs(x - b[0]) < 0.01 || Math.abs(x - b[2]) < 0.01 || Math.abs(y - b[1]) < 0.01 || Math.abs(y - b[3]) < 0.01;
            const corners = [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]].every(([cx, cy]) => p.some(([x, y]) => Math.abs(x - cx!) < 0.01 && Math.abs(y - cy!) < 0.01));
            if (p.length < 4 || !p.every(onEdge) || !corners) { ok = false; break; }
            boxes.push(b);
          }
          if (ok) out.push({ boxes, from: start, to: k });
        }
        reset();
        break;
      }
      default: reset();
    }
  });
  return out;
}

export interface Cluster { box: Box; paths: FilledPath[]; rects: Box[] }

/** Кластеры мелких прямоугольников: модули QR и штрихи 1D-кодов. */
export function codeClusters(paths: FilledPath[]): Cluster[] {
  const small = paths.filter((p) => p.boxes.every((b) => b[2] - b[0] < 12 && b[3] - b[1] < 60));
  const cl: Cluster[] = [];
  for (const p of small) {
    const pb = p.boxes.reduce<Box>((a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])], [...p.boxes[0]!]);
    // зазор — до двух модулей: порог растёт с размером модуля (крупный QR не разваливается)
    const unit = Math.min(...p.boxes.map((b) => Math.min(b[2] - b[0], b[3] - b[1])));
    const gx = Math.max(4.5, 2.2 * unit), gy = Math.max(1.5, 2.2 * unit);
    const near = (c: Cluster): boolean => pb[0] < c.box[2] + gx && pb[2] > c.box[0] - gx && pb[1] < c.box[3] + gy && pb[3] > c.box[1] - gy;
    const hit = cl.filter(near);
    const into: Cluster = hit[0] ?? { box: [...pb], paths: [], rects: [] };
    if (!hit.length) cl.push(into);
    for (const o of hit.slice(1)) {
      into.paths.push(...o.paths); into.rects.push(...o.rects);
      into.box = [Math.min(into.box[0], o.box[0]), Math.min(into.box[1], o.box[1]), Math.max(into.box[2], o.box[2]), Math.max(into.box[3], o.box[3])];
      cl.splice(cl.indexOf(o), 1);
    }
    into.paths.push(p); into.rects.push(...p.boxes);
    into.box = [Math.min(into.box[0], pb[0]), Math.min(into.box[1], pb[1]), Math.max(into.box[2], pb[2]), Math.max(into.box[3], pb[3])];
  }
  return cl.filter((c) => c.rects.length >= 25);
}

/** Растеризация прямоугольников кластера в RGBA (чёрное на белом) с полями. */
function rasterize(c: Cluster, sx: number, sy: number, pad: number): { w: number; h: number; px: Uint8ClampedArray } {
  const [x0, y0, x1, y1] = c.box;
  const w = Math.ceil((x1 - x0 + 2 * pad) * sx), h = Math.ceil((y1 - y0 + 2 * pad) * sy);
  const px = new Uint8ClampedArray(w * h * 4).fill(255);
  for (const [a, b, cc, d] of c.rects) {
    const X0 = Math.round((a - x0 + pad) * sx), X1 = Math.round((cc - x0 + pad) * sx);
    const Y0 = Math.round((y1 + pad - d) * sy), Y1 = Math.round((y1 + pad - b) * sy); // y вниз
    for (let y = Math.max(0, Y0); y < Math.min(h, Y1); y++) for (let x = Math.max(0, X0); x < Math.min(w, X1); x++) {
      const i = (y * w + x) * 4; px[i] = px[i + 1] = px[i + 2] = 0;
    }
  }
  return { w, h, px };
}

export interface DecodedCode { format: "QR_CODE" | "CODE_128" | string; data: string; bytes?: number[]; cluster: Cluster }

export function decodeCluster(c: Cluster): DecodedCode | null {
  const flat = c.box[3] - c.box[1] < 25 && c.box[2] - c.box[0] > 3 * (c.box[3] - c.box[1]);
  if (!flat) {
    for (const s of [6, 10]) {
      const r = rasterize(c, s, s, 4);
      const q = jsQR(r.px, r.w, r.h);
      if (q) return { format: "QR_CODE", data: q.data, bytes: q.binaryData, cluster: c };
    }
  }
  for (const s of [8, 12]) {
    const r = rasterize(c, s, flat ? s * 4 : s, 6);
    const lum = new Uint8ClampedArray(r.w * r.h);
    for (let i = 0; i < r.w * r.h; i++) lum[i] = r.px[i * 4]!;
    try {
      const reader = new MultiFormatReader();
      const hints = new Map<DecodeHintType, unknown>([[DecodeHintType.TRY_HARDER, true], [DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_128, BarcodeFormat.CODE_39, BarcodeFormat.ITF, BarcodeFormat.EAN_13]]]);
      const res = reader.decode(new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(lum, r.w, r.h))), hints);
      return { format: BarcodeFormat[res.getBarcodeFormat()], data: res.getText(), cluster: c };
    } catch { /* не читается */ }
  }
  return null;
}

const f3 = (v: number): string => String(+v.toFixed(3));

/** Операторы рисования кода заново в рамке исходного (координаты страницы). */
export function drawCode(code: DecodedCode, data: string): string {
  const [x0, y0, x1, y1] = code.cluster.box;
  let ops = "0 g\n";
  if (code.format === "QR_CODE") {
    const bytes = code.bytes ?? [];
    const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(Uint8Array.from(bytes)) === code.data;
    const payload = utf8 ? new TextEncoder().encode(data) : cp1251(data);
    const q = QRCode.create([{ data: payload, mode: "byte" }], { errorCorrectionLevel: "M" });
    const n = q.modules.size, m = (x1 - x0) / n;
    // модуль — отдельный квадрат, как у исходных генераторов: так код остаётся узнаваемым для самопроверки
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++)
      if (q.modules.get(r, c)) ops += `${f3(x0 + c * m)} ${f3(y1 - (r + 1) * m)} ${f3(m)} ${f3(m)} re\n`;
  } else {
    const svg = bwipjs.toSVG({ bcid: code.format === "CODE_39" ? "code39" : "code128", text: data, height: 10, includetext: false });
    const vbW = Number(svg.match(/viewBox="0 0 (\d+)/)?.[1] ?? 1);
    const k = (x1 - x0) / vbW;
    for (const m of svg.matchAll(/stroke-width="([\d.]+)" d="([^"]+)"/g)) {
      const w = Number(m[1]);
      for (const x of [...m[2]!.matchAll(/M([\d.]+) /g)].map((a) => Number(a[1])))
        ops += `${f3(x0 + (x - w / 2) * k)} ${f3(y0)} ${f3(w * k)} ${f3(y1 - y0)} re\n`;
    }
  }
  return ops + "f\n";
}

function cp1251(s: string): Uint8Array {
  const out: number[] = [];
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c < 0x80) out.push(c);
    else if (c >= 0x410 && c <= 0x44f) out.push(c - 0x410 + 0xc0);
    else out.push(({ 0x401: 0xa8, 0x451: 0xb8, 0x2116: 0xb9, 0xab: 0xab, 0xbb: 0xbb, 0x2013: 0x96, 0x2014: 0x97 } as Record<number, number>)[c] ?? 0x3f);
  }
  return Uint8Array.from(out);
}

export interface CodesReport { redrawn: number; removed: number }

/** Подменить коды в потоке страницы: исходные контуры вырезаются, новые рисуются поверх. */
export function replaceCodes(bytes: Uint8Array, toks: Token[], substitute: (data: string) => string, report: CodesReport): Uint8Array | null {
  const clusters = codeClusters(filledRectPaths(toks));
  if (!clusters.length) return null;
  const cuts: Array<[number, number]> = [];
  let ops = "";
  for (const c of clusters) {
    const d = decodeCluster(c);
    for (const p of c.paths) cuts.push([toks[p.from]!.start, toks[p.to]!.end]);
    if (d) { ops += drawCode(d, substitute(d.data)); report.redrawn++; }
    else report.removed++;
  }
  cuts.sort((a, b) => a[0] - b[0]);
  const parts: Uint8Array[] = [enc("q\n")];
  let at = 0;
  for (const [a, b] of cuts) { parts.push(bytes.subarray(at, a)); at = b; }
  parts.push(bytes.subarray(at), enc("\nQ\nq\n" + ops + "Q\n"));
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

const enc = (s: string): Uint8Array => Uint8Array.from([...s].map((c) => c.charCodeAt(0)));
