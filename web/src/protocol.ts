// Сообщения между страницей и воркером. Байты файлов передаются, а не копируются.
import type { CheckResult } from "../../src/core/selfcheck";
import type { DocType, OutputFile, SubKind } from "../../src/core/obezlichit";

export type FileError = "too_big" | "encrypted" | "unreadable" | "no_text";

export interface FileInfo { name: string; pages: number; docType: DocType; codes: number; photos: number; error?: FileError }

export interface SubView { key: string; kind: SubKind; original: string; variants: string[]; replacement: string; count: number; enabled: boolean }

export interface Result { name: string; docType: DocType; bytes: Uint8Array; report: OutputFile["report"]; check: CheckResult }

export type Request =
  | { type: "analyze"; files: Array<{ name: string; bytes: Uint8Array }> }
  | { type: "update"; subs: Array<{ key: string; replacement: string; enabled: boolean }> }
  | { type: "manual"; value: string }
  | { type: "apply"; keepPhotos: boolean }
  | { type: "reset" };

export type Response =
  | { type: "analyzed"; files: FileInfo[]; subs: SubView[] }
  | { type: "updated" }
  | { type: "manual"; sub: SubView | null }
  | { type: "applied"; results: Result[] }
  | { type: "error"; message: string };
