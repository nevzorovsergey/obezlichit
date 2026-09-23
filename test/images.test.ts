import { describe, expect, it } from "vitest";
import { PDFDocument, PDFDict, PDFName, PDFRawStream } from "pdf-lib";
import { decompressSync } from "fflate";
import { applyPlan, makePlan } from "../src/core/obezlichit";
import { classify, pixelate, unpredict } from "../src/core/graphics/images";
import { pdfWithImages } from "./fixtures/make";

describe("PNG-предиктор", () => {
  it("снимает фильтры Sub, Up, Average и Paeth", () => {
    // 2×2, 1 канал: строка 1 — Sub, строка 2 — Up
    expect([...unpredict(Uint8Array.from([1, 10, 5, 2, 1, 1]), 2, 1)]).toEqual([10, 15, 11, 16]);
    // Average и Paeth на второй строке
    expect([...unpredict(Uint8Array.from([0, 10, 20, 3, 5, 5]), 2, 1)]).toEqual([10, 20, 10, 20]);
    expect([...unpredict(Uint8Array.from([0, 10, 20, 4, 1, 1]), 2, 1)]).toEqual([10, 20, 11, 21]);
  });
});

describe("классификация и пикселизация", () => {
  it("кроп номера и фото распознаются по размерам, остальное — нет", () => {
    expect([classify(216, 84), classify(1141, 765), classify(723, 144), classify(159, 178)]).toEqual(["plate", "photo", null, null]);
  });
  it("в блоке — одно среднее значение", () => {
    const img = pixelate({ w: 4, h: 2, comps: 1, px: Uint8Array.from([0, 255, 0, 255, 255, 0, 255, 0]) }, 2);
    expect([...img.px]).toEqual([128, 128, 128, 128, 128, 128, 128, 128]);
  });
});

describe("фото и кроп номера в PDF", () => {
  it("оба изображения пикселизованы: шахматка превращается в ровный серый", async () => {
    const plan = await makePlan([{ name: "p.pdf", bytes: await pdfWithImages() }]);
    const [out] = await applyPlan(plan);
    expect(out!.report.images).toEqual({ pixelated: 2, replaced: 0 });
    const doc = await PDFDocument.load(out!.bytes);
    const xo = doc.getPage(0).node.Resources()!.lookup(PDFName.of("XObject")) as PDFDict;
    for (const [, ref] of xo.entries()) {
      const s = doc.context.lookup(ref) as PDFRawStream;
      const px = decompressSync(s.contents);
      let lo = 255, hi = 0;
      for (const v of px) { if (v < lo) lo = v; if (v > hi) hi = v; }
      const spread = hi - lo;
      expect(spread).toBeLessThan(60);
    }
  });
});
