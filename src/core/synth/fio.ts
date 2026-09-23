// Любое ФИО в документе → «Тестов Тест Тестович» (решение владельца, ADR-0131 п. 3).
// Регистр, порядок слов и вид инициалов берутся у исходника, чтобы строка читалась как прежде.

export const FIO_STUB = { last: "Тестов", first: "Тест", middle: "Тестович" } as const;

const PAT = /(?:вич|вна|ична|инична|оглы|кызы)$/i;

export function fioReplacement(orig: string): string {
  const words = orig.trim().split(/\s+/);
  const upper = orig === orig.toUpperCase();
  const f = (s: string): string => (upper ? s.toUpperCase() : s);
  // «Имя Отчество Фамилия» — отчество во второй позиции
  const middleSecond = words.length === 3 && PAT.test(words[1] ?? "") && !PAT.test(words[2] ?? "");
  const parts = middleSecond ? [FIO_STUB.first, FIO_STUB.middle, FIO_STUB.last] : [FIO_STUB.last, FIO_STUB.first, FIO_STUB.middle];
  return parts.map(f).join(" ");
}

/** «Е.Ю. Фамилия» → «Т.Т. Тестов», «Фамилия Е. Ю.» → «Тестов Т. Т.» — разделители как в исходнике. */
export function initialsReplacement(orig: string): string {
  const s = orig.trim();
  const lead = s.match(/^([А-ЯЁ])\.(\s?)([А-ЯЁ])\.(\s?)(.+)$/);
  if (lead) return `Т.${lead[2]}Т.${lead[4]}${FIO_STUB.last}`;
  const tail = s.match(/^(.+?)(\s)([А-ЯЁ])\.(\s?)([А-ЯЁ])\.$/);
  if (tail) return `${FIO_STUB.last}${tail[2]}Т.${tail[4]}Т.`;
  return s;
}
