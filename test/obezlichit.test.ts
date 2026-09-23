import { describe, expect, it } from "vitest";
import { PDFDocument, PDFDict, PDFName } from "pdf-lib";
import { applyPlan, makePlan, MARKER_KEY } from "../src/core/obezlichit";
import { extractText } from "../src/core/pdf/text";
import { seededRng } from "../src/core/synth/generate";
import { innComplete, innValid, uinControlDigit, uinValid } from "../src/core/synth/checksums";
import { identityPdf } from "./fixtures/make";

const uinBody = "1065269226120000123";
const UIN = uinBody + uinControlDigit(uinBody);
const INN = innComplete("5001007322");
const RESOLUTION = [
  `ПОСТАНОВЛЕНИЕ ${UIN}`,
  "Государственный инспектор Сидорова Анна Павловна, рассмотрев материалы,",
  "управляя ТС КАМАЗ 65115, ГРЗ K412TC69, нагрузка 11,42 т при допустимой 10,00 т",
  "Собственником данного ТС в соответствии со свидетельством о регистрации ТС №9900123456, на",
  `момент фиксации нарушения является Петров Иван Сергеевич Дата рождения: 01.02.1980 ИНН ФЛ: ${INN}`,
  `Сумма штрафа 300 000 руб. УИН: ${UIN}`,
  "А.П. Сидорова",
];
const ACT = ["Акт № 35000001 от 17.07.2026", "Номер ГРЗ АТС К412ТС69", "Измеренные нагрузки на ось 11,42"];

const ORIGINALS = [UIN, "K412TC69", "К412ТС69", "Сидорова", "Петров", "Иван Сергеевич", "9900123456", "01.02.1980", INN];

describe("обезличивание синтетического комплекта", async () => {
  const plan = await makePlan(
    [{ name: "scan.pdf", bytes: await identityPdf(RESOLUTION) }, { name: "act.pdf", bytes: await identityPdf(ACT) }],
    seededRng(42),
  );
  const out = await applyPlan(plan);
  const texts = await Promise.all(out.map((o) => extractText(o.bytes)));

  it("исходных значений нет ни в одном файле", () => {
    for (const t of texts) for (const o of ORIGINALS) expect(t).not.toContain(o);
  });

  it("постановление и акт получили один и тот же ГРЗ, письменность сохранена", () => {
    const s = [...plan.substitutions.values()].find((x) => x.kind === "plate")!;
    expect(s.count).toBe(2);
    expect(texts[1]).toContain(s.replacement);
    expect(texts[0]).toMatch(/ГРЗ [ABEKMHOPCTYX]\d{3}[ABEKMHOPCTYX]{2}69/);
  });

  it("ФИО и инициалы — заглушки, порядок текста сохранён", () => {
    expect(texts[0]).toContain("инспектор Тестов Тест Тестович, рассмотрев");
    expect(texts[0]).toContain("является Тестов Тест Тестович Дата рождения");
    expect(texts[0]).toContain("Т.Т. Тестов");
  });

  it("синтетика проходит контрольные суммы; даты, веса и суммы не тронуты", () => {
    const uin = [...plan.substitutions.values()].find((x) => x.kind === "uin")!.replacement;
    const inn = [...plan.substitutions.values()].find((x) => x.kind === "inn")!.replacement;
    expect(uinValid(uin) && uin.startsWith(UIN.slice(0, 10))).toBe(true);
    expect(innValid(inn)).toBe(true);
    expect(texts[0]).toContain("11,42 т при допустимой 10,00 т");
    expect(texts[0]).toContain("300 000 руб.");
    expect(texts[1]).toContain("Акт № 35000001 от 17.07.2026");
  });

  it("все подмены набраны исходным шрифтом, маркер записан", async () => {
    for (const o of out) {
      expect(o.report.unencodable).toEqual([]);
      expect(o.report.notFound).toEqual([]);
      const doc = await PDFDocument.load(o.bytes);
      const info = doc.context.lookup(doc.context.trailerInfo.Info) as PDFDict;
      expect(info.get(PDFName.of(MARKER_KEY))?.toString()).toContain("obezlichit/");
    }
  });
});
