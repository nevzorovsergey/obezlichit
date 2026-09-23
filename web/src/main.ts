// Страница обезличивания: пять шагов на одном экране (макет M6-171 «Тонны права»).
import "./styles.css";
import { zipSync } from "fflate";
import type { FileError, FileInfo, Request, Response, Result, SubView } from "./protocol";

declare const __SINGLE__: boolean;
declare const __VERSION__: string;
declare const __STANDALONE_SHA__: string;

// ---------- воркер и превью грузятся после выбора файла: первая загрузка страницы лёгкая ----------
let workerP: Promise<Worker> | null = null;
let seq = 0;
const pending = new Map<number, (r: Response) => void>();
function getWorker(): Promise<Worker> {
  workerP ??= (async () => {
    // автономный HTML — воркер встроен; размещённая страница — отдельный файл со своего адреса
    const w: Worker = __SINGLE__
      ? new (await import("./worker?worker&inline")).default()
      : new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    w.onmessage = (e: MessageEvent<{ id: number; res: Response }>) => { pending.get(e.data.id)?.(e.data.res); pending.delete(e.data.id); };
    w.onerror = (e) => {
      console.error("worker:", e.message);
      for (const [id, resolve] of pending) { resolve({ type: "error", message: e.message || "worker" }); pending.delete(id); }
    };
    return w;
  })();
  return workerP;
}
async function call(req: Request, transfer: Transferable[] = []): Promise<Response> {
  const w = await getWorker();
  const id = ++seq;
  return new Promise((resolve) => { pending.set(id, resolve); w.postMessage({ id, req }, transfer); });
}
const preview = () => import("./preview");

// ---------- состояние ----------
type Step = 1 | 2 | 3 | 4 | 5;
interface State {
  step: Step;
  inputs: Array<{ name: string; bytes: Uint8Array }>;
  infos: FileInfo[];
  subs: SubView[];
  editing: string | null;
  keepPhotos: boolean;
  reviewed: boolean;
  results: Result[];
  pv: { file: number; page: number; pages: number };
  busy: string | null;
  notice: string | null;
}
const initial = (): State => ({ step: 1, inputs: [], infos: [], subs: [], editing: null, keepPhotos: false, reviewed: false, results: [], pv: { file: 0, page: 1, pages: 1 }, busy: null, notice: null });
let st: State = initial();

const app = document.getElementById("app")!;
const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

// ---------- тексты ----------
const KIND: Record<string, string> = {
  owner: "Собственник", fio: "ФИО", initials: "Инициалы", inn: "ИНН", ogrn: "ОГРН", kpp: "КПП", date: "Дата регистрации или рождения",
  address: "Адрес", index: "Индекс", plate: "ГРЗ", sts: "СТС", uin: "УИН и номер постановления", case: "Номер дела", shpi: "Почтовый идентификатор", manual: "Добавлено вручную",
};
const GROUPS: Array<[string, string[]]> = [
  ["Собственник", ["owner", "inn", "ogrn", "kpp", "date", "address", "index"]],
  ["Машина и дело", ["plate", "sts", "uin", "case", "shpi"]],
  ["Люди в документе", ["fio", "initials"]],
  ["Добавлено вручную", ["manual"]],
];
const DOC: Record<string, string> = { resolution: "Постановление", act: "Акт измерений", other: "Документ" };
const ERR: Record<FileError, [string, string]> = {
  no_text: ["Это скан или фото — текста в файле нет", "Пока страница работает только с электронными PDF, в которых текст можно выделить. Электронную копию обычно присылают на Госуслуги или по почте."],
  encrypted: ["Файл защищён паролем", "Снимите защиту в программе, где его открываете, и выберите снова."],
  too_big: ["Файл больше 20 МБ или длиннее 30 страниц", "Постановление с актом обычно занимает 2–6 страниц. Сохраните нужные страницы отдельным файлом."],
  unreadable: ["Не получается прочитать файл", "Возможно, это не PDF или файл повреждён. Попробуйте сохранить его заново."],
};
const STEP_NAME = ["", "Выбор файлов", "Анализ", "Проверка подмен", "Самопроверка", "Готово"];

