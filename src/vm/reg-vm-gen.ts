import { RegOp, REG_OPCODE_COUNT, RK_OFFSET } from "./bytecode.js";
import type { RegBytecodeChunk, Constant } from "./bytecode.js";
import { randomBytes } from "crypto";
import { writeFileSync as _dumpWrite } from "fs";
import { encryptAndEncode, compressToBase85, compressBytesToBase85 } from "./lzma.js";
import { generateBootstrap } from "./bootstrap-template.js";

export type RegVMLevel = "debug" | "normal" | "max";

export type RegFeatureFlag =
  | "opcodeShuffle"
  | "stringEncoding"
  | "constantFolding"
  | "minification"
  | "fakeHandlers"
  | "handlerNoise"
  | "antiDebug"
  | "antiTamper"

  | "controlFlowFlattening"
  | "opcodeFusion"
  | "deadCodeInjection"
  | "syntaxInterpreter"
  | "customCipher"
  | "stubCompression"
  | "vmNesting";

export interface RegVMGenOptions {
  level?: RegVMLevel;
  executorGlobals?: boolean;
  polymorphicSeed?: number;
  disableFeatures?: RegFeatureFlag[];
  forceFeatures?: RegFeatureFlag[];

  debugTrace?: boolean;
  _noWatermark?: boolean;

  target?: string;
}

interface BuildCtx {
  level: RegVMLevel;
  seed: number;
  names: NameMap;
  opcodeEncode: number[];
  opcodeDecode: number[];
  doShuffle: boolean;
  encodeStrings: boolean;
  xorKey: number;
  xorStep: number;
  includeExecutor: boolean;
  protoKeys: { pK: string; pC: string; pP: string; pU: string; pN: string };
  debugTrace: boolean;

  sbox: number[];
  sboxInverse: number[];
  helixSeed: number;
  helixMul: number;
  cascadeKey: number;
  cascadeMul: number;
  checkKeyA: number;
  checkKeyB: number;
  checkStepA: number;
  checkStepB: number;
  spiralPrime: number;
  spiralOffset: number;
  layerVariants: number[];

  dispatchVariant: number;
  dispatchMask: number;
  rotSeed: number;
  rotStep: number;
  rotStep2: number;
  usedOps?: Set<number>;
  argPerm: number[][];
}

interface Fragment {
  code: string;
  layer: number;
}

interface NameMap {
  run: string;
  env: string;
  genv: string;
  R: string;
  K: string;
  code: string;
  protos: string;
  ip: string;
  upvalues: string;
  varargs: string;
  vaCount: string;
  maxRegs: string;
  nParams: string;
  handlers: string;
  openUVs: string;
  RK: string;
  top: string;
  retFlag: string;
  retVals: string;
  tPack: string;
  tUnpack: string;
  ic: string;

  bPcall: string;
  bXpcall: string;
  bSelect: string;
  bType: string;
  bTconcat: string;
  bTcreate: string;
  bMfloor: string;
  bIpairs: string;
  bTostring: string;
  bRawget: string;
  bSetmeta: string;
  bBxor: string;
  bBand: string;
  bGetmeta: string;
  bNext: string;

  s1: string;
  s2: string;
  s3: string;
}

let _rngState = 0;

function seedRandom(s: number): void {
  _rngState = s >>> 0;
}

function rng(): number {
  _rngState = (_rngState + 0x6D2B79F5) >>> 0;
  let t = Math.imul(_rngState ^ (_rngState >>> 15), 1 | _rngState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
}

let _nameCounter = 0;

function resetNames(): void { _nameCounter = 0; }

function randomName(len: number = 6): string {

  const pool1 = "abcdefghijklmnopqrstuvwxyzDEFGHIJKLMNOPQRSTUVWXYZ";
  const pool2 = "_abcdefghijklmnopqrstuvwxyz";

  const id = _nameCounter++;

  if (id < pool1.length) {

    return pool1[id];
  }

  const id2 = id - pool1.length;
  if (id2 < pool2.length * pool1.length) {
    const c1 = pool2[Math.floor(id2 / pool1.length)];
    const c2 = pool1[id2 % pool1.length];
    return c1 + c2;
  }

  let name = "_";
  for (let i = 0; i < Math.min(len, 2); i++) {
    name += pool1[Math.floor(rng() * pool1.length)];
  }
  return name;
}

function createNameMap(level: RegVMLevel): NameMap {
  if (level === "debug") {
    return {
      run: "_run", env: "_env", genv: "_genv",
      R: "R", K: "K", code: "code", protos: "protos",
      ip: "ip", upvalues: "upvals", varargs: "VA", vaCount: "VAC",
      maxRegs: "maxRegs", nParams: "nParams",
      handlers: "H", openUVs: "openUVs", RK: "RK", top: "_top",
      retFlag: "_rf", retVals: "_rv",
      tPack: "_tpack", tUnpack: "_tunpack",
      ic: "_ic",
      bPcall: "_pcall", bXpcall: "_xpcall", bSelect: "_select", bType: "_type",
      bTconcat: "_tconcat", bTcreate: "_tcreate", bMfloor: "_mfloor", bIpairs: "_ipairs",
      bTostring: "_tostring", bRawget: "_rawget", bSetmeta: "_setmeta",
      bBxor: "_bxor", bBand: "_band",
      bGetmeta: "_getmeta", bNext: "_next",
      s1: "_s1", s2: "_s2", s3: "_s3",
    };
  }
  return {
    run: randomName(5), env: randomName(4), genv: randomName(4),
    R: randomName(3), K: randomName(3), code: randomName(4),
    protos: randomName(4), ip: randomName(3), upvalues: randomName(5),
    varargs: randomName(4), vaCount: randomName(4),
    maxRegs: randomName(3), nParams: randomName(3),
    handlers: randomName(4), openUVs: randomName(4), RK: randomName(3), top: randomName(3),
    retFlag: randomName(3), retVals: randomName(3),
    tPack: randomName(3), tUnpack: randomName(3),
    ic: randomName(3),
    bPcall: randomName(3), bXpcall: randomName(3), bSelect: randomName(3), bType: randomName(3),
    bTconcat: randomName(3), bTcreate: randomName(3), bMfloor: randomName(3), bIpairs: randomName(3),
    bTostring: randomName(3), bRawget: randomName(3), bSetmeta: randomName(3),
    bBxor: randomName(3), bBand: randomName(3),
    bGetmeta: randomName(3), bNext: randomName(3),
    s1: randomName(2), s2: randomName(2), s3: randomName(2),
  };
}

function toUTF8Bytes(s: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c < 0x80) bytes.push(c);
    else if (c < 0x800) bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const lo = s.charCodeAt(++i);
      c = ((c - 0xd800) << 10) + (lo - 0xdc00) + 0x10000;
      bytes.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    } else bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
  }
  return bytes;
}

function luaStringLiteral(s: string): string {
  const bytes = toUTF8Bytes(s);
  let out = '"';
  for (const b of bytes) {
    if (b === 34) out += '\\"';
    else if (b === 92) out += "\\\\";
    else if (b === 10) out += "\\n";
    else if (b === 13) out += "\\r";
    else if (b === 0) out += "\\000";
    else if (b < 32 || b > 126) out += `\\${b.toString().padStart(3, '0')}`;
    else out += String.fromCharCode(b);
  }
  return out + '"';
}

function luaEsc(s: string): string {
  const encChar = (code: number): string => {
    const m = Math.floor(rng() * 3);
    if (m === 0) return '\\' + code;
    if (m === 1) return '\\' + code.toString().padStart(3, '0');
    return '\\' + code;
  };

  if (s.length >= 4 && rng() > 0.5) {
    const mid = 1 + Math.floor(rng() * (s.length - 2));
    const left = Array.from(s.slice(0, mid)).map(c => encChar(c.charCodeAt(0))).join('');
    const right = Array.from(s.slice(mid)).map(c => encChar(c.charCodeAt(0))).join('');
    return `("${left}".."${right}")`;
  }
  return '"' + Array.from(s).map(c => encChar(c.charCodeAt(0))).join('') + '"';
}

function luaStr(s: string): string {
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 34) out += '\\"';
    else if (c === 92) out += '\\\\';
    else if (c === 10) out += '\\n';
    else if (c === 13) out += '\\r';
    else if (c === 0) out += '\\000';
    else if (c < 32 || c > 126) out += `\\${c.toString().padStart(3, '0')}`;
    else out += s[i];
  }
  return out + '"';
}

function featureEnabled(options: RegVMGenOptions, flag: RegFeatureFlag, levelDefault: boolean): boolean {
  if (options.disableFeatures?.includes(flag)) return false;
  if (options.forceFeatures?.includes(flag)) return true;
  return levelDefault;
}

function shuffleOpcodes(doShuffle: boolean): { encode: number[]; decode: number[] } {
  const encode: number[] = [];
  const decode: number[] = [];
  for (let i = 0; i < REG_OPCODE_COUNT; i++) { encode[i] = i; decode[i] = i; }
  if (!doShuffle) return { encode, decode };
  for (let i = REG_OPCODE_COUNT - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [encode[i], encode[j]] = [encode[j], encode[i]];
  }
  for (let i = 0; i < REG_OPCODE_COUNT; i++) decode[encode[i]] = i;
  return { encode, decode };
}

function generateArgPerms(doRemap: boolean): number[][] {
  const ALL_PERMS = [[1,2,3],[1,3,2],[2,1,3],[2,3,1],[3,1,2],[3,2,1]];
  const perms: number[][] = [];
  for (let op = 0; op < REG_OPCODE_COUNT; op++) {
    if (!doRemap || op === RegOp.NOP || op === RegOp.EXTRAARG) {
      perms[op] = [1, 2, 3];
    } else {
      perms[op] = ALL_PERMS[Math.floor(rng() * 6)];
    }
  }
  return perms;
}

function mapRegBytecode(code: number[], encode: number[], argPerm: number[][]): number[] {
  const out = [...code];
  for (let i = 0; i < out.length; i += 4) {
    const realOp = out[i];
    if (realOp >= 0 && realOp < encode.length) {
      const A = out[i + 1], B = out[i + 2], C = out[i + 3];
      out[i] = encode[realOp];
      const p = argPerm[realOp];

      out[i + p[0]] = A;
      out[i + p[1]] = B;
      out[i + p[2]] = C;
    }
  }
  return out;
}

function mapRegChunk(chunk: RegBytecodeChunk, encode: number[], argPerm: number[][]): void {
  chunk.code = mapRegBytecode(chunk.code, encode, argPerm);
  if (chunk.protos) for (const p of chunk.protos) mapRegChunk(p, encode, argPerm);
}

const SPIRAL_PRIMES = [
  3,7,11,13,17,19,23,29,31,37,41,43,47,53,59,61,67,71,73,79,
  83,89,97,101,103,107,109,113,127,131,137,139,149,151,157,163,
  167,173,179,181,191,193,197,199,211,223,227,229,233,239,241,
];

function generateSBox(): { sbox: number[]; inverse: number[] } {
  const sbox = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [sbox[i], sbox[j]] = [sbox[j], sbox[i]];
  }
  const inverse = new Array<number>(256);
  for (let i = 0; i < 256; i++) inverse[sbox[i]] = i;
  return { sbox, inverse };
}

function encodeStringBytes(raw: number[], ctx: BuildCtx, constIdx: number): number[] {
  const b = [...raw];
  const salt = constIdx & 0xFF;

  for (let i = 0; i < b.length; i++) b[i] = ctx.sbox[b[i] ^ ((salt + i) & 0xFF)];

  for (let i = 0; i < b.length; i++) b[i] = (b[i] + ((ctx.helixSeed + salt + i * ctx.helixMul) & 0xFF)) & 0xFF;

  for (let i = b.length - 1; i > 0; i--) b[i] ^= ((b[i - 1] * ctx.cascadeMul + ctx.cascadeKey + salt) & 0xFF);

  for (let i = 0; i < b.length; i++) {
    const h = i >> 1;
    const k = (i & 1) === 0
      ? ((ctx.checkKeyA + salt + h * ctx.checkStepA) & 0xFF)
      : ((ctx.checkKeyB + salt + h * ctx.checkStepB) & 0xFF);
    b[i] ^= k;
  }

  for (let i = 0; i < b.length; i++) b[i] ^= ((i * ctx.spiralPrime + ctx.spiralOffset + salt) % 251);
  return b;
}

function serializeConstant(v: Constant, ctx: BuildCtx, idx: number): string {
  if (v === null || v === undefined) return "nil";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") {
    if (Object.is(v, -0)) return "-0";
    if (!Number.isFinite(v)) {
      if (v === Infinity) return "(1/0)";
      if (v === -Infinity) return "(-1/0)";
      return "(0/0)";
    }
    return String(v);
  }
  if (typeof v === "string") {
    if (ctx.encodeStrings) {
      const bytes = toUTF8Bytes(v);
      const encoded = encodeStringBytes(bytes, ctx, idx);

      if (rng() < 0.5) {

        let lit = '"';
        for (const b of encoded) {
          if (b === 92) lit += '\\\\';
          else if (b === 34) lit += '\\"';
          else if (b === 10) lit += '\\n';
          else if (b === 13) lit += '\\r';
          else if (b === 0) lit += '\\000';
          else if (b < 32 || b > 126) lit += `\\${b.toString().padStart(3, '0')}`;
          else lit += String.fromCharCode(b);
        }
        lit += '"';
        return lit;
      }
      return `{${encoded.join(",")}}`;
    }
    return luaStringLiteral(v);
  }
  return "nil";
}

function serializeConstants(K: Constant[], ctx: BuildCtx): string {
  return `{${K.map((v, i) => serializeConstant(v, ctx, i)).join(",")}}`;
}

function serializeRegCode(code: number[], ctx?: BuildCtx): string {
  if (ctx && ctx.rotSeed > 0) {
    const out = [...code];
    for (let i = 0; i < out.length; i += 4) {
      const luaIp = i + 1;

      const key = (ctx.rotSeed + luaIp * ctx.rotStep + Math.imul(luaIp, luaIp) * ctx.rotStep2) & 0xFF;
      out[i] ^= key;
    }
    return `{${out.join(",")}}`;
  }
  return `{${code.join(",")}}`;
}

function serializeRegProtos(protos: RegBytecodeChunk[] | undefined, ctx: BuildCtx): string {
  if (!protos || protos.length === 0) return "{}";
  const pk = ctx.protoKeys;
  const usePositional = ctx.level !== "debug";
  const items: string[] = [];
  for (const p of protos) {
    const mappedCode = ctx.doShuffle ? mapRegBytecode(p.code, ctx.opcodeEncode, ctx.argPerm) : p.code;
    const sK = serializeConstants(p.K, ctx);
    const sC = serializeRegCode(mappedCode, ctx);
    const sP = serializeRegProtos(p.protos, ctx);
    let sU = "nil";
    if (p.upvalues && p.upvalues.length > 0) {
      sU = `{${p.upvalues.map(uv => `{${uv[0]},${uv[1]}}`).join(",")}}`;
    }
    const nP = p.nParams ?? 0;
    const mR = p.maxRegs ?? 0;
    const isVA = p.isVararg ? "true" : "false";
    if (usePositional) {

      items.push(`{${sK},${sC},${sP},${sU},${nP},${mR},${isVA}}`);
    } else {
      items.push(`{${pk.pK}=${sK},${pk.pC}=${sC},${pk.pP}=${sP},${pk.pU}=${sU},${pk.pN}=${nP},mR=${mR},vA=${isVA}}`);
    }
  }
  return `{${items.join(",")}}`;
}

const REG_OP_NAMES: string[] = [
  "NOP","LOADK","LOADNIL","LOADBOOL","MOVE","GETGLOBAL","SETGLOBAL",
  "GETTABLE","SETTABLE","NEWTABLE","ADD","SUB","MUL","DIV","MOD",
  "POW","IDIV","UNM","NOT","LEN","CONCAT","JMP","EQ","LT","LE",
  "TEST","TESTSET","CALL","TAILCALL","RETURN","FORPREP","FORLOOP",
  "TFORLOOP","SETLIST","CLOSURE","VARARG","SELF","GETUPVAL","SETUPVAL",
  "CLOSEUPVAL","PCALL","XPCALL","ITERPREP","LOADKX","EXTRAARG",
  "F_TEST_JMP","F_EQ_JMP","F_LT_JMP","F_LE_JMP","F_TESTSET_JMP",
  "F_GGET","F_LOADKK","F_MOVE_MOVE","F_SELF_CALL","F_GGET_CALL",
  "F_LOADK_RET","F_MOVE_RET",
];

