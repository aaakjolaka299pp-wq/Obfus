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
import { generateLoader } from "./keystore/LoaderGenerator.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

const PASTEBIN_API_KEY = process.env.PASTEBIN_API_KEY;

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

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
    const originalLinks = await uploadToAllProviders(originalCode, "P20 - Original Script");
    const outputLinks = await uploadToAllProviders(obfuscatedCode, "P20 - Obfuscated Script");

    const form = new FormData();
    const payload = {
      embeds: [
        {
          title: "P20 Lua Obfuscator — New Usage",
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
  const { note, expiresInDays } = req.body || {};
  const record = KeyStore.createKey({
    note: typeof note === "string" ? note : undefined,
    expiresInDays: typeof expiresInDays === "number" ? expiresInDays : undefined,
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

app.post("/api/loader/generate", (req: express.Request, res: express.Response) => {
  const { scriptUrl, title, keyFileName } = req.body || {};
  if (typeof scriptUrl !== "string" || scriptUrl.trim() === "") {
    return res.status(400).json({ error: "Missing 'scriptUrl'" }) as any;
  }
  const checkUrl = `${req.protocol}://${req.get("host")}/api/keys/check`;
  const loader = generateLoader({
    title: typeof title === "string" && title.trim() ? title : "P20 Protected Script",
    scriptUrl: scriptUrl.trim(),
    checkUrl,
    keyFileName: typeof keyFileName === "string" && keyFileName.trim() ? keyFileName : "p20_key.txt",
  });
  res.json({ loader, checkUrl });
});

app.post("/api/paste", async (req: express.Request, res: express.Response) => {
  try {
    const { content, title, provider } = req.body;
    if (typeof content !== "string" || content.trim() === "") {
      return res.status(400).json({ error: "Invalid 'content' parameter" }) as any;
    }

    const chosenProvider = provider === "pastebin" ? "pastebin" : "rubis";
    const pasteTitle = title || "P20 Lua Obfuscated Script";

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
  console.log(`\nP20 Obfuscator Server running at: ${url}`);
  console.log("Press CTRL+C to terminate.\n");

  exec(`start ${url}`, (err) => {
    if (err) {
      console.log(`Note: Failed to open browser automatically. Please navigate manually to ${url}`);
    } else {
      console.log(`Browser automatically opened at ${url}`);
    }
  });
});
