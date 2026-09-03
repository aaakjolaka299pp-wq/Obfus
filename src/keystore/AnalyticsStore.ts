// AnalyticsStore.ts
// Append-only event log powering the Overview tab. Every event is a single
// small record {type, at, ...meta}; the Overview endpoints bucket these by
// day for the requested period (7/14/30 days) rather than keeping running
// counters, so historical charts stay correct even if definitions evolve.
//
// IMPORTANT: like KeyStore/ScriptStore, this must live on a Railway Volume —
// set ANALYTICS_STORE_PATH to a path inside a mounted Volume.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname } from "path";

export type EventType =
  | "click"        // user opened a "Get Key" LootLabs link (loader called /api/getkey/start)
  | "checkpoint"   // one LootLabs task was completed (one postback hit)
  | "key_generated"// a key was created (admin panel OR issued via LootLabs)
  | "key_used"     // a key passed KeyStore.checkKey successfully
  | "script_exec"; // /api/access served a script to a loader

export interface AnalyticsEvent {
  type: EventType;
  at: number; // epoch ms
  scriptId?: string | null;
  keyType?: "free" | "premium" | null;
  sessionToken?: string | null; // ties clicks/checkpoints back to one Get Key session
}

const STORE_PATH = process.env.ANALYTICS_STORE_PATH || "/data/analytics.json";
const MAX_EVENTS = 200_000; // hard ceiling so the file can't grow unbounded forever

let cache: AnalyticsEvent[] | null = null;

function load(): AnalyticsEvent[] {
  if (cache) return cache;
  if (!existsSync(STORE_PATH)) {
    cache = [];
    return cache;
  }
  try {
    cache = JSON.parse(readFileSync(STORE_PATH, "utf-8"));
    if (!Array.isArray(cache)) cache = [];
  } catch (err) {
    console.error("[AnalyticsStore] Failed to read store, starting empty:", err);
    cache = [];
  }
  return cache!;
}

function save(): void {
  if (!cache) return;
  const dir = dirname(STORE_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(STORE_PATH, JSON.stringify(cache), "utf-8");
}

export function recordEvent(type: EventType, meta: Partial<Omit<AnalyticsEvent, "type" | "at">> = {}): void {
  const events = load();
  events.push({
    type,
    at: Date.now(),
    scriptId: meta.scriptId ?? null,
    keyType: meta.keyType ?? null,
    sessionToken: meta.sessionToken ?? null,
  });
  if (events.length > MAX_EVENTS) {
    events.splice(0, events.length - MAX_EVENTS);
  }
  save();
}

export interface DailyBucket {
  date: string; // YYYY-MM-DD, UTC
  clicks: number;
  checkpoints: number;
  keysGenerated: number;
  keysUsed: number;
  scriptExecutions: number;
}

export interface OverviewSummary {
  period: number; // days
  totals: {
    clicks: number;
    checkpoints: number;
    keysGenerated: number;
    keysUsed: number;
    scriptExecutions: number;
  };
  daily: DailyBucket[];
  checkpointBounceRate: number; // percentage, 0-100
}

function dayKey(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

// Builds the last `days` day-buckets (oldest first), always including days
// with zero activity so charts don't show gaps.
export function getOverview(days: 7 | 14 | 30): OverviewSummary {
  const events = load();
  const now = Date.now();
  const since = now - days * 86_400_000;

  const buckets = new Map<string, DailyBucket>();
  for (let i = days - 1; i >= 0; i--) {
    const ts = now - i * 86_400_000;
    const key = dayKey(ts);
    buckets.set(key, { date: key, clicks: 0, checkpoints: 0, keysGenerated: 0, keysUsed: 0, scriptExecutions: 0 });
  }

  const totals = { clicks: 0, checkpoints: 0, keysGenerated: 0, keysUsed: 0, scriptExecutions: 0 };

  // Checkpoint bounce rate: of the sessions that logged at least one
  // checkpoint in this period, how many never reached the *final*
  // checkpoint (i.e. dropped off before the last task)? We approximate
  // "reached the final checkpoint" using key_generated events tied to the
  // same sessionToken, since a key is only issued once all tasks clear.
  const sessionCheckpoints = new Map<string, number>();
  const sessionCompleted = new Set<string>();

  for (const ev of events) {
    if (ev.at < since || ev.at > now) continue;
    const bucket = buckets.get(dayKey(ev.at));
    if (!bucket) continue;

    switch (ev.type) {
      case "click":
        bucket.clicks++;
        totals.clicks++;
        break;
      case "checkpoint":
        bucket.checkpoints++;
        totals.checkpoints++;
        if (ev.sessionToken) {
          sessionCheckpoints.set(ev.sessionToken, (sessionCheckpoints.get(ev.sessionToken) || 0) + 1);
        }
        break;
      case "key_generated":
        bucket.keysGenerated++;
        totals.keysGenerated++;
        if (ev.sessionToken) sessionCompleted.add(ev.sessionToken);
        break;
      case "key_used":
        bucket.keysUsed++;
        totals.keysUsed++;
        break;
      case "script_exec":
        bucket.scriptExecutions++;
        totals.scriptExecutions++;
        break;
    }
  }

  let bounceRate = 0;
  if (sessionCheckpoints.size > 0) {
    let bounced = 0;
    for (const token of sessionCheckpoints.keys()) {
      if (!sessionCompleted.has(token)) bounced++;
    }
    bounceRate = (bounced / sessionCheckpoints.size) * 100;
  }

  return {
    period: days,
    totals,
    daily: Array.from(buckets.values()),
    checkpointBounceRate: Math.round(bounceRate * 10) / 10,
  };
}