const ICON_LOCK = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>`;
const ICON_DOC = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>`;
const ICON_UP = `<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M12 18v-6M9 14l3-3 3 3"/></svg>`;

const HOW = `<details class="how" data-testid="how"><summary>Как проверить, что файл никуда не ушёл</summary><ol>
<li>Откройте страницу, отключите интернет и обезличьте файл — всё сработает.</li>
<li>Или откройте инструменты разработчика, вкладку «Сеть»: после загрузки страницы там не появится ни одного запроса.</li>
<li>Правила браузера (CSP) этой страницы запрещают ей отправлять данные куда-либо — их видно в исходном коде.</li>
${__SINGLE__ ? "" : "<li>Скачайте страницу одним файлом и откройте её с диска на компьютере без сети.</li>"}
<li>Код открыт: соберите страницу сами и сравните отпечаток SHA-256 с опубликованным в релизе.</li></ol></details>`;

function steps(): string {
  return `<div><div class="steps" aria-hidden="true">${[1, 2, 3, 4, 5].map((i) => `<i class="${i < st.step ? "done" : i === st.step ? "cur" : ""}"></i>`).join("")}</div>
<div class="steps-lbl"><span><b>${STEP_NAME[st.step]}</b></span><span>шаг ${st.step} из 5</span></div></div>`;
}

// ---------- шаги ----------
function step1(): string {
  return `<div class="two">
  <div style="display:grid;gap:18px">
    <h1 class="h">Обезличить постановление</h1>
    <p class="sub">ФИО, номер машины, УИН, ИНН и адреса заменим на вымышленные. Даты, веса и место останутся — по ним строится разбор. Текст в файле останется текстом, как в оригинале.</p>
    <div class="lock">${ICON_LOCK}<p>Файл обрабатывается в браузере и не отправляется в интернет. Страница работает и без сети.</p></div>
    ${HOW}
    ${__SINGLE__ ? "" : `<a class="lnk" href="./obezlichit.html" download>Скачать страницу для работы без интернета</a>`}
  </div>
  <label class="drop" data-drop>
    ${ICON_UP}
    <span class="t">Постановление и акт — PDF</span>
    <span class="cap">Можно несколько файлов сразу: постановление и акт получат одинаковые вымышленные номера. До 20 МБ и 30 страниц.</span>
    <span class="btn btn-primary">Выбрать файлы</span>
    <input class="visually-hidden" type="file" accept="application/pdf,.pdf" multiple data-input id="files">
  </label>
</div>`;
}

function fileRow(i: FileInfo): string {
  const chip = i.error ? `<button class="x" data-remove="${esc(i.name)}" aria-label="Убрать файл ${esc(i.name)}">✕</button>`
    : st.busy ? `<span class="chip run">Анализ…</span>` : `<span class="chip ok">✓ Готов</span>`;
  const meta = i.error ? ERR[i.error][0] : `${DOC[i.docType]} · ${i.pages} стр.`;
  return `<div class="file">${ICON_DOC}<div><div class="n">${esc(i.name)}</div><div class="m">${meta}</div></div>${chip}</div>`;
}

function step2(): string {
  const ok = st.infos.filter((i) => !i.error);
  const errs = [...new Set(st.infos.filter((i) => i.error).map((i) => i.error!))];
  return `${steps()}
  <div class="files" data-testid="files">${st.infos.map(fileRow).join("") || st.inputs.map((f) => fileRow({ name: f.name, pages: 0, docType: "other", codes: 0, photos: 0 })).join("")}</div>
  ${errs.map((e) => `<div class="alert warn"><b>${ERR[e][0]}</b><p>${ERR[e][1]}</p></div>`).join("")}
  <div class="row"><button class="btn btn-primary" data-act="to3" ${ok.length && !st.busy ? "" : "disabled"}>Проверить подмены</button>
  <button class="btn btn-ghost" data-act="restart">Выбрать другие файлы</button></div>`;
}