type HandlerGen = (n: NameMap, ctx: BuildCtx) => string;

const handlerRegistry: Map<RegOp, HandlerGen> = new Map();

function registerHandler(op: RegOp, gen: HandlerGen): void {
  handlerRegistry.set(op, gen);
}

registerHandler(RegOp.NOP, () => ``);

registerHandler(RegOp.LOADK, (n) =>
  `${n.R}[A+1]=${n.K}[B+1]`);

registerHandler(RegOp.LOADNIL, (n) =>
  `for _i=A,A+B do ${n.R}[_i+1]=nil end`);

registerHandler(RegOp.LOADBOOL, (n) =>
  `${n.R}[A+1]=(B~=0);if C~=0 then ${n.ip}=${n.ip}+4 end`);

registerHandler(RegOp.MOVE, (n) =>
  `${n.R}[A+1]=${n.R}[B+1]`);

registerHandler(RegOp.LOADKX, (n) =>
  `local ex=${n.code}[${n.ip}+1];${n.R}[A+1]=${n.K}[ex+1];${n.ip}=${n.ip}+4`);

registerHandler(RegOp.EXTRAARG, () => ``);

registerHandler(RegOp.GETGLOBAL, (n) => {
  const dbg = process.env.DEBUG_VM === '1';
  const nilChk = dbg ? `;if ${n.R}[A+1]==nil then warn("[GETGLOBAL] nil: "..tostring(_k)) end` : '';
  return `do local _k=${n.K}[B+1];if ${n.ic}[1]==_k then ${n.R}[A+1]=${n.ic}[2] else local _v=${n.env}[_k];${n.R}[A+1]=_v;${n.ic}[1]=_k;${n.ic}[2]=_v end${nilChk} end`;
});

registerHandler(RegOp.SETGLOBAL, (n) =>
  `do ${n.env}[${n.K}[B+1]]=${n.R}[A+1];${n.ic}[1]=nil end`);

registerHandler(RegOp.GETTABLE, (n) => {
  const dbg = process.env.DEBUG_VM === '1';
  if (dbg) return `do if ${n.R}[B+1]==nil then warn("[GETTABLE] nil base, key="..tostring(${n.RK}(C)).." K="..tostring(${n.K}[B+1])) end;${n.R}[A+1]=${n.R}[B+1][${n.RK}(C)] end`;
  return `${n.R}[A+1]=${n.R}[B+1][${n.RK}(C)]`;
});

registerHandler(RegOp.SETTABLE, (n) =>
  `${n.R}[A+1][${n.RK}(B)]=${n.RK}(C)`);

registerHandler(RegOp.NEWTABLE, (n) =>
  `${n.R}[A+1]={}`);

registerHandler(RegOp.SETLIST, (n) =>
  `do local t=${n.R}[A+1];local _b=B;if _b==0 then _b=${n.top}-(A+1) end;local base=C-1;for _i=1,_b do t[base+_i]=${n.R}[A+1+_i] end end`);

registerHandler(RegOp.SELF, (n) =>
  `${n.R}[A+2]=${n.R}[B+1];${n.R}[A+1]=${n.R}[B+1][${n.RK}(C)]`);

registerHandler(RegOp.ADD, (n) => `${n.R}[A+1]=${n.RK}(B)+${n.RK}(C)`);
registerHandler(RegOp.SUB, (n) => `${n.R}[A+1]=${n.RK}(B)-${n.RK}(C)`);
registerHandler(RegOp.MUL, (n) => `${n.R}[A+1]=${n.RK}(B)*${n.RK}(C)`);
registerHandler(RegOp.DIV, (n) => `${n.R}[A+1]=${n.RK}(B)/${n.RK}(C)`);
registerHandler(RegOp.MOD, (n) => `${n.R}[A+1]=${n.RK}(B)%${n.RK}(C)`);
registerHandler(RegOp.POW, (n) => `${n.R}[A+1]=${n.RK}(B)^${n.RK}(C)`);
registerHandler(RegOp.IDIV, (n) => `${n.R}[A+1]=${n.bMfloor}(${n.RK}(B)/${n.RK}(C))`);

registerHandler(RegOp.UNM, (n) => `${n.R}[A+1]=-${n.R}[B+1]`);
registerHandler(RegOp.NOT, (n) => `${n.R}[A+1]=not ${n.R}[B+1]`);
registerHandler(RegOp.LEN, (n) => `${n.R}[A+1]=#${n.R}[B+1]`);

registerHandler(RegOp.CONCAT, (n) =>
  `do if C-B<=1 then ${n.R}[A+1]=${n.R}[B+1]..${n.R}[C+1] ` +
  `else local _t={};for _i=B,C do _t[#_t+1]=${n.R}[_i+1] end;${n.R}[A+1]=${n.bTconcat}(_t) end end`);

registerHandler(RegOp.JMP, (n) =>
  `${n.ip}=${n.ip}+B*4`);

registerHandler(RegOp.EQ, (n) =>
  `if (${n.RK}(B)==${n.RK}(C))~=(A~=0) then ${n.ip}=${n.ip}+4 end`);

registerHandler(RegOp.LT, (n) =>
  `if (${n.RK}(B)<${n.RK}(C))~=(A~=0) then ${n.ip}=${n.ip}+4 end`);

registerHandler(RegOp.LE, (n) =>
  `if (${n.RK}(B)<=${n.RK}(C))~=(A~=0) then ${n.ip}=${n.ip}+4 end`);

registerHandler(RegOp.TEST, (n) =>
  `if (not ${n.R}[A+1])==(C~=0) then ${n.ip}=${n.ip}+4 end`);

registerHandler(RegOp.TESTSET, (n) =>
  `if (not ${n.R}[B+1])==(C~=0) then ${n.ip}=${n.ip}+4 else ${n.R}[A+1]=${n.R}[B+1] end`);

registerHandler(RegOp.CALL, (n) => {

  const storeR = () =>
    `if C==0 then for _i=1,r.n do ${n.R}[A+_i]=r[_i] end;${n.top}=A+r.n ` +
    `else for _i=1,C-1 do ${n.R}[A+_i]=r[_i] end end`;
  return `do local f=${n.R}[A+1];local r;` +
    `if B==1 then r=${n.tPack}(f()) ` +
    `elseif B==2 then r=${n.tPack}(f(${n.R}[A+2])) ` +
    `elseif B==3 then r=${n.tPack}(f(${n.R}[A+2],${n.R}[A+3])) ` +
    `elseif B==0 then r=${n.tPack}(f(${n.tUnpack}(${n.R},A+2,${n.top}))) ` +
    `else r=${n.tPack}(f(${n.tUnpack}(${n.R},A+2,A+B))) end;` +
    `${storeR()} end`;
});

registerHandler(RegOp.TAILCALL, (n) =>
  `do local f=${n.R}[A+1];` +
  `if B==1 then return f() ` +
  `elseif B==2 then return f(${n.R}[A+2]) ` +
  `elseif B==3 then return f(${n.R}[A+2],${n.R}[A+3]) ` +
  `elseif B==0 then return f(${n.tUnpack}(${n.R},A+2,${n.top})) ` +
  `else return f(${n.tUnpack}(${n.R},A+2,A+B)) end end`);

registerHandler(RegOp.RETURN, (n) =>
  `do if B==0 then return ${n.tUnpack}(${n.R},A+1,${n.top}) ` +
  `elseif B==1 then return ` +
  `else return ${n.tUnpack}(${n.R},A+1,A+B-1) end end`);

registerHandler(RegOp.FORPREP, (n) =>
  `${n.R}[A+1]=${n.R}[A+1]-${n.R}[A+3];${n.ip}=${n.ip}+B*4`);

registerHandler(RegOp.FORLOOP, (n) =>
  `do local step=${n.R}[A+3];local idx=${n.R}[A+1]+step;${n.R}[A+1]=idx;` +
  `local lim=${n.R}[A+2];if step>0 then if idx<=lim then ${n.ip}=${n.ip}+B*4;${n.R}[A+4]=idx end ` +
  `else if idx>=lim then ${n.ip}=${n.ip}+B*4;${n.R}[A+4]=idx end end end`);

registerHandler(RegOp.TFORLOOP, (n) =>
  `do local f=${n.R}[A+1];local s=${n.R}[A+2];local v=${n.R}[A+3];` +
  `local r={f(s,v)};for _i=1,C do ${n.R}[A+3+_i]=r[_i] end;` +
  `if r[1]~=nil then ${n.R}[A+3]=r[1];${n.ip}=${n.ip}+4 end end`);

registerHandler(RegOp.ITERPREP, (n) =>
  `do local it=${n.R}[A+1];if ${n.bType}(it)=="table" then ` +
  `local ok,mt=${n.bPcall}(${n.bGetmeta},it);if ok and ${n.bType}(mt)=="table" and mt.__iter then ` +
  `${n.R}[A+1]=mt.__iter(it) else ${n.R}[A+1]=${n.bNext};${n.R}[A+2]=it;${n.R}[A+3]=nil end end end`);

registerHandler(RegOp.GETUPVAL, (n) =>
  `do local _b=${n.upvalues}[B+1];if _b[2] then ${n.R}[A+1]=_b[1][_b[2]] else ${n.R}[A+1]=_b[1] end end`);

registerHandler(RegOp.SETUPVAL, (n) =>
  `do local _b=${n.upvalues}[B+1];if _b[2] then _b[1][_b[2]]=${n.R}[A+1] else _b[1]=${n.R}[A+1] end end`);

registerHandler(RegOp.CLOSEUPVAL, (n) =>
  `do local _n=0;for _i=1,#${n.openUVs} do local _b=${n.openUVs}[_i];if _b[2]>=A+1 then ` +
  `_b[1]=_b[1][_b[2]];_b[2]=nil else _n=_n+1;${n.openUVs}[_n]=_b end end;` +
  `for _i=_n+1,#${n.openUVs} do ${n.openUVs}[_i]=nil end end`);

registerHandler(RegOp.VARARG, (n) =>
  `do if B==0 then for _i=1,${n.vaCount} do ${n.R}[A+_i]=${n.varargs}[_i] end;${n.top}=A+${n.vaCount} ` +
  `else for _i=1,B-1 do ${n.R}[A+_i]=${n.varargs}[_i] end end end`);

registerHandler(RegOp.CLOSURE, (n, ctx) => {
  const pos = ctx.level !== "debug";

  const { pK, pC, pP, pU, pN } = ctx.protoKeys;
  const gK = pos ? "[1]" : `.${pK}`;
  const gC = pos ? "[2]" : `.${pC}`;
  const gP = pos ? "[3]" : `.${pP}`;
  const gU = pos ? "[4]" : `.${pU}`;
  const gN = pos ? "[5]" : `.${pN}`;
  const gMR = pos ? "[6]" : ".mR";
  const gVA = pos ? "[7]" : ".vA";
  return `do local proto=${n.protos}[B+1];if proto then ` +
    `local nU={};if proto${gU} then for _ui,_ud in ${n.bIpairs}(proto${gU}) do ` +
    `if _ud[1]==1 then local _b;for _oi=1,#${n.openUVs} do if ${n.openUVs}[_oi][2]==_ud[2]+1 then _b=${n.openUVs}[_oi];break end end;` +
    `if not _b then _b={${n.R},_ud[2]+1};${n.openUVs}[#${n.openUVs}+1]=_b end;nU[_ui]=_b ` +
    `else nU[_ui]=${n.upvalues}[_ud[2]+1] end end end;` +
    `${n.R}[A+1]=function(...) return ${n.run}(proto${gK},proto${gC},proto${gP},proto${gU} and nU or {},proto${gN},proto${gMR},proto${gVA},${n.env},...) end ` +
    `else ${n.R}[A+1]=nil end end`;
});

registerHandler(RegOp.PCALL, (n) =>
  `do local f=${n.R}[A+1];local r;` +
  `if B==1 then r=${n.tPack}(${n.bPcall}(f)) ` +
  `elseif B==2 then r=${n.tPack}(${n.bPcall}(f,${n.R}[A+2])) ` +
  `elseif B==3 then r=${n.tPack}(${n.bPcall}(f,${n.R}[A+2],${n.R}[A+3])) ` +
  `else r=${n.tPack}(${n.bPcall}(f,${n.tUnpack}(${n.R},A+2,A+B))) end;` +
  `if C==0 then for _i=1,r.n do ${n.R}[A+_i]=r[_i] end;${n.top}=A+r.n ` +
  `else for _i=1,C-1 do ${n.R}[A+_i]=r[_i] end end end`);

registerHandler(RegOp.XPCALL, (n) =>
  `do local f=${n.R}[A+1];local eh=${n.R}[A+2];local r;` +
  `if B<=2 then r=${n.tPack}(${n.bXpcall}(f,eh)) ` +
  `elseif B==3 then r=${n.tPack}(${n.bXpcall}(f,eh,${n.R}[A+3])) ` +
  `else r=${n.tPack}(${n.bXpcall}(f,eh,${n.tUnpack}(${n.R},A+3,A+B))) end;` +
  `if C==0 then for _i=1,r.n do ${n.R}[A+_i]=r[_i] end;${n.top}=A+r.n ` +
  `else for _i=1,C-1 do ${n.R}[A+_i]=r[_i] end end end`);

registerHandler(RegOp.FUSED_TEST_JMP, (n) => {
  const v = Math.floor(rng() * 3);
  if (v === 0)
    return `do local _j=${n.code}[${n.ip}+2];if (not ${n.R}[A+1])==(C~=0) then ${n.ip}=${n.ip}+4 else ${n.ip}=${n.ip}+4+_j*4 end end`;
  if (v === 1)
    return `do local _j=${n.code}[${n.ip}+2];if (not ${n.R}[A+1])~=(C~=0) then ${n.ip}=${n.ip}+4+_j*4 else ${n.ip}=${n.ip}+4 end end`;
  return `do local _o=${n.code}[${n.ip}+2]*4;${n.ip}=${n.ip}+4;if (not ${n.R}[A+1])~=(C~=0) then ${n.ip}=${n.ip}+_o end end`;
});

registerHandler(RegOp.FUSED_EQ_JMP, (n) => {
  const v = Math.floor(rng() * 3);
  if (v === 0)
    return `do local _j=${n.code}[${n.ip}+2];if (${n.RK}(B)==${n.RK}(C))~=(A~=0) then ${n.ip}=${n.ip}+4 else ${n.ip}=${n.ip}+4+_j*4 end end`;
  if (v === 1)
    return `do local _j=${n.code}[${n.ip}+2];if (${n.RK}(B)==${n.RK}(C))==(A~=0) then ${n.ip}=${n.ip}+4+_j*4 else ${n.ip}=${n.ip}+4 end end`;
  return `do local _lv,_rv=${n.RK}(B),${n.RK}(C);local _j=${n.code}[${n.ip}+2];if (_lv==_rv)~=(A~=0) then ${n.ip}=${n.ip}+4 else ${n.ip}=${n.ip}+4+_j*4 end end`;
});

registerHandler(RegOp.FUSED_LT_JMP, (n) => {
  const v = Math.floor(rng() * 3);
  if (v === 0)
    return `do local _j=${n.code}[${n.ip}+2];if (${n.RK}(B)<${n.RK}(C))~=(A~=0) then ${n.ip}=${n.ip}+4 else ${n.ip}=${n.ip}+4+_j*4 end end`;
  if (v === 1)
    return `do local _j=${n.code}[${n.ip}+2];if (${n.RK}(B)<${n.RK}(C))==(A~=0) then ${n.ip}=${n.ip}+4+_j*4 else ${n.ip}=${n.ip}+4 end end`;
  return `do local _lv,_rv=${n.RK}(B),${n.RK}(C);local _o=${n.code}[${n.ip}+2]*4;${n.ip}=${n.ip}+4;if (_lv<_rv)==(A~=0) then ${n.ip}=${n.ip}+_o end end`;
});

