// Контрольные суммы номеров: синтетика должна проходить те же проверки, что и настоящие номера,
// иначе сервис поднимет аномалию (например, `uin_checksum` в P4 «Тонны права»).

/** Контрольный разряд УИН по форматному контролю ГИС ГМП: веса 1…10 по кругу, модуль 11;
 * остаток 10 → повтор со стартом с веса 3; снова 10 → 0. Как `tonnaprava.common.uin.control_digit`. */
export function uinControlDigit(body: string): number {
  if (!/^\d+$/.test(body)) throw new Error("тело УИН состоит только из цифр");
  const digits = [...body].map(Number);
  const remainder = (start: number): number => {
    let sum = 0;
    let w = start;
    for (const d of digits) {
      sum += d * w;
      w = w < 10 ? w + 1 : 1;
    }
    return sum % 11;
  };
  const r = remainder(1);
  if (r !== 10) return r;
  const r2 = remainder(3);
  return r2 === 10 ? 0 : r2;
}

export const UIN_LENGTHS = [20, 25] as const;

export function uinValid(uin: string): boolean {
  if (!/^\d+$/.test(uin) || !(UIN_LENGTHS as readonly number[]).includes(uin.length)) return false;
  return uinControlDigit(uin.slice(0, -1)) === Number(uin.at(-1));
}

const INN10 = [2, 4, 10, 3, 5, 9, 4, 6, 8];
const INN11 = [7, 2, 4, 10, 3, 5, 9, 4, 6, 8];
const INN12 = [3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8];
const innDigit = (d: number[], w: number[]): number => (w.reduce((s, x, i) => s + x * (d[i] ?? 0), 0) % 11) % 10;

/** ИНН: 10 знаков у юрлица, 12 — у физлица и ИП. */
export function innValid(inn: string): boolean {
  if (!/^\d{10}$|^\d{12}$/.test(inn)) return false;
  const d = [...inn].map(Number);
  if (inn.length === 10) return innDigit(d, INN10) === d[9];
  return innDigit(d, INN11) === d[10] && innDigit(d, INN12) === d[11];
}

/** Дописать контрольные разряды к телу ИНН (9 или 10 цифр). */
export function innComplete(body: string): string {
  const d = [...body].map(Number);
  if (body.length === 9) return body + innDigit(d, INN10);
  if (body.length === 10) {
    const a = innDigit(d, INN11);
    return body + a + innDigit([...d, a], INN12);
  }
  throw new Error("тело ИНН — 9 или 10 цифр");
}

/** ОГРН (13) и ОГРНИП (15): остаток от деления тела на 11 или 13, последняя цифра остатка. */
export function ogrnValid(ogrn: string): boolean {
  if (!/^\d{13}$|^\d{15}$/.test(ogrn)) return false;
  return ogrnDigit(ogrn.slice(0, -1)) === Number(ogrn.at(-1));
}

export function ogrnDigit(body: string): number {
  const m = body.length === 12 ? 11n : 13n;
  return Number((BigInt(body) % m) % 10n);
}
