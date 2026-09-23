// Поиск ПДн в тексте документа. Правила — по якорям постановлений ЦАФАП и актов АПВГК;
// ФИО ищется отдельно: любое ФИО в документе заменяется одной и той же заглушкой (ADR-0131 п. 3).
import { uinValid } from "../synth/checksums";

export type Kind =
  | "uin" | "plate" | "sts" | "owner" | "fio" | "initials" | "inn" | "ogrn" | "kpp"
  | "date" | "address" | "index" | "case" | "shpi";

export interface Find {
  kind: Kind;
  value: string;
  /** позиция в тексте, по которому искали */
  start: number;
}

const CYR = "АВЕКМНОРСТУХ";
const LAT = "ABEKMHOPCTYX";
const PL = `[${CYR}${LAT}]`;

type Rule = [Kind, RegExp, ((value: string, before: string) => boolean)?];

const PAT_L = "(?:вич|вна|ична|инична|оглы|кызы)";
const PAT_U = "(?:ВИЧ|ВНА|ИЧНА|ИНИЧНА|ОГЛЫ|КЫЗЫ)";
const W = "[А-ЯЁ][а-яё]+(?:-[А-ЯЁ][а-яё]+)?";
const WU = "[А-ЯЁ]{2,}(?:-[А-ЯЁ]{2,})?";
/** Фамилия Имя Отчество или Имя Отчество Фамилия */
const FIO_L = `${W}\\s+${W}\\s+[А-ЯЁ][а-яё]+${PAT_L}|${W}\\s+[А-ЯЁ][а-яё]+${PAT_L}\\s+${W}`;
const FIO_U = `${WU}\\s+${WU}\\s+[А-ЯЁ]+${PAT_U}|${WU}\\s+[А-ЯЁ]+${PAT_U}\\s+${WU}`;

const RULES: Rule[] = [
  ["uin", /(?<!\d)(\d{20}|\d{25})(?!\d)/g, (v, before) => uinValid(v) && !/сч[её]т[^,;\n]{0,30}$/i.test(before)],
  ["plate", new RegExp(`(?<![А-ЯA-Z0-9])(${PL}\\d{3}${PL}{2}\\d{2,3})(?!\\d)`, "g")],
  ["sts", /(?:СТС:?\s*№?\s*|свидетельств\S* о регистрации ТС\s*№\s*)(\d{2}\s?[А-Я0-9]{2}\s?\d{6})/g],
  // ФИО: Фамилия Имя Отчество (или Имя Отчество Фамилия), обычный и верхний регистр
  ["fio", new RegExp(`(?<![А-Яа-яЁё])(${FIO_L})(?![а-яё])`, "g")],
  ["fio", new RegExp(`(?<![А-ЯЁ])(${FIO_U})(?![А-ЯЁ])`, "g")],
  ["initials", /(?<![А-Яа-яЁё])([А-ЯЁ]\. ?[А-ЯЁ]\. ?[А-ЯЁ][а-яё]+(?:-[А-ЯЁ][а-яё]+)?|[А-ЯЁ][а-яё]+ [А-ЯЁ]\. ?[А-ЯЁ]\.)(?![а-яё])/g],
  ["owner", /является\s+([\s\S]+?)\s+(?=Дата регистрации|Дата рождения|ИНН|,)/g],
  ["owner", /Признать собственника \(владельца\) ТС,\s+([\s\S]+?),\s+виновн/g],
  ["owner", /Кому:\s*([^\n]+?)\s*(?=\n|$)/g],
  ["owner", /Плательщик:\s*([^\n]+?)\s*(?=\n|$)/g],
  ["inn", /ИНН (?:ЮЛ|ФЛ|ИП):?\s*(\d{10}|\d{12})(?!\d)/g],
  ["ogrn", /ОГРН(?:ИП)?(?:\s+ЮЛ)?:?\s*(\d{13}|\d{15})(?!\d)/g],
  ["kpp", /ОГРН[\s\S]{0,40}?КПП:?\s*(\d{9})(?!\d)/g],
  ["date", /Дата (?:регистрации|рождения):?\s*(\d{2}\.\d{2}\.\d{4})/g],
  ["address", /(?:Юридический адрес|Адрес(?: регистрации| места жительства)?):\s*([\s\S]+?)\s*(?=\n?\s*Руководствуясь)/g],
  ["address", /Куда:\s*([\s\S]+?)\n\s*(?=\d{6}\s*(?:\n|$))/g],
  ["index", /Куда:[\s\S]+?\n\s*(\d{6})\s*(?:\n|$)/g],
  ["case", /Дело об АПН\s+(\d{6,})/g],
  ["shpi", /(?<!\d)(\d{6} \d{2} \d{5} \d)(?!\d)/g],
];

/** Все находки без пересечений: из перекрывающихся остаётся более длинная. */
export function detect(text: string): Find[] {
  const found: Find[] = [];
  for (const [kind, re, ok] of RULES) {
    for (const m of text.matchAll(re)) {
      const raw = m[1];
      if (raw === undefined || m.index === undefined) continue;
      let start = m.index + m[0].indexOf(raw);
      if (ok && !ok(raw, text.slice(Math.max(0, start - 60), start))) continue;
      const lead = raw.length - raw.trimStart().length;
      const value = raw.trim();
      start += lead;
      if (value) found.push({ kind, value, start });
    }
  }
  // ФИО собственника, найденное правилом `owner`, — это тоже ФИО: заменяется заглушкой ФИО
  for (const f of found) if (f.kind === "owner" && isFio(f.value)) f.kind = "fio";
  found.sort((a, b) => b.value.length - a.value.length);
  const taken: Array<[number, number]> = [];
  const out: Find[] = [];
  for (const f of found) {
    const end = f.start + f.value.length;
    if (taken.some(([a, b]) => f.start < b && end > a)) continue;
    taken.push([f.start, end]);
    out.push(f);
  }
  return out.sort((a, b) => a.start - b.start);
}

const FIO_RE = new RegExp(`^(?:${FIO_L}|${FIO_U})$`);
export const isFio = (s: string): boolean => FIO_RE.test(s.replace(/\s+/g, " ").trim());

export { CYR, LAT };