registerHandler(RegOp.FUSED_LE_JMP, (n) => {
  const v = Math.floor(rng() * 3);
  if (v === 0)
    return `do local _j=${n.code}[${n.ip}+2];if (${n.RK}(B)<=${n.RK}(C))~=(A~=0) then ${n.ip}=${n.ip}+4 else ${n.ip}=${n.ip}+4+_j*4 end end`;
  if (v === 1)
    return `do local _j=${n.code}[${n.ip}+2];if (${n.RK}(B)<=${n.RK}(C))==(A~=0) then ${n.ip}=${n.ip}+4+_j*4 else ${n.ip}=${n.ip}+4 end end`;
  return `do local _lv,_rv=${n.RK}(B),${n.RK}(C);local _o=${n.code}[${n.ip}+2]*4;${n.ip}=${n.ip}+4;if (_lv<=_rv)==(A~=0) then ${n.ip}=${n.ip}+_o end end`;
});

registerHandler(RegOp.FUSED_TESTSET_JMP, (n) => {
  const v = Math.floor(rng() * 2);
  if (v === 0)
    return `do local _j=${n.code}[${n.ip}+2];if (not ${n.R}[B+1])==(C~=0) then ${n.ip}=${n.ip}+4 else ${n.R}[A+1]=${n.R}[B+1];${n.ip}=${n.ip}+4+_j*4 end end`;
  return `do local _bv=${n.R}[B+1];local _j=${n.code}[${n.ip}+2];if (not _bv)==(C~=0) then ${n.ip}=${n.ip}+4 else ${n.R}[A+1]=_bv;${n.ip}=${n.ip}+4+_j*4 end end`;
});

registerHandler(RegOp.FUSED_GGET, (n) => {
  const v = Math.floor(rng() * 3);
  const dbg = process.env.DEBUG_VM === '1';
  const nilG = dbg ? `if _g==nil then warn("[FUSED_GGET] nil global: "..tostring(${n.K}[B+1])) end;` : '';
  if (v === 0)
    return `do local _A2=${n.code}[${n.ip}+1];local _C2=${n.code}[${n.ip}+3];local _g=${n.env}[${n.K}[B+1]];${nilG}${n.R}[A+1]=_g;${n.R}[_A2+1]=_g[${n.RK}(_C2)];${n.ip}=${n.ip}+4 end`;
  if (v === 1)
    return `do local _A2=${n.code}[${n.ip}+1];local _C2=${n.code}[${n.ip}+3];local _g=${n.env}[${n.K}[B+1]];${nilG}${n.R}[A+1]=_g;${n.R}[_A2+1]=_g[${n.RK}(_C2)];${n.ip}=${n.ip}+4 end`;
  return `do local _g=${n.env}[${n.K}[B+1]];${nilG}${n.R}[A+1]=_g;local _k=${n.RK}(${n.code}[${n.ip}+3]);${n.R}[${n.code}[${n.ip}+1]+1]=_g[_k];${n.ip}=${n.ip}+4 end`;
});

registerHandler(RegOp.FUSED_LOADKK, (n) => {
  const v = Math.floor(rng() * 2);
  if (v === 0)
    return `do local _A2=${n.code}[${n.ip}+1];local _B2=${n.code}[${n.ip}+2];${n.R}[A+1]=${n.K}[B+1];${n.R}[_A2+1]=${n.K}[_B2+1];${n.ip}=${n.ip}+4 end`;
  return `do ${n.R}[A+1]=${n.K}[B+1];${n.R}[${n.code}[${n.ip}+1]+1]=${n.K}[${n.code}[${n.ip}+2]+1];${n.ip}=${n.ip}+4 end`;
});

registerHandler(RegOp.FUSED_MOVE_MOVE, (n) => {
  const v = Math.floor(rng() * 2);
  if (v === 0)
    return `do local _A2=${n.code}[${n.ip}+1];local _B2=${n.code}[${n.ip}+2];${n.R}[A+1]=${n.R}[B+1];${n.R}[_A2+1]=${n.R}[_B2+1];${n.ip}=${n.ip}+4 end`;
  return `do ${n.R}[A+1]=${n.R}[B+1];${n.R}[${n.code}[${n.ip}+1]+1]=${n.R}[${n.code}[${n.ip}+2]+1];${n.ip}=${n.ip}+4 end`;
});

registerHandler(RegOp.FUSED_SELF_CALL, (n) => {
  const v = Math.floor(rng() * 2);
  const callBody =
    `local _B2=${n.code}[${n.ip}+2];local _C2=${n.code}[${n.ip}+3];${n.ip}=${n.ip}+4;` +
    `local r;` +
    `if _B2==2 then r=${n.tPack}(f(${n.R}[A+2])) ` +
    `elseif _B2==3 then r=${n.tPack}(f(${n.R}[A+2],${n.R}[A+3])) ` +
    `elseif _B2==0 then r=${n.tPack}(f(${n.tUnpack}(${n.R},A+2,${n.top}))) ` +
    `else r=${n.tPack}(f(${n.tUnpack}(${n.R},A+2,A+_B2))) end;` +
    `if _C2==0 then for _i=1,r.n do ${n.R}[A+_i]=r[_i] end;${n.top}=A+r.n ` +
    `else for _i=1,_C2-1 do ${n.R}[A+_i]=r[_i] end end`;
  if (v === 0)
    return `do ${n.R}[A+2]=${n.R}[B+1];local f=${n.R}[B+1][${n.RK}(C)];${n.R}[A+1]=f;${callBody} end`;
  return `do local _s=${n.R}[B+1];${n.R}[A+2]=_s;local f=_s[${n.RK}(C)];${n.R}[A+1]=f;${callBody} end`;
});

registerHandler(RegOp.FUSED_GGET_CALL, (n) => {

  const v = Math.floor(rng() * 2);
  const readSlot2 = `local _A2=${n.code}[${n.ip}+1];local _C2=${n.code}[${n.ip}+3]`;
  const readSlot3 = `local _A3=${n.code}[${n.ip}+5];local _B3=${n.code}[${n.ip}+6];local _C3=${n.code}[${n.ip}+7]`;
  const gget = v === 0
    ? `local _g=${n.env}[${n.K}[B+1]];${n.R}[A+1]=_g;local f=_g[${n.RK}(_C2)];${n.R}[_A2+1]=f`
    : `local _g=${n.env}[${n.K}[B+1]];${n.R}[A+1]=_g;${n.R}[_A2+1]=_g[${n.RK}(_C2)];local f=${n.R}[_A2+1]`;
  const callBody =
    `local r;` +
    `if _B3==1 then r=${n.tPack}(f()) ` +
    `elseif _B3==2 then r=${n.tPack}(f(${n.R}[_A3+2])) ` +
    `elseif _B3==3 then r=${n.tPack}(f(${n.R}[_A3+2],${n.R}[_A3+3])) ` +
    `elseif _B3==0 then r=${n.tPack}(f(${n.tUnpack}(${n.R},_A3+2,${n.top}))) ` +
    `else r=${n.tPack}(f(${n.tUnpack}(${n.R},_A3+2,_A3+_B3))) end;` +
    `if _C3==0 then for _i=1,r.n do ${n.R}[_A3+_i]=r[_i] end;${n.top}=_A3+r.n ` +
    `else for _i=1,_C3-1 do ${n.R}[_A3+_i]=r[_i] end end`;
  return `do ${readSlot2};${readSlot3};${gget};${n.ip}=${n.ip}+8;${callBody} end`;
});

registerHandler(RegOp.FUSED_LOADK_RET, (n) => {
  const v = Math.floor(rng() * 2);
  if (v === 0)
    return `do ${n.R}[A+1]=${n.K}[B+1];${n.ip}=${n.ip}+4;return ${n.R}[A+1] end`;
  return `do local _v=${n.K}[B+1];${n.ip}=${n.ip}+4;return _v end`;
});

registerHandler(RegOp.FUSED_MOVE_RET, (n) => {
  const v = Math.floor(rng() * 3);
  if (v === 0)
    return `do local _A2=${n.code}[${n.ip}+1];local _B2=${n.code}[${n.ip}+2];${n.R}[A+1]=${n.R}[B+1];${n.ip}=${n.ip}+4;if _B2==0 then return ${n.tUnpack}(${n.R},_A2+1,${n.top}) elseif _B2==1 then return else return ${n.tUnpack}(${n.R},_A2+1,_A2+_B2-1) end end`;
  if (v === 1)
    return `do ${n.R}[A+1]=${n.R}[B+1];local _A2=${n.code}[${n.ip}+1];local _B2=${n.code}[${n.ip}+2];${n.ip}=${n.ip}+4;if _B2==2 then return ${n.R}[_A2+1] elseif _B2==1 then return elseif _B2==0 then return ${n.tUnpack}(${n.R},_A2+1,${n.top}) else return ${n.tUnpack}(${n.R},_A2+1,_A2+_B2-1) end end`;
  return `do ${n.R}[A+1]=${n.R}[B+1];local _B2=${n.code}[${n.ip}+2];if _B2==0 then ${n.ip}=${n.ip}+4;return ${n.tUnpack}(${n.R},${n.code}[${n.ip}-3]+1,${n.top}) elseif _B2==1 then ${n.ip}=${n.ip}+4;return else ${n.ip}=${n.ip}+4;return ${n.tUnpack}(${n.R},${n.code}[${n.ip}-3]+1,${n.code}[${n.ip}-3]+_B2-1) end end`;
});

function computeJumpTargets(code: number[]): Set<number> {
  const targets = new Set<number>();
  for (let i = 0; i < code.length; i += 4) {
    const op = code[i];
    if (op === RegOp.JMP as number || op === RegOp.FORPREP as number || op === RegOp.FORLOOP as number) {
      const B = code[i + 2];
      const target = i + 4 + B * 4;
      if (target >= 0 && target < code.length) targets.add(target);
    }

    if (op === RegOp.LOADBOOL as number && code[i + 3] !== 0) {
      targets.add(i + 8);
    }
  }
  return targets;
}

function flattenControlFlow(chunk: RegBytecodeChunk): number {
  let totalBlocks = 0;

  function flattenCode(code: number[]): number[] {
    if (code.length <= 16) return code;

    const targets = new Set<number>();
    targets.add(0);
    for (let i = 0; i < code.length; i += 4) {
      const op = code[i];
      if (op === (RegOp.JMP as number) || op === (RegOp.FORPREP as number) || op === (RegOp.FORLOOP as number)) {
        const B = code[i + 2];
        const t = i + 4 + B * 4;
        if (t >= 0 && t <= code.length) targets.add(t);
      }
      if (op === (RegOp.LOADBOOL as number) && code[i + 3] !== 0) targets.add(i + 8);
      if (op === (RegOp.EQ as number) || op === (RegOp.LT as number) || op === (RegOp.LE as number) ||
          op === (RegOp.TEST as number) || op === (RegOp.TESTSET as number) || op === (RegOp.TFORLOOP as number)) {
        targets.add(i + 8);
      }
      if (op === (RegOp.FUSED_TEST_JMP as number) || op === (RegOp.FUSED_EQ_JMP as number) ||
          op === (RegOp.FUSED_LT_JMP as number) || op === (RegOp.FUSED_LE_JMP as number) ||
          op === (RegOp.FUSED_TESTSET_JMP as number)) {
        const _j = code[i + 6];
        const t = i + 8 + _j * 4;
        if (t >= 0 && t <= code.length) targets.add(t);
        targets.add(i + 8);
      }
    }

    for (let i = 0; i < code.length; i += 4) {
      const op = code[i];

      if (op === (RegOp.EQ as number) || op === (RegOp.LT as number) || op === (RegOp.LE as number) ||
          op === (RegOp.TEST as number) || op === (RegOp.TESTSET as number) || op === (RegOp.TFORLOOP as number)) {
        targets.delete(i + 4);
      }

      if (op === (RegOp.LOADBOOL as number) && code[i + 3] !== 0) targets.delete(i + 4);

      if (op === (RegOp.LOADKX as number)) targets.delete(i + 4);

      if (op === (RegOp.SETLIST as number) && code[i + 3] === 0) targets.delete(i + 4);

      if (op === (RegOp.FUSED_TEST_JMP as number) || op === (RegOp.FUSED_EQ_JMP as number) ||
          op === (RegOp.FUSED_LT_JMP as number) || op === (RegOp.FUSED_LE_JMP as number) ||
          op === (RegOp.FUSED_TESTSET_JMP as number) || op === (RegOp.FUSED_GGET as number) ||
          op === (RegOp.FUSED_LOADKK as number) || op === (RegOp.FUSED_MOVE_MOVE as number) ||
          op === (RegOp.FUSED_SELF_CALL as number) || op === (RegOp.FUSED_LOADK_RET as number) ||
          op === (RegOp.FUSED_MOVE_RET as number)) {
        targets.delete(i + 4);
      }

      if (op === (RegOp.FUSED_GGET_CALL as number)) {
        targets.delete(i + 4);
        targets.delete(i + 8);
      }
    }

    for (const t of targets) { if (t < 0 || t >= code.length) targets.delete(t); }

    const unsafeSplit = new Set<number>();
    for (let i = 0; i < code.length; i += 4) {
      const op = code[i];
      if (op === (RegOp.EQ as number) || op === (RegOp.LT as number) || op === (RegOp.LE as number) ||
          op === (RegOp.TEST as number) || op === (RegOp.TESTSET as number) || op === (RegOp.TFORLOOP as number)) {
        unsafeSplit.add(i + 4);
      }
      if (op === (RegOp.LOADBOOL as number) && code[i + 3] !== 0) unsafeSplit.add(i + 4);
      if (op === (RegOp.LOADKX as number)) unsafeSplit.add(i + 4);
      if (op === (RegOp.SETLIST as number) && code[i + 3] === 0) unsafeSplit.add(i + 4);
      if (op === (RegOp.FUSED_TEST_JMP as number) || op === (RegOp.FUSED_EQ_JMP as number) ||
          op === (RegOp.FUSED_LT_JMP as number) || op === (RegOp.FUSED_LE_JMP as number) ||
          op === (RegOp.FUSED_TESTSET_JMP as number) || op === (RegOp.FUSED_GGET as number) ||
          op === (RegOp.FUSED_LOADKK as number) || op === (RegOp.FUSED_MOVE_MOVE as number) ||
          op === (RegOp.FUSED_SELF_CALL as number) || op === (RegOp.FUSED_LOADK_RET as number) ||
          op === (RegOp.FUSED_MOVE_RET as number)) {
        unsafeSplit.add(i + 4);
      }
      if (op === (RegOp.FUSED_GGET_CALL as number)) {
        unsafeSplit.add(i + 4);
        unsafeSplit.add(i + 8);
      }
    }

    const splitThreshold = 3 + Math.floor(rng() * 3);
    const sortedTargets = Array.from(targets).sort((a, b) => a - b);
    for (let bi = 0; bi < sortedTargets.length; bi++) {
      const bStart = sortedTargets[bi];
      const bEnd = bi + 1 < sortedTargets.length ? sortedTargets[bi + 1] : code.length;
      const bInstrCount = (bEnd - bStart) / 4;
      if (bInstrCount > splitThreshold) {

        const candidates: number[] = [];
        for (let pos = bStart + splitThreshold * 4; pos < bEnd - 4; pos += 4) {
          if (!unsafeSplit.has(pos) && !targets.has(pos)) {
            candidates.push(pos);
          }
        }

        const nSplits = Math.min(candidates.length, 1 + Math.floor(rng() * 3));
        for (let si = candidates.length - 1; si > 0; si--) {
          const sj = Math.floor(rng() * (si + 1));
          [candidates[si], candidates[sj]] = [candidates[sj], candidates[si]];
        }
        for (let si = 0; si < nSplits; si++) {
          targets.add(candidates[si]);
        }
      }
    }

    const blockStarts = Array.from(targets).sort((a, b) => a - b);
    if (blockStarts.length < 3) return code;

    interface JRef { lo: number; ot: number; }
    interface Blk { os: number; oe: number; ins: number[]; jr: JRef[]; }
    const blocks: Blk[] = [];

    for (let bi = 0; bi < blockStarts.length; bi++) {
      const start = blockStarts[bi];
      const end = bi + 1 < blockStarts.length ? blockStarts[bi + 1] : code.length;
      const ins = code.slice(start, end);
      const jr: JRef[] = [];
      const bLen = ins.length;

      for (let j = 0; j < bLen; j += 4) {
        const op = ins[j];
        if (op === (RegOp.JMP as number) || op === (RegOp.FORPREP as number) || op === (RegOp.FORLOOP as number)) {
          jr.push({ lo: j + 2, ot: start + j + 4 + ins[j + 2] * 4 });
        }
        if (op === (RegOp.FUSED_TEST_JMP as number) || op === (RegOp.FUSED_EQ_JMP as number) ||
            op === (RegOp.FUSED_LT_JMP as number) || op === (RegOp.FUSED_LE_JMP as number) ||
            op === (RegOp.FUSED_TESTSET_JMP as number)) {
          jr.push({ lo: j + 6, ot: start + j + 8 + ins[j + 6] * 4 });
        }
      }

      const lastOp = ins[bLen - 4];
      const secOp = bLen >= 8 ? ins[bLen - 8] : -1;

      const isTerm = lastOp === (RegOp.JMP as number) || lastOp === (RegOp.RETURN as number) ||
        lastOp === (RegOp.TAILCALL as number) || lastOp === (RegOp.FORPREP as number) ||
        lastOp === (RegOp.FUSED_LOADK_RET as number) || lastOp === (RegOp.FUSED_MOVE_RET as number);

      const isCondJmp = bLen >= 8 &&
        (secOp === (RegOp.EQ as number) || secOp === (RegOp.LT as number) || secOp === (RegOp.LE as number) ||
         secOp === (RegOp.TEST as number) || secOp === (RegOp.TESTSET as number) ||
         secOp === (RegOp.TFORLOOP as number)) && lastOp === (RegOp.JMP as number);

      const isFusedCond = bLen >= 8 &&
        (secOp === (RegOp.FUSED_TEST_JMP as number) || secOp === (RegOp.FUSED_EQ_JMP as number) ||
         secOp === (RegOp.FUSED_LT_JMP as number) || secOp === (RegOp.FUSED_LE_JMP as number) ||
         secOp === (RegOp.FUSED_TESTSET_JMP as number)) && lastOp === (RegOp.NOP as number);

      if (isCondJmp || isFusedCond) {

        ins.push(RegOp.JMP as number, 0, 0, 0);
        jr.push({ lo: ins.length - 2, ot: end });
      } else if (lastOp === (RegOp.FORLOOP as number)) {

        ins.push(RegOp.JMP as number, 0, 0, 0);
        jr.push({ lo: ins.length - 2, ot: end });
      } else if (!isTerm && end < code.length) {

        ins.push(RegOp.JMP as number, 0, 0, 0);
        jr.push({ lo: ins.length - 2, ot: end });
      }

      blocks.push({ os: start, oe: end, ins, jr });
    }

    for (let i = blocks.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [blocks[i], blocks[j]] = [blocks[j], blocks[i]];
    }

    const origToNew = new Map<number, number>();
    let pos = 4;
    for (const b of blocks) {
      const bNew = pos;
      for (let off = 0; off < b.oe - b.os; off += 4) {
        origToNew.set(b.os + off, bNew + off);
      }
      pos += b.ins.length;
    }
    origToNew.set(code.length, pos);

    const entryTarget = origToNew.get(0)!;
    const entryB = (entryTarget - 4) / 4;

    for (const b of blocks) {
      const bNew = origToNew.get(b.os)!;
      for (const ref of b.jr) {
        let nt = origToNew.get(ref.ot);
        if (nt === undefined) {

          for (const b2 of blocks) {
            if (ref.ot >= b2.os && ref.ot < b2.oe) {
              nt = origToNew.get(b2.os)! + (ref.ot - b2.os);
              break;
            }
          }
          if (nt === undefined) { nt = pos; }
        }

        const ipAfter = bNew + ref.lo + 2;
        b.ins[ref.lo] = (nt - ipAfter) / 4;
      }
    }

    const newCode: number[] = [RegOp.JMP as number, 0, entryB, 0];
    for (const b of blocks) newCode.push(...b.ins);

    totalBlocks += blocks.length;
    return newCode;
  }

  chunk.code = flattenCode(chunk.code);
  if (chunk.protos) {
    for (const proto of chunk.protos) {
      totalBlocks += flattenControlFlow(proto);
    }
  }
  return totalBlocks;
}