function subRow(s: SubView): string {
  const editable = s.kind !== "fio" && s.kind !== "initials";
  const now = st.editing === s.key
    ? `<span class="now"><input value="${esc(s.replacement)}" data-edit="${esc(s.key)}" aria-label="Чем заменить: ${esc(KIND[s.kind] ?? s.kind)}"></span>`
    : `<span class="now">${esc(s.replacement)}</span>`;
  const actions = [
    editable && s.enabled ? `<button class="edit" data-act="${st.editing === s.key ? "save" : "edit"}" data-key="${esc(s.key)}">${st.editing === s.key ? "Готово" : "Изменить"}</button>` : "",
    `<button class="edit" data-act="toggle" data-key="${esc(s.key)}">${s.enabled ? "Не заменять" : "Заменять"}</button>`,
  ].join("");
  return `<div class="sub-row${s.enabled ? "" : " off"}" data-testid="sub-${esc(s.kind)}">
  <span class="k"><span>${esc(KIND[s.kind] ?? s.kind)}</span><span class="num">×${s.count}</span></span>
  <span class="was">${esc(s.original)}</span><span></span>
  ${now}<span class="row" style="gap:0">${actions}</span></div>`;
}

function step3(): string {
  const codes = st.infos.reduce((n, i) => n + (i.error ? 0 : i.codes), 0);
  const photos = st.infos.reduce((n, i) => n + (i.error ? 0 : i.photos), 0);
  const files = okFiles();
  const groups = GROUPS.map(([title, kinds]) => {
    const rows = st.subs.filter((s) => kinds.includes(s.kind));
    return rows.length ? `<span class="grp">${title}</span>${rows.map(subRow).join("")}` : "";
  }).join("");
  const extra = `${codes ? `<span class="grp">Коды и фото</span><div class="sub-row"><span class="k"><span>QR и штрихкоды</span><span class="num">×${codes}</span></span><span style="grid-column:1/-1">Перерисуем с новыми данными</span></div>` : ""}
  ${photos ? `${codes ? "" : `<span class="grp">Коды и фото</span>`}<div class="sub-row${st.keepPhotos ? " off" : ""}"><span class="k"><span>Фото машины и кроп номера</span><span class="num">×${photos}</span></span><span>${st.keepPhotos ? "Оставим как есть — на снимках может читаться номер" : "Размоем — на снимках виден номер"}</span><button class="edit" data-act="photos">${st.keepPhotos ? "Размывать" : "Не размывать"}</button></div>` : ""}`;
  const f = files[st.pv.file];
  return `${steps()}
  <div class="two two-r">
    <div style="display:grid;gap:14px">
      <h2 class="h2">Нашли ${st.subs.length} ${plural(st.subs.length, "значение", "значения", "значений")} в ${files.length} ${plural(files.length, "файле", "файлах", "файлах")}</h2>
      <p class="sub">Проверьте, что ничего не пропущено: подсвечено всё, что будет заменено.</p>
      <div class="subs" data-testid="subs">${groups}${extra}</div>
    </div>
    <div style="display:grid;gap:14px;align-content:start">
      <div class="card preview">
        <div class="pgnav"><span>${esc(f?.name ?? "")} · стр. ${st.pv.page} из ${st.pv.pages}</span>
          <span class="row">${files.length > 1 ? `<button class="btn btn-sm btn-secondary" data-act="file">Другой файл</button>` : ""}
          <button class="btn btn-sm btn-secondary" data-act="prev" aria-label="Предыдущая страница" ${st.pv.page > 1 ? "" : "disabled"}>‹</button>
          <button class="btn btn-sm btn-secondary" data-act="next" aria-label="Следующая страница" ${st.pv.page < st.pv.pages ? "" : "disabled"}>›</button></span></div>
        <div class="sheet" data-sheet="orig"></div>
        <p class="cap">Пропустили что-то? Выделите текст на странице и нажмите «Добавить выделенное».</p>
        <button class="btn btn-secondary" data-act="manual">Добавить выделенное</button>
        ${st.notice ? `<p class="cap" role="status">${esc(st.notice)}</p>` : ""}
      </div>
      <label class="confirm"><input type="checkbox" data-act="reviewed" ${st.reviewed ? "checked" : ""}><span>Я просмотрел все страницы ${files.length > 1 ? "всех файлов" : "файла"}</span></label>
      <button class="btn btn-primary btn-block" data-act="apply" ${st.reviewed && !st.busy ? "" : "disabled"}>${st.busy ? "Обезличиваем…" : "Обезличить и проверить"}</button>
    </div>
  </div>`;
}

