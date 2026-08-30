// KeyStore.ts
// A minimal, file-backed key/license store for P20's key system.
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
  hwid: string | null;
  note: string;
  createdAt: number;
  expiresAt: number | null; // null = never expires
  revoked: boolean;
}

export type CheckResult =
  | { valid: true }
  | { valid: false; reason: "NOT_FOUND" | "REVOKED" | "EXPIRED" | "HWID_LOCKED" };

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

export function createKey(opts: { note?: string; expiresInDays?: number }): KeyRecord {
  const store = load();
  const key = randomKey();
  const record: KeyRecord = {
    key,
    hwid: null,
    note: opts.note || "",
    createdAt: Date.now(),
    expiresAt: opts.expiresInDays ? Date.now() + opts.expiresInDays * 86400000 : null,
    revoked: false,
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

export function checkKey(key: string, hwid: string): CheckResult {
  const store = load();
  const rec = store[key];

  if (!rec) return { valid: false, reason: "NOT_FOUND" };
  if (rec.revoked) return { valid: false, reason: "REVOKED" };
  if (rec.expiresAt && Date.now() > rec.expiresAt) return { valid: false, reason: "EXPIRED" };

  if (!rec.hwid) {
    // First use — bind this HWID to the key.
    rec.hwid = hwid;
    save();
    return { valid: true };
  }

  if (rec.hwid !== hwid) return { valid: false, reason: "HWID_LOCKED" };

  return { valid: true };
}

export function resetHwid(key: string): boolean {
  const store = load();
  const rec = store[key];
  if (!rec) return false;
  rec.hwid = null;
  save();
  return true;
}