interface FusionPattern {
  id: number;
  name: string;
  slots: number;
  match: (code: number[], i: number) => boolean;
}

function buildFusionPatterns(enabled: Set<number>): FusionPattern[] {
  const patterns: FusionPattern[] = [];
  const add = (id: number, name: string, slots: number, match: (code: number[], i: number) => boolean) => {
    if (enabled.has(id)) patterns.push({ id, name, slots, match });
  };

  add(RegOp.FUSED_GGET_CALL as number, "GGET_CALL", 3, (c, i) =>
    c[i] === (RegOp.GETGLOBAL as number) &&
    c[i+4] === (RegOp.GETTABLE as number) &&
    c[i+8] === (RegOp.CALL as number) &&
    c[i+4+2] === c[i+1] &&
    c[i+8+1] === c[i+4+1]
  );

  add(RegOp.FUSED_TEST_JMP as number, "TEST_JMP", 2, (c, i) =>
    c[i] === (RegOp.TEST as number) && c[i+4] === (RegOp.JMP as number));

  add(RegOp.FUSED_EQ_JMP as number, "EQ_JMP", 2, (c, i) =>
    c[i] === (RegOp.EQ as number) && c[i+4] === (RegOp.JMP as number));

  add(RegOp.FUSED_LT_JMP as number, "LT_JMP", 2, (c, i) =>
    c[i] === (RegOp.LT as number) && c[i+4] === (RegOp.JMP as number));

  add(RegOp.FUSED_LE_JMP as number, "LE_JMP", 2, (c, i) =>
    c[i] === (RegOp.LE as number) && c[i+4] === (RegOp.JMP as number));

  add(RegOp.FUSED_TESTSET_JMP as number, "TESTSET_JMP", 2, (c, i) =>
    c[i] === (RegOp.TESTSET as number) && c[i+4] === (RegOp.JMP as number));

  add(RegOp.FUSED_GGET as number, "GGET", 2, (c, i) =>
    c[i] === (RegOp.GETGLOBAL as number) &&
    c[i+4] === (RegOp.GETTABLE as number) &&
    c[i+4+2] === c[i+1]
  );

  add(RegOp.FUSED_LOADKK as number, "LOADKK", 2, (c, i) =>
    c[i] === (RegOp.LOADK as number) && c[i+4] === (RegOp.LOADK as number));

  add(RegOp.FUSED_MOVE_MOVE as number, "MOVE_MOVE", 2, (c, i) =>
    c[i] === (RegOp.MOVE as number) && c[i+4] === (RegOp.MOVE as number));

  add(RegOp.FUSED_SELF_CALL as number, "SELF_CALL", 2, (c, i) =>
    c[i] === (RegOp.SELF as number) &&
    c[i+4] === (RegOp.CALL as number) &&
    c[i+4+1] === c[i+1]
  );

  add(RegOp.FUSED_LOADK_RET as number, "LOADK_RET", 2, (c, i) =>
    c[i] === (RegOp.LOADK as number) &&
    c[i+4] === (RegOp.RETURN as number) &&
    c[i+4+1] === c[i+1] && c[i+4+2] === 2
  );

  add(RegOp.FUSED_MOVE_RET as number, "MOVE_RET", 2, (c, i) =>
    c[i] === (RegOp.MOVE as number) && c[i+4] === (RegOp.RETURN as number));

  return patterns;
}

function applyFusionPass(chunk: RegBytecodeChunk, enabledPatterns: Set<number>, fusionRate: number): number {
  const patterns = buildFusionPatterns(enabledPatterns);
  let totalFused = 0;

  function fuseCode(code: number[]): number {
    const targets = computeJumpTargets(code);
    let count = 0;
    let i = 0;
    while (i < code.length - 4) {
      let matched = false;
      for (const pat of patterns) {

        if (i + pat.slots * 4 > code.length) continue;

        let targetConflict = false;
        for (let s = 1; s < pat.slots; s++) {
          if (targets.has(i + s * 4)) { targetConflict = true; break; }
        }
        if (targetConflict) continue;

        if (!pat.match(code, i)) continue;

        if (rng() > fusionRate) { i += 4; matched = true; break; }

        code[i] = pat.id;

        for (let s = 1; s < pat.slots; s++) {
          code[i + s * 4] = RegOp.NOP as number;
        }
        count++;
        i += pat.slots * 4;
        matched = true;
        break;
      }
      if (!matched) i += 4;
    }
    return count;
  }

  totalFused += fuseCode(chunk.code);
  if (chunk.protos) {
    for (const proto of chunk.protos) {
      totalFused += applyFusionPass(proto, enabledPatterns, fusionRate);
    }
  }
  return totalFused;
}

function collectUsedOpcodes(chunk: { code: number[]; protos?: { code: number[]; protos?: any[] }[] }): Set<number> {
  const used = new Set<number>();
  for (let i = 0; i < chunk.code.length; i += 4) used.add(chunk.code[i]);
  if (chunk.protos) for (const p of chunk.protos) {
    for (const op of collectUsedOpcodes(p)) used.add(op);
  }
  return used;
}

function generateHandlerNoise(n: NameMap, op: number): string {

  const savedState = _rngState;
  _rngState = ((op * 0x45D9F3B + 0xDEADBEEF) >>> 0);

  rng(); rng();

  let noise = '';

  if (rng() < 0.7) {
    const dv = randomName(2);
    const variant = Math.floor(rng() * 6);
    if (variant === 0) noise = `local ${dv}=${n.ip};`;
    else if (variant === 1) noise = `local ${dv}=${n.bBand}(${n.ip},0xFF);`;
    else if (variant === 2) noise = `local ${dv}=${n.bBxor}(${n.ip},${Math.floor(rng() * 255) + 1});`;
    else if (variant === 3) noise = `local ${dv}=${n.top};`;
    else if (variant === 4) noise = `local ${dv}=${n.R}[1];`;
    else noise = `local ${dv}=${n.bType}(${n.R}[0]);`;
  }

  _rngState = savedState;
  return noise;
}

function buildHandlerBodies(n: NameMap, ctx: BuildCtx, usedOps?: Set<number>): Map<number, string> {
  const bodies = new Map<number, string>();
  const doNoise = ctx.level !== "debug";
  for (const [op, gen] of handlerRegistry) {

    if (usedOps && !usedOps.has(op as number)) continue;
    const shuffled = ctx.opcodeEncode[op as number];
    const body = gen(n, ctx);

    const p = ctx.argPerm[op as number];
    const slots = [n.s1, n.s2, n.s3];
    const remap = `local A,B,C=${slots[p[0]-1]},${slots[p[1]-1]},${slots[p[2]-1]};`;

    const noise = doNoise ? generateHandlerNoise(n, op as number) : '';
    bodies.set(shuffled, remap + noise + body);
  }
  return bodies;
}

function buildBuiltinCaptures(ctx: BuildCtx): { code: string; assignOnly: string } {
  const n = ctx.names;

  if (ctx.level === "debug") {
    const captures = [
      [n.bPcall, "pcall"], [n.bXpcall, "xpcall"], [n.bSelect, "select"], [n.bType, "type"],
      [n.tPack, "table.pack"], [n.tUnpack, "table.unpack"], [n.bTcreate, "table.create"],
      [n.bTconcat, "table.concat"], [n.bMfloor, "math.floor"], [n.bIpairs, "ipairs"],
      [n.bTostring, "tostring"], [n.bRawget, "rawget"], [n.bSetmeta, "setmetatable"],
      [n.bBxor, "bit32.bxor"], [n.bBand, "bit32.band"],
      [n.bGetmeta, "getmetatable"], [n.bNext, "next"],
    ];
    const fullLines = captures.map(([v, g]) => `local ${v}=${g}`);
    const assignLines = captures.map(([v, g]) => `${v}=${g}`);
    const check = `local _hookOk=true`;
    return { code: [...fullLines, check].join("\n"), assignOnly: [...assignLines, check].join("\n") };
  }

  const scVar = randomName(3);
  const geVar = randomName(3);

  const encName = (s: string): string => {
    const codes = Array.from(s).map(c => {
      const code = c.charCodeAt(0);
      const m = Math.floor(rng() * 4);
      if (m === 0) { const d = 1 + Math.floor(rng() * 20); return `${code - d}+${d}`; }
      if (m === 1) { const d = 1 + Math.floor(rng() * 20); return `${code + d}-${d}`; }
      if (m === 2) return `0x${code.toString(16)}`;
      return `${code}`;
    }).join(',');
    return `${scVar}(${codes})`;
  };

  const simpleCaptures: [string, string][] = [
    [n.bPcall, "pcall"], [n.bXpcall, "xpcall"], [n.bSelect, "select"], [n.bType, "type"],
    [n.bIpairs, "ipairs"], [n.bTostring, "tostring"], [n.bRawget, "rawget"],
    [n.bSetmeta, "setmetatable"], [n.bGetmeta, "getmetatable"], [n.bNext, "next"],
  ];

  const libCaptures: [string, string, string][] = [
    [n.tPack, "table", "pack"], [n.tUnpack, "table", "unpack"],
    [n.bTcreate, "table", "create"], [n.bTconcat, "table", "concat"],
    [n.bMfloor, "math", "floor"],
    [n.bBxor, "bit32", "bxor"], [n.bBand, "bit32", "band"],
  ];

  const libs = new Map<string, { libVar: string; members: [string, string][] }>();
  for (const [varName, lib, member] of libCaptures) {
    if (!libs.has(lib)) libs.set(lib, { libVar: randomName(2), members: [] });
    libs.get(lib)!.members.push([varName, member]);
  }

  const lines: string[] = [];
  lines.push(`do`);
  lines.push(`local ${scVar}=("")[${luaEsc("char")}]`);

  const lsBoot = randomName(2);
  lines.push(`local ${lsBoot}=loadstring`);
  const envBootSrc = `return (type(getfenv)=='function' and getfenv(0)) or _G`;
  const envBootCodes = Array.from(envBootSrc).map(c => {
    const code = c.charCodeAt(0);
    const m = Math.floor(rng() * 4);
    if (m === 0) { const d = 1 + Math.floor(rng() * 20); return `${code - d}+${d}`; }
    if (m === 1) { const d = 1 + Math.floor(rng() * 20); return `${code + d}-${d}`; }
    if (m === 2) return `0x${code.toString(16)}`;
    return `${code}`;
  }).join(',');
  lines.push(`local ${geVar}=${lsBoot}(${scVar}(${envBootCodes}))()`);

  const shuffledSimple = [...simpleCaptures];
  for (let i = shuffledSimple.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffledSimple[i], shuffledSimple[j]] = [shuffledSimple[j], shuffledSimple[i]];
  }
  for (const [varName, globalName] of shuffledSimple) {
    lines.push(`${varName}=${geVar}[${encName(globalName)}]`);
  }

  const libKeys = [...libs.keys()];
  for (let i = libKeys.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [libKeys[i], libKeys[j]] = [libKeys[j], libKeys[i]];
  }
  for (const libName of libKeys) {
    const { libVar, members } = libs.get(libName)!;
    lines.push(`local ${libVar}=${geVar}[${encName(libName)}]`);
    for (const [varName, memberName] of members) {
      lines.push(`${varName}=${libVar}[${encName(memberName)}]`);
    }
  }
  lines.push(`end`);

  const nHg = randomName(3);
  const checks: string[] = [
    `${n.bType}(1)=="number"`, `${n.bType}("")=="string"`,
    `${n.bSelect}("#",1,2,3)==3`,
    `${n.bPcall}(function() end)`,
    `${n.bXpcall}(function() return 1 end,function() end)`,
    `${n.bBxor}(0,0)==0`, `${n.bBand}(255,15)==15`,
    `${n.tPack}(1,2,3).n==3`,
    `${n.bSelect}("#",${n.tUnpack}({7,8}))==2`,
    `${n.bType}(${n.bTcreate}(0))=="table"`,
    `${n.bTconcat}({"a","b"})=="ab"`,
    `${n.bMfloor}(1.9)==1`,
    `${n.bTostring}(42)=="42"`,
    `${n.bRawget}({x=1},"x")==1`,
    `${n.bType}(${n.bSetmeta})=="function"`,
    `${n.bType}(${n.bIpairs})=="function"`,
    `${n.bType}(${n.bGetmeta})=="function"`,
  ];
  for (let ci = checks.length - 1; ci > 0; ci--) {
    const cj = Math.floor(rng() * (ci + 1));
    [checks[ci], checks[cj]] = [checks[cj], checks[ci]];
  }
  const check = `local ${nHg}=${checks.join(" and ")}`;
  const corrupt = process.env.NO_SEC === '1'
    ? `do end`
    : `if not ${nHg} then ${n.bTcreate}=function() return {} end;${n.tPack}=function(...) return {n=0} end;${n.bPcall}=function() return false end;${n.bSelect}=function() return 0 end;${n.bMfloor}=function(x) return x end end`;

  const captureCode = [...lines, check, corrupt].join("\n");
  return { code: captureCode, assignOnly: captureCode };
}

