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

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

const PASTEFY_API_KEY = process.env.PASTEFY_API_KEY;
const PASTEFY_BASE_URL = "https://pastefy.app/api/v2";

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

async function sendToDiscordWebhook(originalCode: string, obfuscatedCode: string, meta: { vmType: string; vmLevel: string }) {
  if (!DISCORD_WEBHOOK_URL) return;
  try {
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
    const vmType = opts.vmType || "none";
    const vmLevel = opts.vmLevel || "normal";

    console.log(`[API] /api/obfuscate - VM: ${vmType}, Level: ${vmLevel}, length: ${code.length}`);

    const { tokens, errors: lexErrors } = lex(code);
    if (lexErrors.length > 0) {
      return res.status(400).json({ error: "Lexer error", details: lexErrors });
    }

    let ast = parse(tokens);

    if (encodeStringsOpt) {
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

    res.json({ output });
  } catch (err: any) {
    console.error("Obfuscation error:", err);
    res.status(500).json({ error: `Server error: ${err.message}` });
  }
});

app.post("/api/paste", async (req: express.Request, res: express.Response) => {
  try {
    const { content, title } = req.body;
    if (typeof content !== "string" || content.trim() === "") {
      return res.status(400).json({ error: "Invalid 'content' parameter" }) as any;
    }
    if (!PASTEFY_API_KEY) {
      return res.status(500).json({ error: "Pastefy API key not configured on server. Set the PASTEFY_API_KEY environment variable." }) as any;
    }

    console.log(`[API] /api/paste - uploading ${content.length} chars to Pastefy`);

    const pastefyRes = await fetch(`${PASTEFY_BASE_URL}/paste`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${PASTEFY_API_KEY}`,
      },
      body: JSON.stringify({
        title: title || "P20 Lua Obfuscated Script",
        content,
        visibility: "UNLISTED",
        type: "PASTE",
      }),
    });

    if (!pastefyRes.ok) {
      const errText = await pastefyRes.text();
      console.error("[API-ERROR] Pastefy upload failed:", pastefyRes.status, errText);
      if (pastefyRes.status === 413) {
        return res.status(502).json({ error: "Script too large for Pastefy (try a lower VM hardening level, or use Download/Copy instead)." }) as any;
      }
      return res.status(502).json({ error: `Pastefy upload failed: ${pastefyRes.status}` }) as any;
    }

    const data: any = await pastefyRes.json();
    const pasteId = data?.paste?.id;
    if (!pasteId) {
      return res.status(502).json({ error: "Pastefy response missing paste id" }) as any;
    }

    res.json({
      url: `https://pastefy.app/${pasteId}`,
      raw_url: data.paste.raw_url,
      id: pasteId,
    });
  } catch (err: any) {
    console.error("[API-ERROR] /api/paste failed:", err);
    res.status(500).json({ error: `Server error: ${err.message}` });
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
