import { describe, expect, it } from "vitest";
import { PDFDocument, PDFName, PDFDict, PDFArray, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import { lex, textShows } from "../src/core/pdf/lexer";
import { fontInfo, parseToUnicode } from "../src/core/pdf/fonts";
import { identityPdf } from "./fixtures/make";

const enc = (s: string): Uint8Array => Uint8Array.from([...s].map((c) => c.charCodeAt(0)));

describe("lex", () => {
  it("литеральные строки с экранированием и восьмеричными кодами", () => {
    const t = lex(enc("(a\\(b\\)\\101\\n) Tj"));
    expect(t[0]).toMatchObject({ t: "str", v: "61286229410A" });
    expect(t[1]).toMatchObject({ t: "op", v: "Tj" });
  });
  it("hex-строки, числа, имена, массивы TJ", () => {
    const t = lex(enc("/F1 12 Tf [<0102> -3.5 <03>] TJ"));
    expect(t.map((x) => x.t)).toEqual(["name", "num", "op", "[", "str", "num", "str", "]", "op"]);
  });
  it("встроенное изображение пропускается целиком", () => {
    const t = lex(enc("BI /W 1 /H 1 ID \x00\xffEI\x01 EI Q"));
    expect(t.filter((x) => x.t === "op").map((x) => (x as { v: string }).v)).toEqual(["BI", "ID", "Q"]);
  });
});

describe("textShows", () => {
  it("состояние шрифта и Tc переживает q/Q как в спецификации", () => {
    const s = textShows(lex(enc("BT /F1 10 Tf 0.5 Tc q /F2 8 Tf (a) Tj Q (b) Tj [(c) 120 (d)] TJ ET")));
    expect(s.map((x) => [x.op, x.font, x.size, x.Tc])).toEqual([["Tj", "F2", 8, 0.5], ["Tj", "F1", 10, 0.5], ["TJ", "F1", 10, 0.5]]);
    expect(s[2]!.items).toEqual([{ t: "str", v: "63" }, { t: "num", v: 120 }, { t: "str", v: "64" }]);
  });
});

describe("parseToUnicode", () => {
  it("bfchar, bfrange с базой и с массивом", () => {
    const cmap = `1 begincodespacerange <0000> <FFFF> endcodespacerange
2 beginbfchar <0003> <0020> <0010> <0421> endbfchar
2 beginbfrange <0020> <0022> <0430> <0030> <0031> [<0041> <0042>] endbfrange`;
    const { map, codeLen } = parseToUnicode(cmap);
    expect(codeLen).toBe(2);
    expect([map.get("0003"), map.get("0010"), map.get("0021"), map.get("0031")]).toEqual([" ", "С", "б", "B"]);
  });
});

describe("fontInfo на синтетическом PDF (Identity-H)", () => {
  it("коды из потока раскодируются в исходный текст, обратная карта кодирует обратно", async () => {
    const line = "Собственник Тестов Т.Т., ГРЗ В621ОН69";
    const bytes = await identityPdf([line]);
    const doc = await PDFDocument.load(bytes);
    const ctx = doc.context;
    const lookup = (o: unknown) => (o ? ctx.lookup(o as never) : undefined);
    const page = doc.getPage(0).node;
    const fonts = (page.Resources()!.lookup(PDFName.of("Font")) as PDFDict);
    const [name, ref] = fonts.entries()[0]!;
    const fi = fontInfo(ref, lookup);
    expect(fi.codeLen).toBe(2);
    expect(fi.hasToUnicode).toBe(true);
    const contents = page.Contents();
    const streams = contents instanceof PDFArray ? contents.asArray().map((r) => ctx.lookup(r)) : [contents];
    const data = streams.map((s) => decodePDFRawStream(s as PDFRawStream).decode());
    const shows = textShows(lex(data[0]!));
    expect(shows[0]!.font).toBe(name.asString().slice(1));
    const hexs = shows.flatMap((s) => s.items.filter((i) => i.t === "str").map((i) => i.v as string)).join("");
    const text = hexs.match(/.{4}/g)!.map((c) => fi.map.get(c) ?? "?").join("");
    expect(text).toBe(line);
    expect([..."Тестов"].every((ch) => fi.rev.has(ch))).toBe(true);
    expect(fi.width(fi.rev.get("Т")!)).toBeGreaterThan(0);
  });
});