function buildVMRuntime(ctx: BuildCtx, assignStyle: boolean = false): string {
  const n = ctx.names;
  const { pK, pC, pP, pU, pN } = ctx.protoKeys;
  const L: string[] = [];

  L.push(assignStyle
    ? `${n.run}=function(${n.K},${n.code},${n.protos},${n.upvalues},${n.nParams},${n.maxRegs},_isVararg,${n.env},...)`
    : `local function ${n.run}(${n.K},${n.code},${n.protos},${n.upvalues},${n.nParams},${n.maxRegs},_isVararg,${n.env},...)`);
  L.push(`${n.protos}=${n.protos} or {}`);
  L.push(`${n.upvalues}=${n.upvalues} or {}`);

  L.push(`local ${n.R}=${n.bTcreate}(${n.maxRegs}+1)`);

  L.push(`local _args={...}`);
  L.push(`local _ac=${n.bSelect}("#",...)`);
  L.push(`for _i=1,((_ac<${n.nParams}) and _ac or ${n.nParams}) do ${n.R}[_i]=_args[_i] end`);

  L.push(`local ${n.varargs}={}`);
  L.push(`local ${n.vaCount}=0`);
  L.push(`if _isVararg then ${n.vaCount}=_ac-${n.nParams};if ${n.vaCount}<0 then ${n.vaCount}=0 end;for _i=1,${n.vaCount} do ${n.varargs}[_i]=_args[${n.nParams}+_i] end end`);

  if (ctx.level !== "debug") {
    L.push(`do local _c={};for _ci=1,#${n.code} do _c[_ci]=${n.code}[_ci] end;${n.code}=_c end`);
  }

  L.push(`local ${n.ip}=1`);
  L.push(`local ${n.openUVs}={}`);
  L.push(`local ${n.ic}={}`);
  L.push(`local ${n.top}=0`);

  const nTwVm = ctx.level !== "debug" ? randomName(2) : "_tw";
  L.push(`local ${nTwVm};do local _t=${n.env}["task"];if _t then ${nTwVm}=_t["wait"] end end`);

  let rkThreshVar = '';
  let rkSubVar = '';
  if (ctx.level !== "debug") {
    rkThreshVar = randomName(3);
    rkSubVar = randomName(3);
    const rkVariant = Math.floor(rng() * 6);
    const a = Math.floor(rng() * 200) + 10;
    const b = RK_OFFSET - a;
    if (rkVariant === 0) {
      L.push(`local ${rkThreshVar}=${a}+${b}`);
    } else if (rkVariant === 1) {
      L.push(`local ${rkThreshVar}=${n.bBxor}(${RK_OFFSET ^ (a)},${a})`);
    } else if (rkVariant === 2) {
      const shift = Math.floor(rng() * 3) + 1;
      L.push(`local ${rkThreshVar}=${RK_OFFSET >> shift}*${1 << shift}`);
    } else if (rkVariant === 3) {
      const rndMul = 1 + Math.floor(rng() * 100);
      L.push(`local ${rkThreshVar}=${n.bBand}(${RK_OFFSET + rndMul * 0x200},${0x1FF})`);
    } else if (rkVariant === 4) {
      const m = [2, 4, 8, 16, 32, 64][Math.floor(rng() * 6)];
      L.push(`local ${rkThreshVar}=${RK_OFFSET / m}*${m}`);
    } else {
      L.push(`local ${rkThreshVar}=${n.bBand}(${RK_OFFSET | (Math.floor(rng() * 256) << 16)},0xFFFF)`);
    }
    L.push(`local ${rkSubVar}=${rkThreshVar}-1`);
    L.push(`local function ${n.RK}(x) if x>=${rkThreshVar} then return ${n.K}[x-${rkSubVar}] else return ${n.R}[x+1] end end`);
  } else {
    L.push(`local function ${n.RK}(x) if x>=${RK_OFFSET} then return ${n.K}[x-${RK_OFFSET - 1}] else return ${n.R}[x+1] end end`);
  }

  const bodies = buildHandlerBodies(n, ctx, ctx.usedOps);

  if (rkThreshVar) {
    const hotRawOps: number[] = [
      RegOp.ADD as number, RegOp.SUB as number, RegOp.MUL as number,
      RegOp.DIV as number, RegOp.MOD as number, RegOp.POW as number,
      RegOp.IDIV as number,
    ];
    const hotShuffled = new Set(hotRawOps.map(op => ctx.opcodeEncode[op]));
    const rkEsc = n.RK.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rkRe = new RegExp(rkEsc + '\\(([A-Z])\\)', 'g');
    for (const [sOp, body] of bodies) {
      if (hotShuffled.has(sOp)) {
        const inlined = body.replace(rkRe, (_m, v) =>
          `(${v}>=${rkThreshVar} and ${n.K}[${v}-${rkSubVar}] or ${n.R}[${v}+1])`);
        if (inlined !== body) bodies.set(sOp, inlined);
      }
    }
  }

  if (ctx.debugTrace) {
    const entries = REG_OP_NAMES.map((name, realOp) => {
      const shuffled = ctx.opcodeEncode[realOp];
      return `[${shuffled}]="${name}"`;
    }).join(",");
    L.push(`local _opNames={${entries}}`);
  }

  const doMut = ctx.level !== "debug";
  const mtVar = doMut ? randomName(3) : "";
  const mutStep = doMut ? (1 + Math.floor(rng() * 254)) : 0;
  const mutMul = doMut ? (1 + Math.floor(rng() * 126)) * 2 + 1 : 1;
  if (doMut) {
    L.push(`local ${mtVar}={}`);
  }

  if (doMut) {

    const opqVar = randomName(3);
    const opqA = 2 + Math.floor(rng() * 100);
    const opqB = 2 + Math.floor(rng() * 100);
    const opqC = 2 + Math.floor(rng() * 100);

    const mbaV1 = randomName(2);
    const mbaV2 = randomName(2);
    const mbaV3 = randomName(2);
    const opqVariant = Math.floor(rng() * 16);

    if (opqVariant === 0) {

      L.push(`local ${mbaV1}=${n.bBand}(${opqA},${opqB})`);
      L.push(`local ${mbaV2}=${n.bBand}(${n.bBxor}(${opqA},0xFFFFFFFF),${opqB})`);
      L.push(`local ${opqVar}=${mbaV1}+${mbaV2}==${n.bBand}(${opqB},0xFFFFFFFF)`);
    } else if (opqVariant === 1) {

      L.push(`local ${mbaV1}=2*${n.bBand}(${opqA},${opqB})+${n.bBxor}(${opqA},${opqB})`);
      L.push(`local ${opqVar}=${mbaV1}==${opqA}+${opqB}`);
    } else if (opqVariant === 2) {

      L.push(`local ${mbaV1}=${n.bBxor}(${n.bBxor}(${opqA},${opqB}),${opqB})`);
      L.push(`local ${mbaV2}=${n.bBxor}(${n.bBxor}(${mbaV1},${opqC}),${opqC})`);
      L.push(`local ${opqVar}=${mbaV2}==${n.bBand}(${opqA},0xFFFFFFFF)`);
    } else if (opqVariant === 3) {

      L.push(`local ${mbaV1}=${n.bBxor}(${n.bBxor}(${opqA},0xFFFFFFFF),0xFFFFFFFF)`);
      L.push(`local ${mbaV2}=${n.bBand}(${n.bBxor}(${mbaV1},${opqB}),${n.bBxor}(${mbaV1},${opqB}))`);
      L.push(`local ${opqVar}=${mbaV2}==${n.bBxor}(${opqA},${opqB})`);
    } else if (opqVariant === 4) {

      L.push(`local ${mbaV1}=2*${n.bBand}(${opqA},${opqB})+${n.bBxor}(${opqA},${opqB})`);
      L.push(`local ${mbaV2}=${n.bBxor}(${n.bBxor}(${n.bBand}(${mbaV1},0xFFFF),${opqC}),${opqC})`);
      L.push(`local ${opqVar}=${mbaV2}==${n.bBand}(${opqA}+${opqB},0xFFFF)`);
    } else if (opqVariant === 5) {

      L.push(`local ${mbaV1}=${n.bBxor}(${n.bBand}(${n.bBxor}(${opqA},0xFFFFFFFF),${n.bBxor}(${opqB},0xFFFFFFFF)),0xFFFFFFFF)`);
      L.push(`local ${mbaV2}=${n.bBxor}(${opqA},${n.bBand}(${n.bBxor}(${opqA},0xFFFFFFFF),${opqB}))`);
      L.push(`local ${opqVar}=${mbaV1}==${mbaV2}`);
    } else if (opqVariant === 6) {

      L.push(`local ${mbaV1}=${n.bBxor}(${opqA},${opqB})`);
      L.push(`local ${mbaV2}=${n.bBand}(${mbaV1},${mbaV1})`);
      L.push(`local ${mbaV3}=2*${n.bBand}(${mbaV2},${opqC})+${n.bBxor}(${mbaV2},${opqC})`);
      L.push(`local ${opqVar}=${mbaV3}==${mbaV1}+${opqC}`);
    } else if (opqVariant === 7) {

      L.push(`local ${mbaV1}=${n.bBxor}(${opqA},${n.bBand}(${opqA},${opqB}))`);
      L.push(`local ${mbaV2}=${n.bBand}(${opqA},${n.bBxor}(${opqB},0xFFFFFFFF))`);
      L.push(`local ${opqVar}=${mbaV1}==${mbaV2}`);
    } else if (opqVariant === 8) {

      L.push(`local ${mbaV1}=${n.bBand}(${opqA},${opqB})`);
      L.push(`local ${mbaV2}=${n.bBxor}(${opqA},${n.bBand}(${n.bBxor}(${opqA},0xFFFFFFFF),${mbaV1}))`);
      L.push(`local ${opqVar}=${mbaV2}==${n.bBand}(${opqA},0xFFFFFFFF)`);
    } else if (opqVariant === 9) {

      L.push(`local ${mbaV1}=2*${n.bBand}(${opqA},${opqB})+${n.bBxor}(${opqA},${opqB})`);
      L.push(`local ${mbaV2}=2*${n.bBand}(${mbaV1},${opqC})+${n.bBxor}(${mbaV1},${opqC})`);
      L.push(`local ${opqVar}=${n.bBand}(${mbaV2},0xFFFF)==${n.bBand}(${opqA}+${opqB}+${opqC},0xFFFF)`);
    } else if (opqVariant === 10) {

      L.push(`local ${mbaV1}=${n.bBxor}(${opqA},${opqB})`);
      L.push(`local ${mbaV2}=${opqA}+${opqB}-2*${n.bBand}(${opqA},${opqB})`);
      L.push(`local ${opqVar}=${n.bBand}(${mbaV1},0xFFFF)==${n.bBand}(${mbaV2},0xFFFF)`);
    } else if (opqVariant === 11) {

      L.push(`local ${mbaV1}=${n.bBand}(${opqA},${opqB})`);
      L.push(`local ${mbaV2}=${n.bBand}(${mbaV1},${opqC})`);
      L.push(`local ${mbaV3}=${n.bBand}(${opqA},${n.bBand}(${opqB},${opqC}))`);
      L.push(`local ${opqVar}=${mbaV2}==${mbaV3}`);
    } else if (opqVariant === 12) {

      L.push(`local ${mbaV1}=${n.bBand}(${n.bBxor}(${opqA},${opqB}),${opqA})`);
      L.push(`local ${mbaV2}=${n.bBand}(${opqA},${n.bBxor}(${opqB},0xFFFFFFFF))`);
      L.push(`local ${mbaV3}=2*${n.bBand}(${mbaV1},${opqC})+${n.bBxor}(${mbaV1},${opqC})`);
      L.push(`local ${opqVar}=${mbaV3}==2*${n.bBand}(${mbaV2},${opqC})+${n.bBxor}(${mbaV2},${opqC})`);
    } else if (opqVariant === 13) {

      L.push(`local ${mbaV1}=${n.bBxor}(${n.bBxor}(${opqA},${opqB}),${opqC})`);
      L.push(`local ${mbaV2}=${n.bBxor}(${n.bBxor}(${mbaV1},${opqC}),${opqB})`);
      L.push(`local ${opqVar}=${mbaV2}==${n.bBand}(${opqA},0xFFFFFFFF)`);
    } else if (opqVariant === 14) {

      L.push(`local ${mbaV1}=${n.bBand}(${opqA},${n.bBxor}(${opqB},${opqC}))`);
      L.push(`local ${mbaV2}=${n.bBxor}(${n.bBand}(${opqA},${opqB}),${n.bBand}(${opqA},${opqC}))`);
      L.push(`local ${opqVar}=${mbaV1}==${mbaV2}`);
    } else {

      L.push(`local ${mbaV1}=${n.bBand}(${opqA},${opqB})+${n.bBand}(${n.bBxor}(${opqA},0xFFFFFFFF),${opqB})`);
      L.push(`local ${mbaV2}=${n.bBand}(${opqA},${n.bBxor}(${opqB},0xFFFFFFFF))+${n.bBand}(${n.bBxor}(${opqA},0xFFFFFFFF),${n.bBxor}(${opqB},0xFFFFFFFF))`);
      L.push(`local ${opqVar}=${mbaV1}+${mbaV2}==0xFFFFFFFF`);
    }

    L.push(`if not ${opqVar} then ${n.R}={};${n.code}={};${n.ip}=#${n.code}+1 end`);
  }
  const preWhileIdx = L.length;
  L.push(`while ${n.ip}<=#${n.code} do`);

  const useRot = ctx.rotSeed > 0;
  const opVar = randomName(2);

  if (doMut) {

    const mkVar = randomName(2);
    L.push(`local ${mkVar}=${mtVar}[${n.ip}] or 0`);
    if (useRot) {
      const rkVar = randomName(3);

      L.push(`local ${rkVar}=${n.bBand}(${ctx.rotSeed}+${n.ip}*${ctx.rotStep}+${n.ip}*${n.ip}*${ctx.rotStep2},0xFF)`);
      L.push(`local ${opVar}=${n.bBxor}(${n.code}[${n.ip}],${rkVar},${mkVar})`);
    } else {
      L.push(`local ${opVar}=${n.bBxor}(${n.code}[${n.ip}],${mkVar})`);
    }

    L.push(`local ${n.s1}=${n.code}[${n.ip}+1]`);
    L.push(`local ${n.s2}=${n.code}[${n.ip}+2]`);
    L.push(`local ${n.s3}=${n.code}[${n.ip}+3]`);

    const nkVar = randomName(2);
    const xkVar = randomName(2);
    L.push(`local ${nkVar}=${n.bBand}(${mkVar}*${mutMul}+${opVar}+${mutStep},0xFF)`);
    L.push(`local ${xkVar}=${n.bBxor}(${mkVar},${nkVar})`);
    L.push(`${n.code}[${n.ip}]=${n.bBxor}(${n.code}[${n.ip}],${xkVar})`);
    L.push(`${mtVar}[${n.ip}]=${nkVar}`);
  } else {

    if (useRot) {
      const rkVar = randomName(3);
      L.push(`local ${rkVar}=${n.bBand}(${ctx.rotSeed}+${n.ip}*${ctx.rotStep}+${n.ip}*${n.ip}*${ctx.rotStep2},0xFF)`);
      L.push(`local ${opVar}=${n.bBxor}(${n.code}[${n.ip}],${rkVar})`);
    } else {
      L.push(`local ${opVar}=${n.code}[${n.ip}]`);
    }
    L.push(`local ${n.s1}=${n.code}[${n.ip}+1]`);
    L.push(`local ${n.s2}=${n.code}[${n.ip}+2]`);
    L.push(`local ${n.s3}=${n.code}[${n.ip}+3]`);
  }

  L.push(`${n.ip}=${n.ip}+4`);

  if (doMut) {
    L.push(`if ${n.ip}%${60000 + Math.floor(rng() * 40001)}<4 and ${nTwVm} then ${nTwVm}() end`);
  }

  if (doMut && process.env.NO_SEC !== '1') {
    const secInterval = 500 + Math.floor(rng() * 1500);
    const secVar = randomName(3);
    const secCheckVariant = Math.floor(rng() * 3);

    if (secCheckVariant === 0 || secCheckVariant === 1) {

      L.push(`if ${n.ip}%${secInterval * 4}<4 then local ${secVar}=${n.bPcall}(function() return ${n.env}["game"] end);if ${secVar} and ${n.bType}(${n.env}["game"])~="userdata" then ${n.R}=${n.bTcreate}(0);${n.ip}=#${n.code}+1 end end`);
    } else {

      L.push(`if ${n.ip}%${secInterval * 4}<4 then local ${secVar},_sv=${n.bPcall}(function() return ${n.env}["game"]["Workspace"] end);if not ${secVar} then ${n.R}=${n.bTcreate}(0);${n.ip}=#${n.code}+1 end end`);
    }
  }

  if (ctx.debugTrace) {
    L.push(`print("[VM] ip="..(${n.ip}-4).." "..((_opNames and _opNames[${opVar}]) or "OP"..${opVar}).." s1="..tostring(${n.s1}).." s2="..tostring(${n.s2}).." s3="..tostring(${n.s3}))`);
  }

  const sortedOps = Array.from(bodies.keys()).sort((a, b) => a - b);
  const validOps = sortedOps.filter(sOp => {
    const body = bodies.get(sOp)!;
    return body.trim() !== '';
  });

  const dv = ctx.dispatchVariant;

  if (dv === 0) {

    let isFirst = true;
    for (const sOp of validOps) {
      const body = bodies.get(sOp)!;
      const prefix = isFirst ? 'if' : 'elseif';
      L.push(`${prefix} ${opVar}==${sOp} then ${body}`);
      isFirst = false;
    }
    if (!isFirst) L.push(`end`);

  } else if (dv === 1) {

    const mask = ctx.dispatchMask;
    const mVar = randomName(3);
    L.push(`local ${mVar}=${n.bBxor}(${opVar},${mask})`);

    const shuffled = [...validOps];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    let isFirst = true;
    for (const sOp of shuffled) {
      const body = bodies.get(sOp)!;
      const maskedOp = sOp ^ mask;
      const prefix = isFirst ? 'if' : 'elseif';
      L.push(`${prefix} ${mVar}==${maskedOp} then ${body}`);
      isFirst = false;
    }
    if (!isFirst) L.push(`end`);

  } else if (dv === 2) {

    const emitBinaryTree = (ops: number[], depth: number) => {
      if (ops.length === 0) return;
      if (ops.length <= 3 || depth >= 4) {

        let isF = true;
        for (const sOp of ops) {
          const body = bodies.get(sOp)!;
          const pre = isF ? 'if' : 'elseif';
          L.push(`${pre} ${opVar}==${sOp} then ${body}`);
          isF = false;
        }
        if (!isF) L.push(`end`);
        return;
      }

      const splitIdx = Math.max(1, Math.min(ops.length - 1,
        Math.floor(ops.length * (0.3 + rng() * 0.4))));
      const left = ops.slice(0, splitIdx);
      const right = ops.slice(splitIdx);
      const pivot = right[0];
      L.push(`if ${opVar}<${pivot} then`);
      emitBinaryTree(left, depth + 1);
      L.push(`else`);
      emitBinaryTree(right, depth + 1);
      L.push(`end`);
    };
    emitBinaryTree(validOps, 0);

  } else if (dv === 3) {

    const nGroups = 3 + Math.floor(rng() * 3);
    const mask = ctx.dispatchMask;

    const groups: Map<number, number[]> = new Map();
    for (const sOp of validOps) {
      const g = (sOp ^ mask) % nGroups;
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g)!.push(sOp);
    }
    const gVar = randomName(3);
    L.push(`local ${gVar}=${n.bBxor}(${opVar},${mask})%${nGroups}`);

    const gKeys = [...groups.keys()];
    for (let i = gKeys.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [gKeys[i], gKeys[j]] = [gKeys[j], gKeys[i]];
    }
    let isFirstG = true;
    for (const gIdx of gKeys) {
      const gOps = groups.get(gIdx)!;
      const prefG = isFirstG ? 'if' : 'elseif';
      L.push(`${prefG} ${gVar}==${gIdx} then`);

      const innerOps = [...gOps];
      for (let i = innerOps.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [innerOps[i], innerOps[j]] = [innerOps[j], innerOps[i]];
      }
      let isF = true;
      for (const sOp of innerOps) {
        const body = bodies.get(sOp)!;
        const pre = isF ? 'if' : 'elseif';
        L.push(`${pre} ${opVar}==${sOp} then ${body}`);
        isF = false;
      }
      if (!isF) L.push(`end`);
      isFirstG = false;
    }
    if (!isFirstG) L.push(`end`);

  } else if (dv === 4 || dv === 5) {

    const hTbl = n.handlers;
    const retOp = ctx.opcodeEncode[RegOp.RETURN as number];
    const tcOp = ctx.opcodeEncode[RegOp.TAILCALL as number];

    const mandatoryFast = [
      RegOp.JMP as number, RegOp.FORLOOP as number, RegOp.CALL as number,
      RegOp.MOVE as number, RegOp.FORPREP as number,
    ].map(op => ctx.opcodeEncode[op]);

    const optCandidates = [
      RegOp.LOADK as number, RegOp.GETGLOBAL as number,
      RegOp.GETTABLE as number, RegOp.LOADBOOL as number,
      RegOp.SETTABLE as number, RegOp.LOADNIL as number,
    ];
    const shuffledCands = [...optCandidates];
    for (let i = shuffledCands.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [shuffledCands[i], shuffledCands[j]] = [shuffledCands[j], shuffledCands[i]];
    }
    const nFast = 2 + Math.floor(rng() * 2);
    const fastSet = new Set([
      ...mandatoryFast,
      ...shuffledCands.slice(0, nFast).map(op => ctx.opcodeEncode[op]),
    ]);

    const inlineOps = new Set([retOp, tcOp, ...fastSet]);
    const tableOps = validOps.filter(sOp => !inlineOps.has(sOp));

    for (let i = tableOps.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [tableOps[i], tableOps[j]] = [tableOps[j], tableOps[i]];
    }

    const tblMask = dv === 5 ? ctx.dispatchMask : 0;

    void tblMask;

    const fastArr = [...fastSet];
    for (let i = fastArr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [fastArr[i], fastArr[j]] = [fastArr[j], fastArr[i]];
    }

    let isFirst = true;
    for (const fOp of fastArr) {
      const body = bodies.get(fOp);
      if (!body || body.trim() === '') continue;
      const prefix = isFirst ? 'if' : 'elseif';
      L.push(`${prefix} ${opVar}==${fOp} then ${body}`);
      isFirst = false;
    }

    const hVar = randomName(2);
    void hVar;

    for (const sOp of tableOps) {
      const body = bodies.get(sOp)!;
      if (body.trim() === '') continue;
      const cmpVal = sOp ^ tblMask;
      const cmpExpr = tblMask
        ? `${n.bBxor}(${opVar},${tblMask})==${cmpVal}`
        : `${opVar}==${sOp}`;
      const prefix = isFirst ? 'if' : 'elseif';
      L.push(`${prefix} ${cmpExpr} then ${body}`);
      isFirst = false;
    }

    L.push(`elseif ${opVar}==${retOp} then ${bodies.get(retOp) || ''}`);
    L.push(`elseif ${opVar}==${tcOp} then ${bodies.get(tcOp) || ''}`);
    L.push(`end`);
  }

  L.push(`end`);

  L.push(`end`);

  return L.join("\n");
}

