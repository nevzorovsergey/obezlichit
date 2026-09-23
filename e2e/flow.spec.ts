// Полный сценарий на синтетике: загрузка → подмены → самопроверка → скачивание.
// Главная проверка — страница не отправляет данных: ни одного POST, ни одного чужого адреса.
import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { identityPdf, pdfWithQr } from "../test/fixtures/make";
import { extractText } from "../src/core/pdf/text";
import { uinControlDigit } from "../src/core/synth/checksums";

const body = "1065269226120000123";
const UIN = body + uinControlDigit(body);
const RESOLUTION = [
  `ПОСТАНОВЛЕНИЕ ${UIN}`,
  "Государственный инспектор Сидорова Анна Павловна, рассмотрев материалы,",
  "управляя ТС КАМАЗ 65115, ГРЗ K412TC69, нагрузка 11,42 т при допустимой 10,00 т",
  "является Петров Иван Сергеевич Дата рождения: 01.02.1980",
];
const ACT = ["Акт № 35000001 от 17.07.2026", "Номер ГРЗ АТС К412ТС69"];
const ORIGINALS = [UIN, "K412TC69", "К412ТС69", "Сидорова", "Петров", "01.02.1980"];

function watch(page: Page) {
  const requests: Array<{ url: string; method: string }> = [];
  const violations: string[] = [];
  page.on("request", (r) => requests.push({ url: r.url(), method: r.method() }));
  page.on("console", (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text()); });
  return { requests, violations };
}

async function flow(page: Page, origin: string | null) {
  const net = watch(page);
  await page.getByRole("heading", { name: "Обезличить постановление" }).waitFor();
  await page.locator("[data-input]").setInputFiles([
    { name: "10121400123_scan.pdf", mimeType: "application/pdf", buffer: Buffer.from(await pdfWithQr(RESOLUTION, `uin=${UIN}|LastName=Петров Иван Сергеевич`)) },
    { name: "10121400123_actwsc.pdf", mimeType: "application/pdf", buffer: Buffer.from(await identityPdf(ACT)) },
  ]);
  await expect(page.getByTestId("files")).toContainText("Постановление · 1 стр.");
  await expect(page.getByTestId("files")).toContainText("Акт измерений · 1 стр.");
  await page.getByRole("button", { name: "Проверить подмены" }).click();

  await expect(page.getByTestId("sub-uin")).toContainText(UIN);
  await expect(page.getByTestId("sub-plate")).toContainText("×2");
  await expect(page.getByTestId("subs")).toContainText("Тестов Тест Тестович");
  await expect(page.getByTestId("subs")).toContainText("QR и штрихкоды");
  await expect(page.locator(".sheet canvas")).toBeVisible();
  const apply = page.getByRole("button", { name: "Обезличить и проверить" });
  await expect(apply).toBeDisabled();
  await page.getByText(/Я просмотрел все страницы/).click();
  await apply.click();

  await expect(page.getByTestId("clean")).toHaveText("Исходных значений в файлах не нашли");
  await page.getByRole("button", { name: "Скачать", exact: true }).click();
  await expect(page.getByTestId("downloads")).toContainText("postanovlenie-1.pdf");
  await expect(page.getByTestId("downloads")).toContainText("akt-1.pdf");
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByTestId("downloads").getByRole("button", { name: "Скачать" }).first().click()]);
  expect(dl.suggestedFilename()).toBe("postanovlenie-1.pdf");
  const text = await extractText(new Uint8Array(readFileSync((await dl.path())!)));
  for (const o of ORIGINALS) expect(text).not.toContain(o);
  expect(text).toContain("является Тестов Тест Тестович Дата рождения");

  expect(net.violations).toEqual([]);
  expect(net.requests.filter((r) => r.method !== "GET")).toEqual([]);
  if (origin) expect(net.requests.filter((r) => !r.url.startsWith(origin) && !r.url.startsWith("blob:") && !r.url.startsWith("data:"))).toEqual([]);
  else expect(net.requests.filter((r) => /^https?:/.test(r.url))).toEqual([]);
}

test("размещённая страница: полный сценарий без сетевых данных", async ({ page, baseURL }) => {
  await page.goto("/");
  await flow(page, baseURL!);
});

test("автономный HTML с диска: тот же сценарий", async ({ page }) => {
  await page.goto(pathToFileURL(resolve("dist/obezlichit.html")).href);
  await flow(page, null);
});

test("скан без текста отклоняется с пояснением", async ({ page }) => {
  const { PDFDocument } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  doc.addPage();
  await page.goto("/");
  await page.locator("[data-input]").setInputFiles([{ name: "scan.pdf", mimeType: "application/pdf", buffer: Buffer.from(await doc.save()) }]);
  await expect(page.getByText("Это скан или фото — текста в файле нет").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Проверить подмены" })).toBeDisabled();
});
