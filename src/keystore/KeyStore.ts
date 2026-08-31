// KeyStore.ts
// A minimal, file-backed key/license store for Zer's key system.
//
// IMPORTANT: this file must live on a Railway Volume (persistent disk),
// not the regular container filesystem — Railway's normal filesystem is
// wiped on every redeploy. Set KEY_STORE_PATH to a path inside a mounted
// Volume (e.g. /data/keys.json).

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import crypto from "crypto";

export interface KeyRecord {
  key: string;
  hwids: string[];
  hwidLimit: number | null; // null = unlimited
  note: string;
  createdAt: number;
  expiresAt: number | null; // null = never expires
  revoked: boolean;
  scriptId: string | null; // null = valid for any script
  uses: number;
  lastUsedAt: number | null;
}

export type CheckResult =
  | { valid: true }
  | { valid: false; reason: "NOT_FOUND" | "REVOKED" | "EXPIRED" | "HWID_LOCKED" | "WRONG_SCRIPT" };

export type HwidResult =
  | { success: true }
  | { success: false; reason: "NOT_FOUND" | "LIMIT_REACHED" | "NOT_BOUND" };

const STORE_PATH = process.env.KEY_STORE_PATH || "/data/keys.json";

let cache: Record<string, KeyRecord> | null = null;

function load(): Record<string, KeyRecord> {
  if (cache) return cache;
  if (!existsSync(STORE_PATH)) {
    cache = {};
    return cache;
  }
  try {
    cache = JSON.parse(readFileSync(STORE_PATH, "utf-8"));
    for (const rec of Object.values(cache!) as any[]) {
      if (rec.scriptId === undefined) rec.scriptId = null;
      if (rec.uses === undefined) rec.uses = 0;
      if (rec.lastUsedAt === undefined) rec.lastUsedAt = null;
      // Migrate the old single `hwid` field into the new `hwids` array.
      if (!Array.isArray(rec.hwids)) {
        rec.hwids = rec.hwid ? [rec.hwid] : [];
        delete rec.hwid;
      }
      if (rec.hwidLimit === undefined) rec.hwidLimit = 1;
    }
  } catch (err) {
    console.error("[KeyStore] Failed to read store, starting empty:", err);
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

function randomKey(): string {
  return crypto.randomBytes(16).toString("hex"); // 32 hex chars
}

export function createKey(opts: {
  note?: string;
  expiresInDays?: number;
  scriptId?: string | null;
  hwidLimit?: number | null;
}): KeyRecord {
  const store = load();
  const key = randomKey();
  const record: KeyRecord = {
    key,
    hwids: [],
    hwidLimit: opts.hwidLimit === undefined ? 1 : opts.hwidLimit,
    note: opts.note || "",
    createdAt: Date.now(),
    expiresAt: opts.expiresInDays ? Date.now() + opts.expiresInDays * 86400000 : null,
    revoked: false,
    scriptId: opts.scriptId || null,
    uses: 0,
    lastUsedAt: null,
  };
  store[key] = record;
  save();
  return record;
}

export function revokeKey(key: string): boolean {
  const store = load();
  const rec = store[key];
  if (!rec) return false;
  rec.revoked = true;
  save();
  return true;
}

export function deleteKey(key: string): boolean {
  const store = load();
  if (!store[key]) return false;
  delete store[key];
  save();
  return true;
}

export function listKeys(): KeyRecord[] {
  return Object.values(load());
}

export function checkKey(key: string, hwid: string, scriptId?: string): CheckResult {
  const store = load();
  const rec = store[key];

  if (!rec) return { valid: false, reason: "NOT_FOUND" };
  if (rec.revoked) return { valid: false, reason: "REVOKED" };
  if (rec.expiresAt && Date.now() > rec.expiresAt) return { valid: false, reason: "EXPIRED" };
  if (rec.scriptId && scriptId && rec.scriptId !== scriptId) return { valid: false, reason: "WRONG_SCRIPT" };

  if (!rec.hwids.includes(hwid)) {
    const limit = rec.hwidLimit;
    if (limit !== null && rec.hwids.length >= limit) {
      return { valid: false, reason: "HWID_LOCKED" };
    }
    rec.hwids.push(hwid);
  }

  rec.uses += 1;
  rec.lastUsedAt = Date.now();
  save();

  return { valid: true };
}

// Clears every bound HWID on a key (start over from zero devices).
export function resetHwid(key: string): boolean {
  const store = load();
  const rec = store[key];
  if (!rec) return false;
  rec.hwids = [];
  save();
  return true;
}

// Manually bind one specific HWID (e.g. pre-authorizing a device),
// respecting the key's HWID limit.
export function addHwid(key: string, hwid: string): HwidResult {
  const store = load();
  const rec = store[key];
  if (!rec) return { success: false, reason: "NOT_FOUND" };
  if (rec.hwids.includes(hwid)) return { success: true };
  if (rec.hwidLimit !== null && rec.hwids.length >= rec.hwidLimit) {
    return { success: false, reason: "LIMIT_REACHED" };
  }
  rec.hwids.push(hwid);
  save();
  return { success: true };
}

// Frees up one specific device slot without clearing the others.
export function removeHwid(key: string, hwid: string): HwidResult {
  const store = load();
  const rec = store[key];
  if (!rec) return { success: false, reason: "NOT_FOUND" };
  const before = rec.hwids.length;
  rec.hwids = rec.hwids.filter((h) => h !== hwid);
  if (rec.hwids.length === before) return { success: false, reason: "NOT_BOUND" };
  save();
  return { success: true };
}

export function setHwidLimit(key: string, limit: number | null): boolean {
  const store = load();
  const rec = store[key];
  if (!rec) return false;
  rec.hwidLimit = limit;
  save();
  return true;
}