function step4(): string {
  const bad = st.results.filter((r) => !r.check.ok);
  const WHERE: Record<string, string> = { text: "текст документа", streams: "внутреннее содержимое PDF", codes: "QR-коды и штрихкоды", metadata: "свойства файла", revisions: "старые версии внутри файла" };
  const list = st.results.map((r) => {
    const w = new Set(r.check.leaks.map((l) => l.where));
    const row = (k: string, title: string, ok: string, badText: string): string =>
      `<div class="chk"><span class="${w.has(k as never) ? "ico-bad" : "ico-ok"}">${w.has(k as never) ? "✕" : "✓"}</span><div><div>${title}</div><div class="d">${w.has(k as never) ? badText : ok}</div></div></div>`;
    return `<div class="card" style="display:grid;gap:6px"><b>${DOC[r.docType]}: ${esc(r.name)}</b><div class="checks">
      ${row("text", "Текст документа", "исходных значений не найдено", "найдено исходное значение")}
      ${row("streams", "Внутреннее содержимое PDF", `${r.check.checked.streams} потоков распакованы и просмотрены`, "найдено исходное значение")}
      ${row("codes", "QR-коды и штрихкоды", r.check.checked.codes ? `${r.check.checked.codes} кодов прочитаны заново — только новые данные` : "кодов нет", "в коде осталось исходное значение")}
      ${row("metadata", "Свойства файла", "автор и тема удалены, старых версий внутри нет", "в свойствах осталось исходное значение")}
    </div></div>`;
  }).join("");
  return `${steps()}
  ${bad.length ? `<div class="alert bad" role="alert"><b>В ${bad.length === 1 ? "файле" : "файлах"} осталось исходное значение</b><p>${bad.map((r) => `${esc(r.name)}: ${[...new Set(r.check.leaks.map((l) => WHERE[l.where]))].join(", ")}`).join("; ")}. Скачивание закрыто. Вернитесь к подменам и добавьте пропущенное вручную.</p></div>`
    : `<h2 class="h2" data-testid="clean">Исходных значений в файлах не нашли</h2>`}
  <div class="two">
    <div style="display:grid;gap:14px">${list}</div>
    <div class="card preview"><div class="pgnav"><span>До · после · стр. ${st.pv.page} из ${st.pv.pages}</span>
      <span class="row"><button class="btn btn-sm btn-secondary" data-act="prev" aria-label="Предыдущая страница" ${st.pv.page > 1 ? "" : "disabled"}>‹</button>
      <button class="btn btn-sm btn-secondary" data-act="next" aria-label="Следующая страница" ${st.pv.page < st.pv.pages ? "" : "disabled"}>›</button></span></div>
      <div class="pair"><div class="sheet" data-sheet="orig"></div><div class="sheet" data-sheet="out"></div></div></div>
  </div>
  <div class="row">${bad.length ? "" : `<button class="btn btn-primary" data-act="to5">Скачать</button>`}
  <button class="btn ${bad.length ? "btn-primary" : "btn-ghost"}" data-act="back3">Вернуться к подменам</button></div>
  ${bad.length ? `<p class="cap">Если не получается — напишите нам, что за документ; файл присылать не нужно.</p>` : ""}`;
}

function outName(r: Result, i: number): string {
  const stem = r.docType === "resolution" ? "postanovlenie" : r.docType === "act" ? "akt" : "dokument";
  const n = st.results.slice(0, i + 1).filter((x) => x.docType === r.docType).length;
  return `${stem}-${n}.pdf`;
}

