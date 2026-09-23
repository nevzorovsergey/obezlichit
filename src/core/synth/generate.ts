// Синтетика той же формы, что исходник: верные контрольные суммы, код региона ГРЗ, регистр.
// `cover` — символы, которые есть во всех шрифтах, где стоит значение: подмена набирается
// исходным шрифтом, а в урезанном шрифте есть не все буквы.
import type { Find, Kind } from "../detect/detect";
import { CYR, LAT } from "../detect/detect";
import { innComplete, ogrnDigit, uinControlDigit } from "./checksums";
import { fioReplacement, initialsReplacement } from "./fio";

export type Rng = () => number; // [0, 1)

export function cryptoRng(): Rng {
  const buf = new Uint32Array(1);
  return () => { crypto.getRandomValues(buf); return (buf[0] ?? 0) / 2 ** 32; };
}

export function seededRng(seed: number): Rng {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2 ** 32; };
}

const toCyr = (s: string): string => s.replace(/[ABEKMHOPCTYX]/g, (c) => CYR[LAT.indexOf(c)]!);

/** Ключ значения: одинаковые значения в разных написаниях получают одну подмену. */
export function keyOf(kind: Kind, value: string): string {
  const v = value.replace(/\s+/g, " ").trim();
  if (kind === "plate") return "plate:" + toCyr(v.toUpperCase());
  if (["uin", "inn", "ogrn", "kpp", "sts", "case", "shpi", "index"].includes(kind)) return kind + ":" + v.replace(/\D/g, "");
  if (kind === "fio" || kind === "initials") return kind + ":" + v.toUpperCase();
  return kind + ":" + v.toUpperCase();
}

const OWNER_UL = ['ООО "ТЕСТ ТРАНС"', 'ООО "ПРИМЕР"', 'АО "СТРОЙ ТЕСТ"', 'ООО "ОРИОН"', 'ООО "ЛОГИСТИКА"'];
const ADDRESSES = [
  "123456, Г.ТЕСТОВСК, УЛ. ПРИМЕРНАЯ, Д. 1",
  "123456, Г.ТЕСТОВСК, ВН.ТЕР.Г. МУНИЦИПАЛЬНЫЙ ОКРУГ ОПЫТНЫЙ, УЛ. ПРИМЕРНАЯ, Д. 10",
  "101000, Г.МОСКВА, ВН.ТЕР.Г. МУНИЦИПАЛЬНЫЙ ОКРУГ ТЕСТОВЫЙ, УЛ. ОБРАЗЦОВАЯ, Д. 5, СТР. 2",
];

export class Synth {
  constructor(private rng: Rng) {}
  private digits(n: number, cover?: Set<string>): string {
    const pool = [..."0123456789"].filter((d) => !cover || cover.has(d));
    const p = pool.length ? pool : [..."0123456789"];
    return Array.from({ length: n }, () => p[Math.floor(this.rng() * p.length)]).join("");
  }
  private pick<T>(a: T[]): T { return a[Math.floor(this.rng() * a.length)]!; }

  generate(f: Find, cover?: Set<string>): string {
    const v = f.value.replace(/\s+/g, " ").trim();
    const fits = (s: string): boolean => !cover || [...s].every((c) => c === " " || cover.has(c));
    const closest = (pool: string[]): string => {
      const cands = (v === v.toUpperCase() ? pool.map((p) => p.toUpperCase()) : pool)
        .sort((a, b) => Math.abs(a.length - v.length) - Math.abs(b.length - v.length));
      return cands.find(fits) ?? cands[0]!;
    };
    switch (f.kind) {
      case "uin": {
        for (;;) {
          const body = v.slice(0, 10) + this.digits(v.length - 11, cover);
          const uin = body + uinControlDigit(body);
          if (fits(uin) && uin !== v) return uin;
        }
      }
      case "plate": {
        const n = toCyr(v.replace(/\s+/g, "").toUpperCase());
        const own = [n[0]!, n[4]!, n[5]!];
        const both = [...CYR].filter((c) => !cover || (cover.has(c) && cover.has(LAT[CYR.indexOf(c)]!)));
        const letters = [...new Set([...both, ...own])];
        for (let i = 0; i < 20; i++) {
          const p = this.pick(letters) + this.digits(3, cover) + this.pick(letters) + this.pick(letters) + n.slice(6);
          if (p !== n) return p;
        }
        return n;
      }
      case "inn": { for (;;) { const s = innComplete("77" + this.digits(v.length === 10 ? 7 : 8, cover)); if (fits(s)) return s; } }
      case "ogrn": { for (;;) { const b = "102" + "77" + this.digits(v.length - 6, cover); const s = b + ogrnDigit(b); if (fits(s)) return s; } }
      case "fio": return fioReplacement(v);
      case "initials": return initialsReplacement(v);
      case "owner": return closest(OWNER_UL);
      case "address": return closest(ADDRESSES);
      case "index": return "123456";
      case "date": return "01.02.2010";
      default: return v.replace(/\d/g, () => this.digits(1, cover));
    }
  }
}

/** Письменность ГРЗ по каждому вхождению: латинская буква в исходнике — латинская в подмене. */
export function plateLike(syntheticCyr: string, orig: string): string {
  const o = orig.replace(/\s+/g, "");
  return [...syntheticCyr].map((c, i) => (LAT.includes(o[i] ?? "") && CYR.includes(c) ? LAT[CYR.indexOf(c)]! : c)).join("");
}
