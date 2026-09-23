// Liberation Serif (SIL OFL 1.1) — встроен в модуль, чтобы не делать сетевых запросов за шрифтом.
import regularUrl from "../../assets/fonts/LiberationSerif-Regular.ttf?inline";
import boldUrl from "../../assets/fonts/LiberationSerif-Bold.ttf?inline";
import type { FallbackFonts } from "../../src/core/pdf/fallback";

const fromDataUrl = (u: string): Uint8Array => {
  const b = atob(u.slice(u.indexOf(",") + 1));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
};

export const fonts = (): FallbackFonts => ({ regular: fromDataUrl(regularUrl), bold: fromDataUrl(boldUrl) });