function step5(): string {
  const files = st.results.map((r, i) => `<div class="file">${ICON_DOC}<div><div class="n">${outName(r, i)}</div><div class="m">${DOC[r.docType]} · ${Math.max(1, Math.round(r.bytes.length / 1024))} КБ</div></div>
    <button class="btn btn-secondary btn-sm" data-dl="${i}">Скачать</button></div>`).join("");
  return `${steps()}
  <h2 class="h2">Файлы обезличены</h2>
  <div class="two"><div style="display:grid;gap:14px">
    <div class="files" data-testid="downloads">${files}</div>
    ${st.results.length > 1 ? `<button class="btn btn-primary btn-block" data-act="zip">Скачать всё архивом</button>` : ""}
  </div>
  <div class="card" style="display:grid;gap:10px"><b>Что дальше</b>
    <p class="sub">Загрузите файлы в «Тонну права» и посмотрите бесплатный разбор. Вопрос про номер на фото сервис задавать не будет — фото размыты.</p>
    <a class="btn btn-secondary btn-block" href="https://tonnaprava.ru/" rel="noopener">Открыть «Тонну права»</a></div></div>
  <button class="btn btn-ghost" data-act="restart" style="justify-self:start">Начать заново — всё сотрётся из памяти</button>`;
}

const plural = (n: number, one: string, few: string, many: string): string => {
  const m10 = n % 10, m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20) ? few : many;
};
const okFiles = (): Array<{ name: string; bytes: Uint8Array }> => st.inputs.filter((f) => st.infos.some((i) => i.name === f.name && !i.error));

// ---------- отрисовка ----------
function render(): void {
  const body = [step1, step2, step3, step4, step5][st.step - 1]!();
  app.innerHTML = body;
  void drawSheets();
}

async function drawSheets(): Promise<void> {
  const orig = app.querySelector<HTMLElement>('[data-sheet="orig"]');
  if (!orig) return;
  const files = okFiles();
  const f = files[st.pv.file];
  if (!f) return;
  const values = st.subs.filter((s) => s.enabled).flatMap((s) => s.variants);
  const { pageCount, renderPage } = await preview();
  st.pv.pages = await pageCount(f.bytes);
  const label = app.querySelector(".pgnav span");
  if (label && st.step === 3) label.textContent = `${f.name} · стр. ${st.pv.page} из ${st.pv.pages}`;
  await renderPage(orig, f.bytes, st.pv.page, values, st.step === 3);
  const out = app.querySelector<HTMLElement>('[data-sheet="out"]');
  const r = st.results.find((x) => x.name === f.name);
  if (out && r) await renderPage(out, r.bytes, st.pv.page, [], false);
}

function download(bytes: Uint8Array, name: string, type = "application/pdf"): void {
  const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// ---------- действия ----------
async function addFiles(list: FileList | null): Promise<void> {
  if (!list?.length) return;
  const inputs = await Promise.all([...list].map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })));
  st = { ...initial(), step: 2, inputs, busy: "analyze" };
  render();
  const res = await call({ type: "analyze", files: inputs.map((f) => ({ name: f.name, bytes: f.bytes.slice() })) });
  st.busy = null;
  if (res.type === "analyzed") { st.infos = res.files; st.subs = res.subs; }
  else st.infos = inputs.map((f) => ({ name: f.name, pages: 0, docType: "other", codes: 0, photos: 0, error: "unreadable" }));
  render();
}

async function pushSubs(): Promise<void> {
  await call({ type: "update", subs: st.subs.map((s) => ({ key: s.key, replacement: s.replacement, enabled: s.enabled })) });
}

app.addEventListener("change", (e) => {
  const t = e.target as HTMLInputElement;
  if (t.matches("[data-input]")) void addFiles(t.files);
  if (t.dataset.act === "reviewed") { st.reviewed = t.checked; render(); }
});

app.addEventListener("keydown", (e) => {
  const t = e.target as HTMLInputElement;
  if (t.dataset.edit && e.key === "Enter") { e.preventDefault(); (app.querySelector(`[data-act="save"]`) as HTMLButtonElement | null)?.click(); }
});

