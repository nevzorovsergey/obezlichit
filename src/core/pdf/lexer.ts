// Лексер потока команд страницы PDF и выделение операторов показа текста с их состоянием.

export type Token =
  | { t: "str"; v: string; start: number; end: number } // строка — байты в hex, верхний регистр
  | { t: "num"; v: number; start: number; end: number }
  | { t: "name"; v: string; start: number; end: number }
  | { t: "op"; v: string; start: number; end: number }
  | { t: "[" | "]"; start: number; end: number }
  | { t: "delim"; v: string; start: number; end: number };

const WS = new Set([0, 9, 10, 12, 13, 32]);
const DELIM = new Set([..."()<>[]{}/%"].map((c) => c.charCodeAt(0)));
const ESC: Record<number, number> = { 110: 10, 114: 13, 116: 9, 98: 8, 102: 12, 40: 40, 41: 41, 92: 92 };

const latin1 = (b: Uint8Array, a: number, z: number): string => String.fromCharCode(...b.subarray(a, z));
const hex = (bytes: number[]): string => bytes.map((x) => x.toString(16).padStart(2, "0")).join("").toUpperCase();

export function lex(bytes: Uint8Array): Token[] {
  const toks: Token[] = [];
  const n = bytes.length;
  let i = 0;
  const at = (k: number): number => bytes[k] ?? -1;
  while (i < n) {
    const c = at(i);
    if (WS.has(c)) { i++; continue; }
    if (c === 37) { while (i < n && at(i) !== 10 && at(i) !== 13) i++; continue; } // % комментарий
    const start = i;
    if (c === 40) { // (литеральная строка)
      let depth = 1;
      const out: number[] = [];
      i++;
      while (i < n && depth) {
        const b = at(i);
        if (b === 92) {
          const e = at(i + 1);
          i += 2;
          const esc = ESC[e];
          if (esc !== undefined) out.push(esc);
          else if (e >= 48 && e <= 55) {
            let o = e - 48;
            for (let k = 0; k < 2 && at(i) >= 48 && at(i) <= 55; k++) o = o * 8 + at(i++) - 48;
            out.push(o & 255);
          } else if (e === 13) { if (at(i) === 10) i++; } // перенос строки после \ игнорируется
          else if (e !== 10) out.push(e);
          continue;
        }
        if (b === 40) depth++;
        if (b === 41 && --depth === 0) { i++; break; }
        out.push(b);
        i++;
      }
      toks.push({ t: "str", v: hex(out), start, end: i });
      continue;
    }
    if (c === 60 && at(i + 1) !== 60) { // <hex>
      const e = bytes.indexOf(62, i);
      let h = latin1(bytes, i + 1, e).replace(/\s+/g, "").toUpperCase();
      if (h.length % 2) h += "0";
      toks.push({ t: "str", v: h, start, end: e + 1 });
      i = e + 1;
      continue;
    }
    if (c === 60 || c === 62) { toks.push({ t: "delim", v: latin1(bytes, i, i + 2), start, end: i + 2 }); i += 2; continue; }
    if (c === 91 || c === 93) { toks.push({ t: c === 91 ? "[" : "]", start, end: i + 1 }); i++; continue; }
    if (c === 47) { // /Имя
      i++;
      while (i < n && !WS.has(at(i)) && !DELIM.has(at(i))) i++;
      toks.push({ t: "name", v: latin1(bytes, start + 1, i), start, end: i });
      continue;
    }
    while (i < n && !WS.has(at(i)) && !DELIM.has(at(i))) i++;
    if (i === start) { i++; continue; } // одиночный непонятный разделитель
    const w = latin1(bytes, start, i);
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(w)) toks.push({ t: "num", v: parseFloat(w), start, end: i });
    else {
      toks.push({ t: "op", v: w, start, end: i });
      if (w === "ID") { // встроенное изображение: двоичные данные до EI
        let j = i + 1;
        while (j < n && !(at(j) === 69 && at(j + 1) === 73 && WS.has(at(j - 1)) && (j + 2 >= n || WS.has(at(j + 2))))) j++;
        i = j + 2;
      }
    }
  }
  return toks;
}

export type ShowItem = { t: "str"; v: string } | { t: "num"; v: number };

/** Оператор показа текста: Tj, TJ, ' или ", с текущим шрифтом и параметрами текста. */
export interface TextShow {
  op: "Tj" | "TJ" | "'" | '"';
  first: number; // индекс первого токена операндов
  opTok: number; // индекс токена оператора
  font: string | null;
  size: number;
  Tc: number;
  Tw: number;
  items: ShowItem[];
  aw?: [number, number];
}

interface TextState { font: string | null; size: number; Tc: number; Tw: number }

export function textShows(toks: Token[]): TextShow[] {
  const shows: TextShow[] = [];
  const stack: TextState[] = [];
  let st: TextState = { font: null, size: 0, Tc: 0, Tw: 0 };
  let operands: Token[] = [];
  const num = (x: Token | undefined): number => (x && x.t === "num" ? x.v : 0);
  toks.forEach((t, k) => {
    if (t.t !== "op") { operands.push(t); return; }
    const ops = operands;
    operands = [];
    switch (t.v) {
      case "q": stack.push({ ...st }); break;
      case "Q": st = stack.pop() ?? st; break;
      case "Tf": st.font = ops[0]?.t === "name" ? ops[0].v : null; st.size = num(ops[1]); break;
      case "Tc": st.Tc = num(ops[0]); break;
      case "Tw": st.Tw = num(ops[0]); break;
      case "Tj": case "'": {
        const s = toks[k - 1];
        if (s?.t === "str") shows.push({ op: t.v, first: k - 1, opTok: k, ...st, items: [{ t: "str", v: s.v }] });
        break;
      }
      case '"': {
        const s = toks[k - 1];
        if (s?.t === "str") {
          const aw: [number, number] = [num(toks[k - 3]), num(toks[k - 2])];
          st.Tw = aw[0]; st.Tc = aw[1];
          shows.push({ op: '"', first: k - 3, opTok: k, ...st, items: [{ t: "str", v: s.v }], aw });
        }
        break;
      }
      case "TJ": {
        let j = k - 1;
        while (j >= 0 && toks[j]?.t !== "[") j--;
        const items: ShowItem[] = [];
        for (const x of toks.slice(j + 1, k - 1)) {
          if (x.t === "str") items.push({ t: "str", v: x.v });
          else if (x.t === "num") items.push({ t: "num", v: x.v });
        }
        shows.push({ op: "TJ", first: j, opTok: k, ...st, items });
        break;
      }
    }
  });
  return shows;
}
