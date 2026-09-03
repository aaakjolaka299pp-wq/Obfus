// LoaderStore.ts
// A "loader" bundles one or more saved scripts (from ScriptStore) plus a
// type (Free/Premium) into a single generated Lua file. Keys can be scoped
// to a loaderId so a key only grants access to that loader's script set.
//
// IMPORTANT: like the other stores, this must live on a Railway Volume —
// set LOADER_STORE_PATH to a path inside a mounted Volume.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import crypto from "crypto";

export interface LoaderRecord {
  id: string;
  title: string;
  type: "free" | "premium";
  scriptIds: string[]; // one or more ScriptStore ids bundled into this loader
  createdAt: number;
  updatedAt: number;
}

const STORE_PATH = process.env.LOADER_STORE_PATH || "/data/loaders.json";

let cache: Record<string, LoaderRecord> | null = null;

function load(): Record<string, LoaderRecord> {
  if (cache) return cache;
  if (!existsSync(STORE_PATH)) {
    cache = {};
    return cache;
  }
  try {
    cache = JSON.parse(readFileSync(STORE_PATH, "utf-8"));
    for (const rec of Object.values(cache!) as any[]) {
      if (!Array.isArray(rec.scriptIds)) rec.scriptIds = rec.scriptId ? [rec.scriptId] : [];
      if (rec.type !== "free" && rec.type !== "premium") rec.type = "premium";
    }
  } catch (err) {
    console.error("[LoaderStore] Failed to read store, starting empty:", err);
    cache = {};
  }
  return cache!;
}

function save(): void {
  if (!cache) return;
  const dir = dirname(STORE_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(STORE_PATH, JSON.stringify(cache, null, 2), "utf-8");
}

function randomId(): string {
  return crypto.randomBytes(8).toString("hex");
}

export function createLoader(opts: { title: string; type: "free" | "premium"; scriptIds: string[] }): LoaderRecord {
  const store = load();
  const id = randomId();
  const now = Date.now();
  const record: LoaderRecord = {
    id,
    title: opts.title,
    type: opts.type,
    scriptIds: opts.scriptIds,
    createdAt: now,
    updatedAt: now,
  };
  store[id] = record;
  save();
  return record;
}

export function getLoader(id: string): LoaderRecord | null {
  return load()[id] || null;
}

export function listLoaders(): LoaderRecord[] {
  return Object.values(load()).sort((a, b) => b.createdAt - a.createdAt);
}

export function deleteLoader(id: string): boolean {
  const store = load();
  if (!store[id]) return false;
  delete store[id];
  save();
  return true;
}
