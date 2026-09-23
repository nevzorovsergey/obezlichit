import { describe, expect, it } from "vitest";
import { applyPlan, makePlan } from "../src/core/obezlichit";
import { extractText } from "../src/core/pdf/text";
import { selfcheck } from "../src/core/selfcheck";
import { seededRng } from "../src/core/synth/generate";
import { identityPdf } from "./fixtures/make";

describe("запасной шрифт", () => {
  it("буквы «Т» нет в урезанном шрифте — ФИО набирается запасным шрифтом на своём месте", async () => {
    // в тексте нет заглавной «Т»: подмена «Тестов Тест Тестович» в исходном шрифте невозможна
    const lines = ["момент фиксации является Ким Юрий Юрьевич Дата рождения: 01.02.1980 далее"];
    const plan = await makePlan([{ name: "a.pdf", bytes: await identityPdf(lines) }], seededRng(5));
    expect([...plan.substitutions.values()].find((s) => s.kind === "fio")!.needsFallback).toBe(true);
    const [out] = await applyPlan(plan);
    expect(out!.report.fallback).toBe(1);
    expect(out!.report.unencodable).toEqual([]);
    const text = await extractText(out!.bytes);
    expect(text).toContain("является Тестов Тест Тестович Дата рождения: 01.02.2010 далее");
    expect((await selfcheck(out!.bytes, ["Ким Юрий Юрьевич", "01.02.1980"])).ok).toBe(true);
  });
});
