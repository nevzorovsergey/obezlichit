import { describe, expect, it } from "vitest";
import { addManual, applyPlan, makePlan, originalsOf } from "../src/core/obezlichit";
import { extractText } from "../src/core/pdf/text";
import { selfcheck } from "../src/core/selfcheck";
import { seededRng } from "../src/core/synth/generate";
import { uinControlDigit } from "../src/core/synth/checksums";
import { identityPdf, pdfWithImages } from "./fixtures/make";

const body = "1065269226120000123";
const UIN = body + uinControlDigit(body);
const LINES = [`ПОСТАНОВЛЕНИЕ ${UIN}`, "является Петров Иван Сергеевич Дата рождения: 01.02.1980", "Телефон собственника 8 900 123 45 67 указан в деле"];

describe("план как на странице: правки и повторное применение", async () => {
  const plan = await makePlan([{ name: "a.pdf", bytes: await identityPdf(LINES) }], seededRng(9));

  it("тип документа и число страниц", () => {
    expect(plan.files[0]).toMatchObject({ docType: "resolution", pages: 1, hasText: true });
  });

  it("правка подмены пользователем применяется, повторный прогон идёт с чистого документа", async () => {
    const uin = [...plan.substitutions.values()].find((s) => s.kind === "uin")!;
    const first = await extractText((await applyPlan(plan))[0]!.bytes);
    expect(first).toContain(uin.replacement);
    uin.replacement = body.slice(0, 10) + "999999999" + "0";
    const second = await extractText((await applyPlan(plan))[0]!.bytes);
    expect(second).toContain(uin.replacement);
    expect(second).not.toContain(UIN);
  });

  it("снятая находка остаётся как есть", async () => {
    const date = [...plan.substitutions.values()].find((s) => s.kind === "date")!;
    date.enabled = false;
    const t = await extractText((await applyPlan(plan))[0]!.bytes);
    expect(t).toContain("01.02.1980");
    date.enabled = true;
  });

  it("выделенное вручную заменяется значением той же формы и попадает в самопроверку", async () => {
    const s = (await addManual(plan, "8 900 123 45 67", seededRng(2)))!;
    expect(s.count).toBe(1);
    expect(s.replacement).toMatch(/^\d \d{3} \d{3} \d{2} \d{2}$/);
    const [out] = await applyPlan(plan);
    const t = await extractText(out!.bytes);
    expect(t).toContain(s.replacement);
    expect((await selfcheck(out!.bytes, originalsOf(plan))).ok).toBe(true);
    expect(await addManual(plan, "такого текста нет")).toBeNull();
  });
});

describe("фото", () => {
  it("«не размывать» оставляет изображения", async () => {
    const plan = await makePlan([{ name: "p.pdf", bytes: await pdfWithImages() }]);
    const [out] = await applyPlan(plan, { keepPhotos: true });
    expect(out!.report.images).toEqual({ pixelated: 0, replaced: 0 });
  });
});