app.addEventListener("click", async (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>("[data-act],[data-dl],[data-remove]");
  if (!el) return;
  const act = el.dataset.act;
  if (el.dataset.dl !== undefined) { const i = Number(el.dataset.dl); download(st.results[i]!.bytes, outName(st.results[i]!, i)); return; }
  if (el.dataset.remove !== undefined) { st.infos = st.infos.filter((i) => i.name !== el.dataset.remove); st.inputs = st.inputs.filter((f) => f.name !== el.dataset.remove); if (!st.inputs.length) st = initial(); render(); return; }
  const key = el.dataset.key;
  const sub = key ? st.subs.find((s) => s.key === key) : undefined;
  switch (act) {
    case "to3": st.step = 3; st.pv = { file: 0, page: 1, pages: 1 }; break;
    case "edit": st.editing = key ?? null; render(); app.querySelector<HTMLInputElement>("[data-edit]")?.focus(); return;
    case "save": {
      const input = app.querySelector<HTMLInputElement>("[data-edit]");
      if (sub && input && input.value.trim()) sub.replacement = input.value.trim();
      st.editing = null; await pushSubs(); break;
    }
    case "toggle": if (sub) { sub.enabled = !sub.enabled; await pushSubs(); } break;
    case "photos": st.keepPhotos = !st.keepPhotos; break;
    case "file": st.pv = { file: (st.pv.file + 1) % okFiles().length, page: 1, pages: 1 }; break;
    case "prev": st.pv.page = Math.max(1, st.pv.page - 1); break;
    case "next": st.pv.page = Math.min(st.pv.pages, st.pv.page + 1); break;
    case "manual": {
      const sel = window.getSelection()?.toString().replace(/\s+/g, " ").trim() ?? "";
      if (!sel) { st.notice = "Сначала выделите текст на странице."; break; }
      const res = await call({ type: "manual", value: sel });
      if (res.type === "manual" && res.sub) { st.subs = [...st.subs.filter((s) => s.key !== res.sub!.key), res.sub]; st.notice = `Добавлено: «${sel}» — ${res.sub.count} раз.`; }
      else st.notice = "Такой текст не нашёлся в файлах целиком — выделите его точнее.";
      break;
    }
    case "apply": {
      st.busy = "apply"; render();
      const res = await call({ type: "apply", keepPhotos: st.keepPhotos });
      st.busy = null;
      if (res.type === "applied") { st.results = res.results; st.step = 4; st.pv = { file: 0, page: 1, pages: 1 }; }
      else st.notice = "Не получилось обезличить: " + (res.type === "error" ? res.message : "");
      break;
    }
    case "back3": st.step = 3; st.reviewed = false; break;
    case "to5": st.step = 5; break;
    case "zip": {
      const files: Record<string, Uint8Array> = {};
      st.results.forEach((r, i) => { files[outName(r, i)] = r.bytes; });
      download(zipSync(files, { level: 0 }), "obezlichennye.zip", "application/zip");
      return;
    }
    case "restart": {
      const { forget } = await preview();
      st.inputs.forEach((f) => forget(f.bytes)); st.results.forEach((r) => forget(r.bytes));
      await call({ type: "reset" }); st = initial(); break;
    }
    default: return;
  }
  st.notice = act === "manual" ? st.notice : null;
  render();
});

// перетаскивание файлов на зону
app.addEventListener("dragover", (e) => { const d = (e.target as HTMLElement).closest("[data-drop]"); if (d) { e.preventDefault(); d.classList.add("over"); } });
app.addEventListener("dragleave", (e) => (e.target as HTMLElement).closest("[data-drop]")?.classList.remove("over"));
app.addEventListener("drop", (e) => { const d = (e.target as HTMLElement).closest("[data-drop]"); if (d) { e.preventDefault(); void addFiles(e.dataTransfer?.files ?? null); } });

document.getElementById("version")!.textContent = `Версия ${__VERSION__}`;
if (__STANDALONE_SHA__) document.getElementById("sha")!.textContent = `SHA-256 файла страницы: ${__STANDALONE_SHA__}`;
if (!__SINGLE__ && "serviceWorker" in navigator && location.protocol === "https:") void navigator.serviceWorker.register("./sw.js");
render();
