import { describe, expect, it } from "vitest";
import { innComplete, innValid, ogrnDigit, ogrnValid, uinControlDigit, uinValid } from "../src/core/synth/checksums";

// Синтетические векторы, посчитанные `tonnaprava.common.uin.control_digit` (бэкенд «Тонны права»).
// Последний — тело, у которого первый проход даёт остаток 10 и работает повтор со стартом 3.
const UIN_VECTORS = [
  "10655260181590830162",
  "10656131860913909968",
  "10650308246281948214",
  "10659935181909378655",
  "1065797543231948757491189",
  "1065625276018955597971140",
  "1065710497465075291703420",
  "1065366712768426846563218",
  "34788783848372616756",
];

describe("УИН", () => {
  it.each(UIN_VECTORS)("%s сходится с реализацией бэкенда", (uin) => {
    expect(uinControlDigit(uin.slice(0, -1))).toBe(Number(uin.at(-1)));
    expect(uinValid(uin)).toBe(true);
  });

  it("чужой контрольный разряд, длина и нецифры не проходят", () => {
    const u = UIN_VECTORS[0]!;
    expect(uinValid(u.slice(0, -1) + ((Number(u.at(-1)) + 1) % 10))).toBe(false);
    expect(uinValid(u.slice(0, -2))).toBe(false);
    expect(uinValid(u.replace("0", "O"))).toBe(false);
    expect(() => uinControlDigit("12a")).toThrow();
  });
});

describe("ИНН", () => {
  it.each(["123456789", "770012345", "1234567890", "7712345678"])("тело %s дополняется до верного ИНН", (body) => {
    const inn = innComplete(body);
    expect(inn.length).toBe(body.length + (body.length === 9 ? 1 : 2));
    expect(innValid(inn)).toBe(true);
  });

  it("испорченная цифра ломает ИНН", () => {
    const inn = innComplete("7712345678");
    const bad = inn.slice(0, 3) + ((Number(inn[3]) + 1) % 10) + inn.slice(4);
    expect(innValid(bad)).toBe(false);
    expect(innValid("12345")).toBe(false);
    expect(() => innComplete("1")).toThrow();
  });
});

describe("ОГРН", () => {
  it.each(["102770012345", "30477001234567"])("тело %s дополняется до верного номера", (body) => {
    expect(ogrnValid(body + ogrnDigit(body))).toBe(true);
    expect(ogrnValid(body + ((ogrnDigit(body) + 1) % 10))).toBe(false);
  });
});
