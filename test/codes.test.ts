import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { applyPlan, makePlan } from "../src/core/obezlichit";
import { pageModel } from "../src/core/pdf/rewrite";
import { codeClusters, decodeCluster, filledRectPaths } from "../src/core/graphics/codes";
import { seededRng } from "../src/core/synth/generate";
import { uinControlDigit } from "../src/core/synth/checksums";
import { pdfWithQr } from "./fixtures/make";

const body = "1065269226120000123";
const UIN = body + uinControlDigit(body);

async function codesOf(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().flatMap((p) => codeClusters(filledRectPaths(pageModel(doc, p).toks)).map(decodeCluster));
}

describe("векторные QR", () => {
  it("находятся и читаются без растрового движка", async () => {
    const codes = await codesOf(await pdfWithQr([`УИН: ${UIN}`], `uin=${UIN}|LastName=Петров Иван Сергеевич`));
    expect(codes.map((c) => c?.data)).toEqual([`uin=${UIN}|LastName=Петров Иван Сергеевич`]);
  });

  it("перерисовываются с подменёнными данными, исходных значений не остаётся", async () => {
    const src = await pdfWithQr([`УИН: ${UIN}`, "Плательщик: Петров Иван Сергеевич"], `uin=${UIN}|LastName=Петров Иван Сергеевич`);
    const plan = await makePlan([{ name: "a.pdf", bytes: src }], seededRng(1));
    const [out] = await applyPlan(plan);
    expect(out!.report.codes).toEqual({ redrawn: 1, removed: 0 });
    const newUin = [...plan.substitutions.values()].find((s) => s.kind === "uin")!.replacement;
    const codes = await codesOf(out!.bytes);
    expect(codes.map((c) => c?.data)).toEqual([`uin=${newUin}|LastName=Тестов Тест Тестович`]);
  });
});
