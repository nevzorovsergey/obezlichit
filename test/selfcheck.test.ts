import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { applyPlan, makePlan } from "../src/core/obezlichit";
import { selfcheck } from "../src/core/selfcheck";
import { seededRng } from "../src/core/synth/generate";
import { uinControlDigit } from "../src/core/synth/checksums";
import { identityPdf, pdfWithQr } from "./fixtures/make";

const body = "1065269226120000123";
const UIN = body + uinControlDigit(body);
const LINES = [`ПОСТАНОВЛЕНИЕ ${UIN}`, "является Петров Иван Сергеевич Дата рождения: 01.02.1980", "ГРЗ K412TC69"];
const ORIGINALS = [UIN, "Петров Иван Сергеевич", "01.02.1980", "K412TC69"];

describe("самопроверка", () => {
  it("обезличенный файл чист во всех четырёх местах", async () => {
    const plan = await makePlan([{ name: "a.pdf", bytes: await pdfWithQr(LINES, `uin=${UIN}`) }], seededRng(3));
    const [out] = await applyPlan(plan);
    const r = await selfcheck(out!.bytes, ORIGINALS);
    expect(r.leaks).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.checked.codes).toBe(1);
    expect(r.checked.revisions).toBe(1);
  });

  it("исходный файл ловится в тексте и в коде", async () => {
    // в потоках кириллица и цифры закодированы кодами шрифта Identity-H — там их не видно
    const r = await selfcheck(await pdfWithQr(LINES, `uin=${UIN}`), ORIGINALS);
    expect(r.ok).toBe(false);
    expect(new Set(r.leaks.map((l) => l.where))).toEqual(new Set(["text", "codes"]));
  });

  it("исходное значение в метаданных и старая ревизия ловятся", async () => {
    const doc = await PDFDocument.load(await identityPdf(["пусто"]));
    doc.setAuthor("Петров Иван Сергеевич");
    const saved = await doc.save({ useObjectStreams: false });
    // дописанная инкрементальная ревизия — второй %%EOF
    const appended = new Uint8Array([...saved, ...new TextEncoder().encode("\n%%EOF\n")]);
    const r = await selfcheck(appended, ORIGINALS);
    expect(r.leaks.map((l) => l.where).sort()).toEqual(["metadata", "revisions"]);
  });
});