const CORE_GLOBALS = [

  "print","warn","error","assert","type","typeof","tostring","tonumber",
  "pcall","xpcall","select","unpack","pairs","ipairs","next",
  "rawget","rawset","rawequal","rawlen","setmetatable","getmetatable",
  "collectgarbage","dofile","gcinfo",

  "string","table","math","bit32","coroutine","os","debug","utf8","buffer",

  "game","workspace","script","Instance","Enum",

  "Vector3","Vector2","CFrame","Color3","BrickColor",
  "UDim","UDim2","Ray","Region3","Rect","TweenInfo",
  "NumberSequence","ColorSequence","NumberRange",
  "NumberSequenceKeypoint","ColorSequenceKeypoint",
  "PhysicalProperties","Axes","Faces","PathWaypoint",
  "Random","DateTime","RaycastParams","OverlapParams",
  "Font","FloatCurveKey","RotationCurveKey",

  "tick","time","wait","task","spawn","delay",

  "require","loadstring","load","getfenv","setfenv","newproxy",

  "_G","shared","settings","stats","UserSettings","version",
];

const EXECUTOR_GLOBALS = [

  "getgenv","getrenv","getsenv","getrawmetatable","setrawmetatable",

  "hookfunction","hookfunc","hookmetamethod","newcclosure",
  "clonefunction","cloneref","compareinstances",

  "iscclosure","islclosure","isexecutorclosure","checkclosure","isourclosure",
  "checkcaller",

  "getconnections","firesignal","fireclickdetector","fireproximityprompt","firetouchinterest",

  "getgc","getinstances","getnilinstances","getscripts","getrunningscripts",
  "getloadedmodules","getcallingscript","getactors",

  "getscriptbytecode","dumpstring","getscripthash","getscriptclosure","decompile",

  "readfile","writefile","appendfile","loadfile","listfiles",
  "isfile","isfolder","makefolder","delfolder","delfile",

  "setclipboard","toclipboard","getclipboard","setrbxclipboard",

  "queue_on_teleport","queueonteleport",

  "setthreadidentity","getthreadidentity",
  "setidentity","getidentity","setthreadcontext","getthreadcontext",

  "getnamecallmethod","setnamecallmethod",

  "isreadonly","setreadonly",

  "gethiddenproperty","sethiddenproperty","isscriptable","setscriptable",

  "identifyexecutor","getexecutorname",

  "request","http_request","syn","http","WebSocket",

  "cache",

  "Drawing","cleardrawcache","isrenderobj",

  "crypt","base64",

  "lz4compress","lz4decompress",

  "mouse1click","mouse1press","mouse1release",
  "mouse2click","mouse2press","mouse2release",
  "mousemoveabs","mousemoverel","mousescroll",

  "gethui","getcustomasset","getcallbackvalue","messagebox",
  "isrbxactive","isgameactive","setfpscap",

  "getregistry","getreg","getstack",

  "rconsoleclear","rconsolecreate","rconsoledestroy",
  "rconsoleinput","rconsoleprint","rconsolesettitle","rconsolename",
  "consoleclear","consolecreate","consoledestroy",
  "consoleinput","consoleprint","consolesettitle",

  "run_on_actor","runonactor",

  "getstack",
];

function buildEnvSetup(ctx: BuildCtx): string {
  const n = ctx.names;
  const L: string[] = [];

  if (ctx.level === "debug") {
    L.push(`local ${n.genv}=(type(getfenv)=="function" and getfenv(0)) or _G`);
    const entries = CORE_GLOBALS.map(g => `${g}=${g}`).join(",");
    L.push(`local ${n.env}=setmetatable({${entries}},{__index=function(_,k) local ok,v=pcall(function() return ${n.genv}[k] end);if ok then return v end;return nil end})`);
    if (ctx.includeExecutor) {
      for (const g of EXECUTOR_GLOBALS) {
        L.push(`do local ok,v=pcall(function() return ${n.genv}["${g}"] end);if ok and v~=nil then ${n.env}["${g}"]=v end end`);
      }
    }
    return L.join("\n") + "\n";
  }

  const envKey = 1 + Math.floor(rng() * 254);
  const envStep = 1 + Math.floor(rng() * 254);

  const encS = (s: string): string => {
    const bytes = Array.from(s).map((c, i) =>
      c.charCodeAt(0) ^ ((envKey + i * envStep) & 0xFF));
    return `{${bytes.join(",")}}`;
  };

  const dec = randomName(4);
  L.push(`local function ${dec}(_t) local _s="";for _i=1,#_t do _s=_s..string.char(${n.bBxor}(_t[_i],${n.bBand}(${envKey}+(_i-1)*${envStep},0xFF))) end;return _s end`);

  L.push(`local ${n.genv}=loadstring(${dec}(${encS("return (type(getfenv)=='function' and getfenv(0)) or _G")}))()`);

  L.push(`local ${n.env}=${n.bSetmeta}({},{[${dec}(${encS("__index")})]=function(_,k) local ok,v=${n.bPcall}(function() return ${n.genv}[k] end);if ok then return v end;return nil end})`);

  const allGlobals = ctx.includeExecutor ? [...CORE_GLOBALS, ...EXECUTOR_GLOBALS] : [...CORE_GLOBALS];

  for (let si = allGlobals.length - 1; si > 0; si--) {
    const sj = Math.floor(rng() * (si + 1));
    [allGlobals[si], allGlobals[sj]] = [allGlobals[sj], allGlobals[si]];
  }
  const namesTable = randomName(3);
  L.push(`local ${namesTable}={${allGlobals.map(g => encS(g)).join(",")}}`);

  const iV = randomName(2);
  const nV = randomName(2);
  L.push(`for ${iV}=1,#${namesTable} do local ${nV}=${dec}(${namesTable}[${iV}]);local ok,v=${n.bPcall}(function() return ${n.genv}[${nV}] end);if ok and v~=nil then ${n.env}[${nV}]=v end end`);

  L.push(`do local _u=${dec}(${encS("unpack")});if not ${n.env}[_u] then local _t=${n.env}[${dec}(${encS("table")})];if _t then ${n.env}[_u]=_t[_u] end end end`);
  L.push(`do local _ls=${dec}(${encS("loadstring")});if not ${n.env}[_ls] then ${n.env}[_ls]=${n.env}[${dec}(${encS("load")})] end end`);

  return L.join("\n") + "\n";
}

function buildEnvFragments(ctx: BuildCtx): { fragments: Fragment[]; forwardDecls: string[] } {
  const n = ctx.names;
  const fragments: Fragment[] = [];
  const forwardDecls: string[] = [];

  const envKey = 1 + Math.floor(rng() * 254);
  const envStep = 1 + Math.floor(rng() * 254);

  const encS = (s: string): string => {
    const bytes = Array.from(s).map((c, i) =>
      c.charCodeAt(0) ^ ((envKey + i * envStep) & 0xFF));
    return `{${bytes.join(",")}}`;
  };

  const dec = randomName(4);
  forwardDecls.push(dec, n.genv, n.env);

  fragments.push({ code: `${dec}=function(_t) local _s="";for _i=1,#_t do _s=_s..string.char(${n.bBxor}(_t[_i],${n.bBand}(${envKey}+(_i-1)*${envStep},0xFF))) end;return _s end`, layer: 0 });
  fragments.push({ code: `${n.genv}=loadstring(${dec}(${encS("return (type(getfenv)=='function' and getfenv(0)) or _G")}))()`, layer: 1 });
  fragments.push({ code: `${n.env}=${n.bSetmeta}({},{[${dec}(${encS("__index")})]=function(_,k) local ok,v=${n.bPcall}(function() return ${n.genv}[k] end);if ok then return v end;return nil end})`, layer: 2 });

  const allGlobals = ctx.includeExecutor ? [...CORE_GLOBALS, ...EXECUTOR_GLOBALS] : [...CORE_GLOBALS];
  for (let si = allGlobals.length - 1; si > 0; si--) {
    const sj = Math.floor(rng() * (si + 1));
    [allGlobals[si], allGlobals[sj]] = [allGlobals[sj], allGlobals[si]];
  }
  const batchCount = 2 + Math.floor(rng() * 3);
  const batchSize = Math.ceil(allGlobals.length / batchCount);
  for (let b = 0; b < batchCount; b++) {
    const batch = allGlobals.slice(b * batchSize, (b + 1) * batchSize);
    if (batch.length === 0) continue;
    const nt = randomName(3);
    forwardDecls.push(nt);
    fragments.push({ code: `${nt}={${batch.map(g => encS(g)).join(",")}}`, layer: 0 });
    const iV = randomName(2);
    const nV = randomName(2);
    fragments.push({ code: `for ${iV}=1,#${nt} do local ${nV}=${dec}(${nt}[${iV}]);local ok,v=${n.bPcall}(function() return ${n.genv}[${nV}] end);if ok and v~=nil then ${n.env}[${nV}]=v end end`, layer: 3 });
  }

  fragments.push({ code: `do local _u=${dec}(${encS("unpack")});if not ${n.env}[_u] then local _t=${n.env}[${dec}(${encS("table")})];if _t then ${n.env}[_u]=_t[_u] end end end`, layer: 3 });
  fragments.push({ code: `do local _ls=${dec}(${encS("loadstring")});if not ${n.env}[_ls] then ${n.env}[_ls]=${n.env}[${dec}(${encS("load")})] end end`, layer: 3 });

  if (process.env.DEBUG_VM === '1') {
    const critGlobals = ["string","table","math","pcall","type","tostring","pairs","ipairs","next","rawget","setmetatable","getmetatable","bit32","select","xpcall","loadstring","error","warn","print","game","workspace"];
    const checks = critGlobals.map(g => `if ${n.env}[${dec}(${encS(g)})]==nil then _m[#_m+1]="${g}" end`).join(";");
    fragments.push({ code: `do local _m={};${checks};if #_m>0 then warn("[ENV_MISSING] "..table.concat(_m,",")) else warn("[ENV_OK] all globals loaded") end end`, layer: 3 });
    fragments.push({ code: `warn("[DBG_GENV] genv="..tostring(${n.genv}).." type="..type(${n.genv}))`, layer: 3 });
  }

  return { fragments, forwardDecls };
}

