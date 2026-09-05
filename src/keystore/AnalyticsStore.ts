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
  | "script_exec"; // /api/access served a script to a loader (request reached the server)

export interface AnalyticsEvent {
  type: EventType;
  at: number; // epoch ms
  scriptId?: string | null;
  keyType?: "free" | "premium" | null;
  sessionToken?: string | null; // ties clicks/checkpoints back to one Get Key session
  provider?: string | null; // "lootlabs" today; kept open for future task-locker providers
  success?: boolean | null; // for script_exec: did the delivered script actually run/verify ok
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
    provider: meta.provider ?? (type === "click" || type === "checkpoint" ? "lootlabs" : null),
    success: meta.success ?? null,
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
  successfulExecutions: number;
}

export interface ProviderBounce {
  provider: string;
  opened: number;    // clicks
  completed: number; // key_generated tied to a session for this provider
  bounced: number;
  bounceRate: number; // percentage, 0-100
  usersLost: number;  // same as bounced, named for the "users lost" copy in the UI
}

export interface OverviewSummary {
  period: number; // days
  totals: {
    clicks: number;
    checkpoints: number;
    keysGenerated: number;
    keysUsed: number;
    scriptExecutions: number;
    successfulExecutions: number;
  };
  // Same shape as `totals`, but for the equal-length period immediately
  // before this one — lets the UI show "vs previous period" badges
  // (e.g. Clicks +100%) without the client having to fetch twice.
  previousTotals: {
    clicks: number;
    checkpoints: number;
    keysGenerated: number;
    keysUsed: number;
    scriptExecutions: number;
  };
  daily: DailyBucket[];
  checkpointBounceRate: number; // percentage, 0-100, all providers combined
  // Distinct checkpoint sessions and how many of them actually reached a
  // key — this is the correct denominator/numerator for "key conversion"
  // (NOT keysGenerated, which also includes admin-issued keys with no
  // checkpoint session at all).
  checkpointSessions: number;
  checkpointSessionsCompleted: number;
  bounceByProvider: ProviderBounce[]; // sorted by usersLost desc
}

function dayKey(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

function emptyTotals() {
  return { clicks: 0, checkpoints: 0, keysGenerated: 0, keysUsed: 0, scriptExecutions: 0, successfulExecutions: 0 };
}

// Builds the last `days` day-buckets (oldest first), always including days
// with zero activity so charts don't show gaps.
export function getOverview(days: 7 | 14 | 30): OverviewSummary {
  const events = load();
  const now = Date.now();
  const periodMs = days * 86_400_000;
  const since = now - periodMs;
  const prevSince = since - periodMs;

  const buckets = new Map<string, DailyBucket>();
  for (let i = days - 1; i >= 0; i--) {
    const ts = now - i * 86_400_000;
    const key = dayKey(ts);
    buckets.set(key, { date: key, clicks: 0, checkpoints: 0, keysGenerated: 0, keysUsed: 0, scriptExecutions: 0, successfulExecutions: 0 });
  }

  const totals = emptyTotals();
  const previousTotals = emptyTotals();

  // Checkpoint bounce rate (all providers combined): of the sessions that
  // logged at least one checkpoint in this period, how many never reached
  // the final checkpoint (i.e. dropped off before a key was issued)?
  const sessionCheckpoints = new Map<string, number>();
  const sessionCompleted = new Set<string>();

  // Same idea, but split per provider so the UI can rank "which task
  // locker loses the most users" (currently only "lootlabs" exists, but
  // this holds up once a second provider is added).
  const providerOpened = new Map<string, Set<string>>();   // provider -> session tokens that clicked
  const providerCompleted = new Map<string, Set<string>>(); // provider -> session tokens that got a key

  for (const ev of events) {
    const inCurrent = ev.at >= since && ev.at <= now;
    const inPrevious = ev.at >= prevSince && ev.at < since;
    if (!inCurrent && !inPrevious) continue;

    const bucket = inCurrent ? buckets.get(dayKey(ev.at)) : undefined;
    const t = inCurrent ? totals : previousTotals;

    switch (ev.type) {
      case "click":
        t.clicks++;
        if (bucket) bucket.clicks++;
        if (inCurrent && ev.sessionToken) {
          const provider = ev.provider || "lootlabs";
          if (!providerOpened.has(provider)) providerOpened.set(provider, new Set());
          providerOpened.get(provider)!.add(ev.sessionToken);
        }
        break;
      case "checkpoint":
        t.checkpoints++;
        if (bucket) bucket.checkpoints++;
        if (inCurrent && ev.sessionToken) {
          sessionCheckpoints.set(ev.sessionToken, (sessionCheckpoints.get(ev.sessionToken) || 0) + 1);
        }
        break;
      case "key_generated":
        t.keysGenerated++;
        if (bucket) bucket.keysGenerated++;
        if (inCurrent && ev.sessionToken) {
          sessionCompleted.add(ev.sessionToken);
          const provider = ev.provider || "lootlabs";
          if (!providerCompleted.has(provider)) providerCompleted.set(provider, new Set());
          providerCompleted.get(provider)!.add(ev.sessionToken);
        }
        break;
      case "key_used":
        t.keysUsed++;
        if (bucket) bucket.keysUsed++;
        break;
      case "script_exec":
        t.scriptExecutions++;
        if (bucket) bucket.scriptExecutions++;
        // Until failed deliveries are tracked separately, every recorded
        // script_exec represents a script that was successfully served —
        // /api/access only fires this event after every check has passed.
        if (ev.success !== false) {
          t.successfulExecutions++;
          if (bucket) bucket.successfulExecutions++;
        }
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

  const bounceByProvider: ProviderBounce[] = [];
  for (const [provider, openedSet] of providerOpened.entries()) {
    const completedSet = providerCompleted.get(provider) || new Set();
    const opened = openedSet.size;
    let completed = 0;
    for (const token of openedSet) {
      if (completedSet.has(token)) completed++;
    }
    const bounced = opened - completed;
    bounceByProvider.push({
      provider,
      opened,
      completed,
      bounced,
      bounceRate: opened > 0 ? Math.round((bounced / opened) * 1000) / 10 : 0,
      usersLost: bounced,
    });
  }
  bounceByProvider.sort((a, b) => b.usersLost - a.usersLost);

  return {
    period: days,
    totals,
    previousTotals,
    daily: Array.from(buckets.values()),
    checkpointBounceRate: Math.round(bounceRate * 10) / 10,
    checkpointSessions: sessionCheckpoints.size,
    checkpointSessionsCompleted: Array.from(sessionCheckpoints.keys()).filter((t) => sessionCompleted.has(t)).length,
    bounceByProvider,
  };
}
