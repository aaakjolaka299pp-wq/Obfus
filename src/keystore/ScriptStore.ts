// ScriptStore.ts
// Private, server-side storage for obfuscated scripts. Each script is
// saved as its own file (so large sources don't bloat one JSON blob),
// with lightweight metadata kept in a separate index file.
//
// IMPORTANT: like KeyStore, this must live on a Railway Volume — set
// SCRIPT_STORE_DIR to a path inside a mounted Volume (e.g. /data/scripts).

import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from "fs";
import { join } from "path";
import crypto from "crypto";

export interface ScriptMeta {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  size: number;
}

export interface ScriptRecord extends ScriptMeta {
  source: string; // the obfuscated Lua output
}

const STORE_DIR = process.env.SCRIPT_STORE_DIR || "/data/scripts";
const INDEX_PATH = join(STORE_DIR, "index.json");

function ensureDir(): void {
  if (!existsSync(STORE_DIR)) mkdirSync(STORE_DIR, { recursive: true });
}

function loadIndex(): Record<string, ScriptMeta> {
  ensureDir();
  if (!existsSync(INDEX_PATH)) return {};
  try {
    return JSON.parse(readFileSync(INDEX_PATH, "utf-8"));
  } catch (err) {
    console.error("[ScriptStore] Failed to read index, starting empty:", err);
    return {};
  }
}

function saveIndex(index: Record<string, ScriptMeta>): void {
  ensureDir();
  writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2), "utf-8");
}

function sourcePath(id: string): string {
  return join(STORE_DIR, `${id}.lua`);
}

function randomId(): string {
  return crypto.randomBytes(8).toString("hex"); // 16 hex chars
}

export function createScript(title: string, source: string): ScriptRecord {
  ensureDir();
  const id = randomId();
  const now = Date.now();
  const meta: ScriptMeta = { id, title, createdAt: now, updatedAt: now, size: Buffer.byteLength(source, "utf-8") };

  writeFileSync(sourcePath(id), source, "utf-8");
  const index = loadIndex();
  index[id] = meta;
  saveIndex(index);

  return { ...meta, source };
}

export function updateScript(id: string, fields: { title?: string; source?: string }): ScriptRecord | null {
  const index = loadIndex();
  const meta = index[id];
  if (!meta) return null;

  if (typeof fields.title === "string") meta.title = fields.title;

  let source: string;
  if (typeof fields.source === "string") {
    source = fields.source;
    writeFileSync(sourcePath(id), source, "utf-8");
    meta.size = Buffer.byteLength(source, "utf-8");
  } else {
    source = existsSync(sourcePath(id)) ? readFileSync(sourcePath(id), "utf-8") : "";
  }

  meta.updatedAt = Date.now();
  index[id] = meta;
  saveIndex(index);

  return { ...meta, source };
}

export function getScript(id: string): ScriptRecord | null {
  const index = loadIndex();
  const meta = index[id];
  if (!meta) return null;
  if (!existsSync(sourcePath(id))) return null;
  const source = readFileSync(sourcePath(id), "utf-8");
  return { ...meta, source };
}

export function listScripts(): ScriptMeta[] {
  return Object.values(loadIndex()).sort((a, b) => b.updatedAt - a.updatedAt);
}

export function deleteScript(id: string): boolean {
  const index = loadIndex();
  if (!index[id]) return false;
  delete index[id];
  saveIndex(index);
  try {
    if (existsSync(sourcePath(id))) unlinkSync(sourcePath(id));
  } catch (err) {
    console.error("[ScriptStore] Failed to delete source file:", err);
  }
  return true;
}
