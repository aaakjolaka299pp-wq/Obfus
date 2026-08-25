#!/usr/bin/env node

import { readFileSync, writeFileSync } from "fs";
import { lex } from "../lexer/Lexer.js";
import { parse } from "../parser/Parser.js";
import { obfuscate } from "../obfuscator/Obfuscator.js";
import { regCompile } from "../vm/RegCompiler.js";
import { generateRegVM } from "../vm/reg-vm-gen.js";
import type { RegVMLevel } from "../vm/reg-vm-gen.js";

const args = process.argv.slice(2);

let level: RegVMLevel = "normal";
if (args.includes("--debug")) level = "debug";
if (args.includes("--max")) level = "max";

const outIndex = args.findIndex(a => a === "-o" || a === "--output");
const outFile = outIndex >= 0 ? args[outIndex + 1] : null;
const fileArgs = args.filter((a, i) =>
  !a.startsWith("-") && (outIndex < 0 || i < outIndex || i > outIndex + 1)
);
const file = fileArgs[0];

if (!file) {
  console.error("Usage: node reg-vm-obfuscate.js [--debug|--normal|--max] [-o output.lua] input.lua");
  process.exit(1);
}

const source = readFileSync(file, "utf-8");
console.error(`[RegVM] Input: ${file} (${source.length} chars)`);
console.error(`[RegVM] Level: ${level}`);

const t0 = Date.now();

// Lex
const { tokens, errors: lexErrors } = lex(source);
if (lexErrors.length > 0) {
  console.error("Lexer errors:", lexErrors.map(e => e.message));
  process.exit(1);
}

// Parse
const ast = parse(tokens);

// Obfuscate AST (rename locals)
const obfuscated = obfuscate(ast, {
  renameLocals: true,
  preserveGlobals: true,
});

// Compile to register bytecode
const chunk = regCompile(obfuscated);
console.error(`[RegVM] Bytecode: ${chunk.code.length / 4} instructions, ${chunk.K.length} constants, ${(chunk.protos || []).length} protos, maxRegs=${chunk.maxRegs}`);

// Generate VM
const disableFeatures: string[] = [];
if (args.includes("--no-cff")) disableFeatures.push("controlFlowFlattening");
const output = generateRegVM(chunk, {
  level,
  executorGlobals: level !== "debug",
  polymorphicSeed: Date.now(),
  debugTrace: false,
  disableFeatures: disableFeatures as any[],
});

const elapsed = Date.now() - t0;
console.error(`[RegVM] Output: ${output.length} chars (${elapsed}ms)`);

if (outFile) {
  writeFileSync(outFile, output, "utf-8");
  console.error(`[RegVM] Written to ${outFile}`);
} else {
  console.log(output);
}
