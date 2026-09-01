// GetKeyStore.ts
// Tracks "Get Key" sessions created when a loader user asks for a key via
// LootLabs. A session starts "pending" when we send them to LootLabs, and
// becomes "completed" (with an issued license key attached) once
// LootLabs's postback confirms they finished the tasks.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import crypto from "crypto";

export interface GetKeySession {
  token: string;
  scriptId: string;
  status: "pending" | "completed";
  createdAt: number;
  completedAt: number | null;
  issuedKey: string | null;
  ip: string | null;
}

const STORE_PATH = process.env.GETKEY_STORE_PATH || "/data/getkey-sessions.json";
const SESSION_MAX_AGE_MS = 48 * 60 * 60 * 1000; // prune anything older than 48h

let cache: Record<string, GetKeySession> | null = null;

function load(): Record<string, GetKeySession> {
  if (cache) return cache;
  if (!existsSync(STORE_PATH)) {
    cache = {};
    return cache;
  }
  try {
    cache = JSON.parse(readFileSync(STORE_PATH, "utf-8"));
    const now = Date.now();
    for (const token of Object.keys(cache!)) {
      if (now - cache![token].createdAt > SESSION_MAX_AGE_MS) delete cache![token];
    }
  } catch (err) {
    console.error("[GetKeyStore] Failed to read store, starting empty:", err);
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

export function createSession(scriptId: string): GetKeySession {
  const store = load();
  const token = crypto.randomBytes(12).toString("hex");
  const session: GetKeySession = {
    token, scriptId, status: "pending",
    createdAt: Date.now(), completedAt: null, issuedKey: null, ip: null,
  };
  store[token] = session;
  save();
  return session;
}

export function getSession(token: string): GetKeySession | null {
  return load()[token] || null;
}

export function completeSession(token: string, issuedKey: string, ip: string | null): GetKeySession | null {
  const store = load();
  const session = store[token];
  if (!session) return null;
  if (session.status === "completed") return session; // already done, avoid double-issuing
  session.status = "completed";
  session.completedAt = Date.now();
  session.issuedKey = issuedKey;
  session.ip = ip;
  save();
  return session;
}