function buildDecoderChain(
  ctx: BuildCtx,
  dK: string, dP: string,
): { fragments: Fragment[]; forwardDecls: string[]; chainCalls: string } {
  const pk = ctx.protoKeys;
  const V = ctx.layerVariants;
  const fragments: Fragment[] = [];
  const forwardDecls: string[] = [];

  const nPre = randomName(6);
  const n5 = randomName(6);
  const n4 = randomName(6);
  const n3 = randomName(6);
  const n2 = randomName(6);
  const n1 = randomName(6);
  const nF = randomName(6);
  const nAll = randomName(6);
  const nProtos = randomName(6);
  forwardDecls.push(nPre, n5, n4, n3, n2, n1, nF, nAll, nProtos);

  const wrapA = (name: string, inner: string) =>
    `${name}=function(_0K) for _0i,_0v in ipairs(_0K) do if type(_0v)=="table" then ${inner} end end end`;

  const SP = ctx.spiralPrime, SO = ctx.spiralOffset;
  if (V[4] === 2) {
    const lutName = randomName(4);
    forwardDecls.push(lutName);
    fragments.push({ code: `${lutName}={};for _0k=0,511 do ${lutName}[_0k]=(_0k*${SP}+${SO})%251 end`, layer: 0 });
    fragments.push({ code: wrapA(n5, `local _0s=bit32.band(_0i-1,0xFF);for _0j=1,#_0v do _0v[_0j]=bit32.bxor(_0v[_0j],(${lutName}[(_0j-1)%512]+_0s)%251) end`), layer: 1 });
  } else if (V[4] === 1) {
    fragments.push({ code: wrapA(n5, `local _0s=bit32.band(_0i-1,0xFF);local _0a=${SO}+_0s;for _0j=1,#_0v do _0v[_0j]=bit32.bxor(_0v[_0j],_0a%251);_0a=_0a+${SP} end`), layer: 0 });
  } else {
    fragments.push({ code: wrapA(n5, `local _0s=bit32.band(_0i-1,0xFF);for _0j=1,#_0v do _0v[_0j]=bit32.bxor(_0v[_0j],((_0j-1)*${SP}+${SO}+_0s)%251) end`), layer: 0 });
  }

  const KA = ctx.checkKeyA, KB = ctx.checkKeyB, SA = ctx.checkStepA, SB = ctx.checkStepB;
  const checkBodies = [
    `local _0s=bit32.band(_0i-1,0xFF);for _0j=1,#_0v do local _0h=math.floor((_0j-1)/2);local _0k;if (_0j-1)%2==0 then _0k=bit32.band(${KA}+_0s+_0h*${SA},0xFF) else _0k=bit32.band(${KB}+_0s+_0h*${SB},0xFF) end;_0v[_0j]=bit32.bxor(_0v[_0j],_0k) end`,
    `local _0s=bit32.band(_0i-1,0xFF);local _0n=#_0v;for _0j=1,_0n,2 do _0v[_0j]=bit32.bxor(_0v[_0j],bit32.band(${KA}+_0s+math.floor((_0j-1)/2)*${SA},0xFF)) end;for _0j=2,_0n,2 do _0v[_0j]=bit32.bxor(_0v[_0j],bit32.band(${KB}+_0s+math.floor((_0j-1)/2)*${SB},0xFF)) end`,
    `local _0s=bit32.band(_0i-1,0xFF);local _0ea,_0eb=${KA}+_0s,${KB}+_0s;for _0j=1,#_0v do if (_0j-1)%2==0 then _0v[_0j]=bit32.bxor(_0v[_0j],bit32.band(_0ea,0xFF));_0ea=_0ea+${SA} else _0v[_0j]=bit32.bxor(_0v[_0j],bit32.band(_0eb,0xFF));_0eb=_0eb+${SB} end end`,
  ];
  fragments.push({ code: wrapA(n4, checkBodies[V[3]]), layer: 0 });

  const CM = ctx.cascadeMul, CK = ctx.cascadeKey;
  const cascBodies = [
    `local _0s=bit32.band(_0i-1,0xFF);for _0j=2,#_0v do _0v[_0j]=bit32.bxor(_0v[_0j],bit32.band(_0v[_0j-1]*${CM}+${CK}+_0s,0xFF)) end`,
    `local _0s=bit32.band(_0i-1,0xFF);local _0p=_0v[1];for _0j=2,#_0v do local _0k=bit32.band(_0p*${CM}+${CK}+_0s,0xFF);_0v[_0j]=bit32.bxor(_0v[_0j],_0k);_0p=_0v[_0j] end`,
  ];
  fragments.push({ code: wrapA(n3, cascBodies[V[2] % 2]), layer: 0 });

  const HS = ctx.helixSeed, HM = ctx.helixMul;
  if (V[1] === 2) {
    const tblName = randomName(4);
    fragments.push({ code: wrapA(n2, `local _0s=bit32.band(_0i-1,0xFF);local ${tblName}={};for _0k=1,#_0v do ${tblName}[_0k]=bit32.band(${HS}+_0s+(_0k-1)*${HM},0xFF) end;for _0j=1,#_0v do _0v[_0j]=bit32.band(_0v[_0j]-${tblName}[_0j]+256,0xFF) end`), layer: 0 });
  } else if (V[1] === 1) {
    fragments.push({ code: wrapA(n2, `local _0s=bit32.band(_0i-1,0xFF);local _0a=${HS}+_0s;for _0j=1,#_0v do _0v[_0j]=bit32.band(_0v[_0j]-bit32.band(_0a,0xFF)+256,0xFF);_0a=_0a+${HM} end`), layer: 0 });
  } else {
    fragments.push({ code: wrapA(n2, `local _0s=bit32.band(_0i-1,0xFF);for _0j=1,#_0v do _0v[_0j]=bit32.band(_0v[_0j]-bit32.band(${HS}+_0s+(_0j-1)*${HM},0xFF)+256,0xFF) end`), layer: 0 });
  }

  const inv = ctx.sboxInverse;
  if (V[0] === 0) {

    fragments.push({ code: `${n1}=function(_0K) local _0inv={${inv.join(",")}} for _0i,_0v in ipairs(_0K) do if type(_0v)=="table" then local _0s=bit32.band(_0i-1,0xFF);for _0j=1,#_0v do _0v[_0j]=bit32.bxor(_0inv[_0v[_0j]+1],bit32.band(_0s+_0j-1,0xFF)) end end end end`, layer: 0 });
  } else if (V[0] === 1) {

    const nLo = randomName(3), nHi = randomName(3), nInv = randomName(3);
    forwardDecls.push(nLo, nHi, nInv);
    fragments.push({ code: `${nLo}={${inv.slice(0, 128).join(",")}}`, layer: 0 });
    fragments.push({ code: `${nHi}={${inv.slice(128).join(",")}}`, layer: 0 });
    fragments.push({ code: `${nInv}={};for _0k=1,128 do ${nInv}[_0k]=${nLo}[_0k] end;for _0k=1,128 do ${nInv}[128+_0k]=${nHi}[_0k] end`, layer: 1 });
    fragments.push({ code: `${n1}=function(_0K) for _0i,_0v in ipairs(_0K) do if type(_0v)=="table" then local _0s=bit32.band(_0i-1,0xFF);for _0j=1,#_0v do _0v[_0j]=bit32.bxor(${nInv}[_0v[_0j]+1],bit32.band(_0s+_0j-1,0xFF)) end end end end`, layer: 2 });
  } else {

    const chunks = [inv.slice(0, 64), inv.slice(64, 128), inv.slice(128, 192), inv.slice(192)];
    const order = [0, 1, 2, 3];
    for (let i = 3; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    const cNames = [randomName(3), randomName(3), randomName(3), randomName(3)];
    const nInv = randomName(3);
    forwardDecls.push(...cNames, nInv);
    for (const idx of order) {
      fragments.push({ code: `${cNames[idx]}={${chunks[idx].join(",")}}`, layer: 0 });
    }

    const sboxLutVar = Math.floor(rng() * 3);
    if (sboxLutVar === 0) {

      fragments.push({ code: `${nInv}={};for _0k=1,128 do if _0k<=64 then ${nInv}[_0k]=${cNames[0]}[_0k] else ${nInv}[_0k]=${cNames[1]}[_0k-64] end end;for _0k=1,128 do if _0k<=64 then ${nInv}[128+_0k]=${cNames[2]}[_0k] else ${nInv}[192+_0k-64]=${cNames[3]}[_0k-64] end end`, layer: 1 });
    } else if (sboxLutVar === 1) {

      const sTbl = randomName(2);
      fragments.push({ code: `${nInv}={};local ${sTbl}={${cNames.join(',')}};for _0k=0,255 do local _0ci=(_0k>=192 and 4) or (_0k>=128 and 3) or (_0k>=64 and 2) or 1;${nInv}[_0k+1]=${sTbl}[_0ci][_0k-(_0ci-1)*64+1] end`, layer: 1 });
    } else {

      fragments.push({ code: `${nInv}={};for _0k=1,64 do ${nInv}[_0k]=${cNames[0]}[_0k] end;for _0k=1,64 do ${nInv}[64+_0k]=${cNames[1]}[_0k] end;for _0k=1,64 do ${nInv}[128+_0k]=${cNames[2]}[_0k] end;for _0k=1,64 do ${nInv}[192+_0k]=${cNames[3]}[_0k] end`, layer: 1 });
    }
    fragments.push({ code: `${n1}=function(_0K) for _0i,_0v in ipairs(_0K) do if type(_0v)=="table" then local _0s=bit32.band(_0i-1,0xFF);for _0j=1,#_0v do _0v[_0j]=bit32.bxor(${nInv}[_0v[_0j]+1],bit32.band(_0s+_0j-1,0xFF)) end end end end`, layer: 2 });
  }

  fragments.push({ code: `${nPre}=function(_0K) for _0i=1,#_0K do if type(_0K[_0i])=="string" then local _0s=_0K[_0i];local _0t={};for _0j=1,#_0s do _0t[_0j]=string.byte(_0s,_0j) end;_0K[_0i]=_0t end end end`, layer: 0 });

  if (Math.floor(rng() * 2) === 0) {
    fragments.push({ code: wrapA(nF, `local _0s="";for _0j=1,#_0v do _0s=_0s..string.char(_0v[_0j]) end;_0K[_0i]=_0s`), layer: 0 });
  } else {
    fragments.push({ code: wrapA(nF, `local _0t={};for _0j=1,#_0v do _0t[_0j]=string.char(_0v[_0j]) end;_0K[_0i]=table.concat(_0t)`), layer: 0 });
  }

  const junkCount = 3 + Math.floor(rng() * 4);
  const junkTemplates = [
    (nm: string) => wrapA(nm, `for _0j=1,#_0v do _0v[_0j]=bit32.bxor(_0v[_0j],bit32.band(_0j*${1+Math.floor(rng()*200)}+${Math.floor(rng()*200)},0xFF)) end`),
    (nm: string) => wrapA(nm, `for _0j=2,#_0v do _0v[_0j]=bit32.band(_0v[_0j]+_0v[_0j-1]*${1+Math.floor(rng()*7)}+${Math.floor(rng()*200)},0xFF) end`),
    (nm: string) => wrapA(nm, `local _0a=${Math.floor(rng()*200)};for _0j=1,#_0v do _0v[_0j]=bit32.band(_0v[_0j]-bit32.band(_0a,0xFF)+256,0xFF);_0a=_0a+${1+Math.floor(rng()*30)} end`),
    (nm: string) => wrapA(nm, `for _0j=1,#_0v do _0v[_0j]=bit32.bxor(_0v[_0j],((_0j-1)*${SPIRAL_PRIMES[Math.floor(rng()*SPIRAL_PRIMES.length)]}+${Math.floor(rng()*200)})%251) end`),
  ];
  const junkNames: string[] = [];
  for (let i = 0; i < junkCount; i++) {
    const tpl = junkTemplates[Math.floor(rng() * junkTemplates.length)];
    const jn = randomName(6);
    junkNames.push(jn);
    forwardDecls.push(jn);
    fragments.push({ code: tpl(jn), layer: Math.floor(rng() * 3) });
  }

  const chainVariant = Math.floor(rng() * 3);
  if (chainVariant === 0) {

    const tblName = randomName(4);
    const ordName = randomName(4);
    forwardDecls.push(tblName, ordName);
    const realFns = [n5, n4, n3, n2, n1, nF];

    const allIndices: number[] = [];
    for (let i = 1; i <= realFns.length; i++) allIndices.push(i);
    for (let i = allIndices.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [allIndices[i], allIndices[j]] = [allIndices[j], allIndices[i]];
    }

    const entries: string[] = [];
    for (let i = 0; i < realFns.length; i++) entries.push(`[${allIndices[i]}]=${realFns[i]}`);
    for (let i = entries.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [entries[i], entries[j]] = [entries[j], entries[i]];
    }

    const execOrder = allIndices.slice();
    fragments.push({ code: `${tblName}={${entries.join(",")}}`, layer: 3 });
    fragments.push({ code: `${ordName}={${execOrder.join(",")}}`, layer: 3 });
    fragments.push({ code: `${nAll}=function(_0K) for _0oi=1,#${ordName} do ${tblName}[${ordName}[_0oi]](_0K) end end`, layer: 3 });
  } else if (chainVariant === 1) {

    const realFns = [n5, n4, n3, n2, n1, nF];
    const predicates = [
      `type("")=="string"`, `type(1)=="number"`, `select("#",1)==1`,
      `type({})=="table"`, `type(true)=="boolean"`, `1+1==2`,
    ];
    const predOrder = [...predicates];
    for (let i = predOrder.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [predOrder[i], predOrder[j]] = [predOrder[j], predOrder[i]];
    }
    const bodyParts: string[] = [];
    for (let i = 0; i < realFns.length; i++) {
      bodyParts.push(`if ${predOrder[i]} then ${realFns[i]}(_0K) end`);
    }
    fragments.push({ code: `${nAll}=function(_0K) ${bodyParts.join(";")} end`, layer: 3 });
  } else {

    const realFns = [n5, n4, n3, n2, n1, nF];
    fragments.push({ code: `${nAll}=function(_0K) ${realFns.map(fn => `${fn}(_0K)`).join(";")} end`, layer: 3 });
  }

  fragments.push({ code: `${nProtos}=function(_0ps) for _,_0p in ipairs(_0ps) do ${nPre}(_0p[1]);${nAll}(_0p[1]);if _0p[3] then ${nProtos}(_0p[3]) end end end`, layer: 4 });

  const chainCalls = `${nPre}(${dK})\n${nAll}(${dK})\n${nProtos}(${dP})`;

  return { fragments, forwardDecls, chainCalls };
}

function generateJunkFragments(fragments: Fragment[], forwardDecls: string[], n?: NameMap): void {
  const count = 5 + Math.floor(rng() * 6);

  const liveRefs = n ? [
    n.R, n.K, n.code, n.ip, n.run, n.env,
    n.bBxor, n.bBand, n.bType, n.tPack, n.bSelect, n.bMfloor,
    n.bPcall, n.bTostring, n.bRawget,
  ] : [];
  const liveRef = () => liveRefs[Math.floor(rng() * liveRefs.length)];

  for (let i = 0; i < count; i++) {
    const jn = randomName(4);
    forwardDecls.push(jn);
    const layer = Math.floor(rng() * 4);
    const jType = Math.floor(rng() * (n ? 9 : 5));
    switch (jType) {
      case 0:
        fragments.push({ code: `${jn}=${Math.floor(rng() * 0xFFFFFF)}`, layer });
        break;
      case 1: {
        const len = 3 + Math.floor(rng() * 8);
        const vals = Array.from({length: len}, () => Math.floor(rng() * 256));
        fragments.push({ code: `${jn}={${vals.join(",")}}`, layer });
        break;
      }
      case 2: {
        const ref = n ? liveRef() : '_K';
        const a = Math.floor(rng() * 200), b = 1 + Math.floor(rng() * 200);
        fragments.push({ code: `${jn}=function(${randomName(2)}) for _i,_v in ipairs(${ref} or {}) do if type(_v)=="table" then for _j=1,#_v do _v[_j]=bit32.bxor(_v[_j],bit32.band(_j*${b}+${a},0xFF)) end end end end`, layer });
        break;
      }
      case 3: {
        const x = Math.floor(rng() * 100), y = 1 + Math.floor(rng() * 50);
        fragments.push({ code: `do ${jn}=${x};for _=${1},${y} do ${jn}=bit32.band(${jn}*${1+Math.floor(rng()*7)}+${Math.floor(rng()*200)},0xFFFF) end end`, layer });
        break;
      }
      case 4:
        fragments.push({ code: `if type(${jn})~="number" then ${jn}=${Math.floor(rng() * 1000)} end`, layer });
        break;
      case 5: {
        const ref = liveRef();
        fragments.push({ code: `${jn}=${n!.bType}(${ref})`, layer });
        break;
      }
      case 6: {
        const ref = liveRef();
        fragments.push({ code: `${jn}=type(${ref})=="table" and #${ref} or 0`, layer });
        break;
      }
      case 7: {
        const ref = liveRef();
        fragments.push({ code: `${jn}=${n!.bSelect}(1,${ref},${Math.floor(rng()*1000)})`, layer });
        break;
      }
      case 8: {
        const ref = liveRef();
        const ref2 = liveRef();
        fragments.push({ code: `${jn}=${n!.bPcall}(function() return ${n!.bTostring}(${ref}) end) and ${n!.bType}(${ref2})`, layer });
        break;
      }
    }
  }
}

function lzssCompress(input: number[]): number[] {
  const out: number[] = [];
  const WIN = 16384;
  const MIN_MATCH = 4;
  const MAX_MATCH = 67;
  const MAX_LIT = 128;
  const HASH_SIZE = 1 << 16;
  const HASH_MASK = HASH_SIZE - 1;
  const head = new Int32Array(HASH_SIZE).fill(-1);
  const prev = new Int32Array(input.length).fill(-1);
  function hash3(pos: number): number {
    return ((input[pos] << 10) ^ (input[pos+1] << 5) ^ (input[pos+2] ?? 0)) & HASH_MASK;
  }

  let i = 0;
  let litBuf: number[] = [];

  const flushLiterals = () => {
    while (litBuf.length > 0) {
      const n = Math.min(litBuf.length, MAX_LIT);
      out.push(n - 1);
      for (let j = 0; j < n; j++) out.push(litBuf[j]);
      litBuf = litBuf.slice(n);
    }
  };

  while (i < input.length) {
    let bestLen = 0, bestOff = 0;
    if (i + MIN_MATCH <= input.length) {
      const h = hash3(i);
      let j = head[h];
      const limit = Math.max(0, i - WIN);
      let chain = 0;
      while (j >= limit && chain < 128) {
        let len = 0;
        while (len < MAX_MATCH && i + len < input.length && input[j + len] === input[i + len]) len++;
        if (len > bestLen) { bestLen = len; bestOff = i - j; }
        if (len === MAX_MATCH) break;
        j = prev[j];
        if (j < 0) break;
        chain++;
      }
      prev[i] = head[h];
      head[h] = i;
    }
    if (bestLen >= MIN_MATCH) {
      flushLiterals();
      if (bestOff <= 256) {

        out.push(0x80 | (bestLen - MIN_MATCH));
        out.push(bestOff - 1);
      } else {

        out.push(0xC0 | (bestLen - MIN_MATCH));
        out.push((bestOff >> 8) & 0xFF);
        out.push(bestOff & 0xFF);
      }
      for (let s = 1; s < bestLen && i + s + 2 < input.length; s++) {
        const sh = hash3(i + s);
        prev[i + s] = head[sh];
        head[sh] = i + s;
      }
      i += bestLen;
    } else {
      litBuf.push(input[i]);
      i++;
    }
  }
  flushLiterals();
  return out;
}

function rleCompress(input: number[]): number[] {
  const out: number[] = [];
  let i = 0;
  while (i < input.length) {
    const b = input[i];
    let run = 1;
    while (i + run < input.length && input[i + run] === b && run < 258) run++;
    if (run >= 4) {
      out.push(0xFF, run - 3, b);
      i += run;
    } else if (b === 0xFF) {
      out.push(0xFF, 0x00);
      i++;
    } else {
      out.push(b);
      i++;
    }
  }
  return out;
}

function verifyCipherRoundtrip(
  rawBytes: number[], bytes: number[], enc: number[],
  cInv: number[], cSeed: number, cStep: number,
  b64: string, alpha: string, padByte: number,
): void {

  const lut: Record<number, number> = {};
  for (let i = 0; i < 64; i++) lut[alpha.charCodeAt(i)] = i;
  lut[padByte] = 0;
  const decoded: number[] = [];
  for (let i = 0; i < b64.length; i += 4) {
    const p1 = b64.charCodeAt(i), p2 = b64.charCodeAt(i+1), p3 = b64.charCodeAt(i+2), p4 = b64.charCodeAt(i+3);
    const a = lut[p1], b = lut[p2], c = lut[p3], d = lut[p4];
    decoded.push(((a << 2) | (b >> 4)) & 0xFF);
    if (p3 !== padByte) decoded.push((((b << 4) | (c >> 2)) & 0xFF));
    if (p4 !== padByte) decoded.push((((c << 6) | d) & 0xFF));
  }

  const decrypted: number[] = [];
  for (let i = 0; i < decoded.length; i++) {
    decrypted.push(cInv[decoded[i]] ^ ((cSeed + i * cStep) & 0xFF));
  }

  if (decrypted.length !== bytes.length) {
    throw new Error(`[cipher-verify] Length mismatch: decoded ${decrypted.length} vs original ${bytes.length}`);
  }
  for (let i = 0; i < bytes.length; i++) {
    if (decrypted[i] !== bytes[i]) {
      throw new Error(`[cipher-verify] Byte mismatch at ${i}: decoded ${decrypted[i]} vs original ${bytes[i]}`);
    }
  }

  const flag = bytes[0];
  let rleOut: number[];
  if (flag === 0) {
    rleOut = bytes.slice(1);
  } else {
    rleOut = [];
    let rp = 1;
    while (rp < bytes.length) {
      const rb = bytes[rp];
      if (rb === 0xFF) {
        rp++;
        const rn = bytes[rp];
        if (rn === 0) { rleOut.push(0xFF); }
        else { rp++; const rv = bytes[rp]; for (let ri = 0; ri < rn + 3; ri++) rleOut.push(rv); }
      } else {
        rleOut.push(rb);
      }
      rp++;
    }
  }

  let finalBytes: number[];
  if (flag === 0) {
    finalBytes = rleOut;
  } else {
    finalBytes = [];
    let lp = 0;
    while (lp < rleOut.length) {
      const ct = rleOut[lp]; lp++;
      if (ct < 128) {
        const n = ct + 1;
        for (let j = 0; j < n; j++) { finalBytes.push(rleOut[lp]); lp++; }
      } else if (ct < 192) {
        const ll = ct - 124;
        const lo = rleOut[lp] + 1; lp++;
        const ls = finalBytes.length;
        for (let j = 1; j <= ll; j++) finalBytes.push(finalBytes[ls - lo + j - 1]);
      } else {
        const ll = ct - 188;
        const lo = rleOut[lp] * 256 + rleOut[lp + 1]; lp += 2;
        const ls = finalBytes.length;
        for (let j = 1; j <= ll; j++) finalBytes.push(finalBytes[ls - lo + j - 1]);
      }
    }
  }

  if (finalBytes.length !== rawBytes.length) {
    throw new Error(`[cipher-verify] Final length mismatch: ${finalBytes.length} vs ${rawBytes.length}`);
  }
  for (let i = 0; i < rawBytes.length; i++) {
    if (finalBytes[i] !== rawBytes[i]) {
      throw new Error(`[cipher-verify] Final byte mismatch at ${i}: ${finalBytes[i]} vs ${rawBytes[i]}`);
    }
  }
}

interface CipherLayerOpts {
  layerIndex: number;
  totalLayers: number;
  ownPipelineKey: string;
  outerPipelineKey?: string;
  expectedOuterFp?: number;
  signalKey: string;
  ownFingerprint: number;
}

function wrapCustomCipher(source: string, layerOpts?: CipherLayerOpts): string {

  const rawBytes = toUTF8Bytes(source);

  const tamperPrime = [65521, 65519, 65497, 65479, 65449, 65437, 65423, 65413, 65393, 65381, 65371, 65357][Math.floor(rng() * 12)];
  let tamperChecksum = 0;
  for (let i = 0; i < rawBytes.length; i++) {
    tamperChecksum = (tamperChecksum + rawBytes[i]) % tamperPrime;
  }

  const lzBytes = lzssCompress(rawBytes);
  const compBytes = rleCompress(lzBytes);
  const useCompression = compBytes.length < rawBytes.length * 0.95;
  const bytes = useCompression ? [1, ...compBytes] : [0, ...rawBytes];
  const compRatio = ((1 - bytes.length / rawBytes.length) * 100).toFixed(1);
  const expectedDecompLen = rawBytes.length;
  console.log(`[cipher] LZSS+RLE: ${rawBytes.length} → ${bytes.length} (${compRatio}% ${useCompression ? 'compressed' : 'raw-passthrough'})`);

  const { sbox: cSbox, inverse: cInv } = generateSBox();

  const cSeed = 1 + Math.floor(rng() * 254);
  const cStep = 3 + Math.floor(rng() * 30);
  const enc = new Array<number>(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    enc[i] = cSbox[bytes[i] ^ ((cSeed + i * cStep) & 0xFF)];
  }

  const pool: string[] = [];
  for (let cc = 33; cc <= 126; cc++) {
    if (cc === 34 || cc === 92) continue;
    pool.push(String.fromCharCode(cc));
  }

  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const alpha = pool.slice(0, 64).join('');
  const padChar = pool[64];
  const padByte = padChar.charCodeAt(0);

  let b64 = '';
  for (let i = 0; i < enc.length; i += 3) {
    const a = enc[i], b = enc[i + 1] ?? 0, c = enc[i + 2] ?? 0;
    b64 += alpha[a >> 2];
    b64 += alpha[((a & 3) << 4) | (b >> 4)];
    b64 += (i + 1 < enc.length) ? alpha[((b & 15) << 2) | (c >> 6)] : padChar;
    b64 += (i + 2 < enc.length) ? alpha[c & 63] : padChar;
  }

  verifyCipherRoundtrip(rawBytes, bytes, enc, cInv, cSeed, cStep, b64, alpha, padByte);

  const nFrags = 3 + Math.floor(rng() * 3);
  const fragSize = Math.ceil(b64.length / nFrags);
  const frags: string[] = [];
  for (let i = 0; i < nFrags; i++) {
    frags.push(b64.slice(i * fragSize, (i + 1) * fragSize));
  }

  const ccArgs = (s: string, allowBit32 = false): string =>
    Array.from(s).map(c => {
      const code = c.charCodeAt(0);
      const maxMethod = allowBit32 ? 5 : 4;
      const method = Math.floor(rng() * maxMethod);
      if (method === 0) { const d = 1 + Math.floor(rng() * 50); return `${code - d}+${d}`; }
      if (method === 1) { const d = 1 + Math.floor(rng() * 50); return `${code + d}-${d}`; }
      if (method === 2) { const m = [2,3,4,5][Math.floor(rng()*4)]; return `${code/m === Math.floor(code/m) ? `${code/m}*${m}` : `${code}`}`; }
      if (method === 3) { const x = Math.floor(rng() * 256); return `${nBxor}(${code ^ x},${x})`; }
      return `${code}`;
    }).join(',');

  const nCh = randomName(3);
  const nBy = randomName(3);
  const nSb = randomName(3);
  const nEv = randomName(3);
  const nTb = randomName(3);
  const nLd = randomName(3);
  const nBt = randomName(3);
  const nLUT = randomName(3);
  const nAl = randomName(3);
  const nDt = randomName(3);
  const nRaw = randomName(3);
  const nCnt = randomName(2);
  const nIv = randomName(3);
  const nOut = randomName(3);
  const nBxor = randomName(3);
  const nBand = randomName(3);
  const nBor = randomName(3);
  const nLsh = randomName(3);
  const nRsh = randomName(3);

  const bxorAliases = [nBxor, randomName(3), randomName(3)];
  const chAliases = [nCh, randomName(3), randomName(3)];
  const fragNames = frags.map(() => randomName(4));

  const L: string[] = [];

  let latePcall = '';
  const honeyVars: string[] = [];
  const rInt = (): string => {
    const val = Math.floor(rng() * 65536);
    const fmt = (val * 7 + 3) % 5;
    if (fmt === 0) return `0x${val.toString(16)}`;
    if (fmt === 1 && val > 5) { const d = (val % 97) + 1; return `(${val + d}-${d})`; }
    if (fmt === 2 && val > 20) { const f = [2,3,5,7,11,13][(val>>3)%6]; const q = Math.floor(val/f); const r = val-q*f; return r ? `(${q}*${f}+${r})` : `(${q}*${f})`; }
    if (fmt === 3 && val > 255) return `(0x${(val>>8).toString(16)}*256+${val&0xFF})`;
    return `${val}`;
  };
  const rByte = (): string => {
    const val = Math.floor(rng() * 256);
    const fmt = (val * 13 + 7) % 4;
    if (fmt === 0) return `0x${val.toString(16)}`;
    if (fmt === 1 && val > 3) { const d = (val % 29) + 1; return `(${val + d}-${d})`; }
    if (fmt === 2) return `0x${val.toString(16).padStart(2,'0')}`;
    return `${val}`;
  };
  const rArr = (n: number) => Array.from({ length: n }, () => {
    const val = Math.floor(rng() * 256);
    const fmt = (val * 11 + 5) % 4;
    if (fmt === 0) return `0x${val.toString(16)}`;
    if (fmt === 1 && val > 5) { const d = (val % 19) + 1; return `${val+d}-${d}`; }
    if (fmt === 2) return `0x${val.toString(16).padStart(2,'0')}`;
    return `${val}`;
  }).join(',');

  let _mod16Ctr = 0;
  const polyMod16 = (): string => {
    const v = _mod16Ctr++ % 6;
    if (v === 0) return '65536';
    if (v === 1) return '0x10000';
    if (v === 2) return '(256*256)';
    if (v === 3) return '(0x100*256)';
    if (v === 4) return '(128*512)';
    return '(0x80*0x200)';
  };

  const emitHoneypot = () => {
    const variant = Math.floor(rng() * 10);
    const v = randomName(3);
    honeyVars.push(v);
 
