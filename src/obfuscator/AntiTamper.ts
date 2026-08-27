// AntiTamper.ts
// Generates a self-contained Lua prelude that runs before the protected
// script. It performs two independent checks:
//
//   1. Native function fingerprinting — a handful of commonly-hooked globals
//      (print, pcall, pairs, etc.) are checked against the string shape
//      Roblox's real implementations report via tostring(). An exploit that
//      replaces one of these with a Lua-defined proxy will not match that
//      shape and trips the check.
//
//   2. Timing anomaly detection — runs a small busy loop and measures wall
//      time via os.clock(). A debugger or breakpoint pausing execution
//      mid-script inflates the measured delta well past what the loop
//      should normally take, which is used as a (soft) signal of tampering.
//
// KNOWN LIMITATION: this prelude is a structurally separate `do ... end`
// block — nothing downstream depends on a value it produces, so a reader
// who spots it can delete the whole block without breaking the payload.
// The randomization below defeats naive signature/name matching, but does
// not stop a human who actually reads the code. Closing that gap requires
// entangling the check outcome with the VM's own decode key, which is a
// separate, larger change to the VM bootstrap — tracked as a follow-up,
// not solved here.

export interface AntiTamperOptions {
  enabled: boolean;
  // Number of timing-anomaly samples taken before deciding. Keeping this
  // above 1 avoids false positives from an occasional GC pause or frame
  // hitch; roughly half the samples must exceed the threshold to halt.
  strikeLimit?: number;
}

const GUARDED_GLOBALS = [
  "print", "warn", "pcall", "xpcall", "pairs", "ipairs",
  "type", "tostring", "setmetatable", "rawget", "rawset",
];

function randSuffix(): string {
  return Math.random().toString(36).slice(2, 8);
}

function shuffled<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

export function generateAntiTamperPrelude(options: AntiTamperOptions): string {
  if (!options.enabled) return "";

  const strikeLimit = options.strikeLimit ?? 3;
  const requiredStrikes = Math.max(2, Math.ceil(strikeLimit / 2));

  // Fresh random identifiers every compile so static name/signature
  // matching (e.g. a deobfuscator grepping for "__p20_halt") doesn't work
  // across two different outputs.
  const id = randSuffix();
  const nRawget = `_rg${id}`;
  const nPcall = `_pc${id}`;
  const nTostring = `_ts${id}`;
  const nType = `_ty${id}`;
  const nFind = `_fd${id}`;
  const nClock = `_ck${id}`;
  const nHalt = `_h${id}`;
  const nCheck = `_c${id}`;
  const nGuarded = `_g${id}`;
  const nStrikes = `_s${id}`;

  const guardedList = shuffled(GUARDED_GLOBALS).map((n) => `"${n}"`).join(",");

  const lines = [
    `do local ${nRawget}=rawget local ${nPcall}=pcall local ${nTostring}=tostring local ${nType}=type local ${nFind}=string.find local ${nClock}=(os and os.clock) or (tick and tick) or nil`,
    `local function ${nHalt}() while true do end end`,
    `local function ${nCheck}(fn) if ${nType}(fn)~="function" then return end local rep=${nTostring}(fn) if not ${nFind}(rep,"builtin",1,true) and not ${nFind}(rep,"0x",1,true) then ${nHalt}() end end`,
    `local ${nGuarded}={${guardedList}} for i=1,#${nGuarded} do local ok,fn=${nPcall}(function() return ${nRawget}(_G,${nGuarded}[i]) end) if ok and fn then ${nCheck}(fn) end end`,
    `if ${nClock} then local ${nStrikes}=0 for i=1,${strikeLimit} do local ok=${nPcall}(function() local t0=${nClock}() local x=0 for j=1,30000 do x=x+j end local dt=${nClock}()-t0 if dt>0.35 then ${nStrikes}=${nStrikes}+1 end end) end if ${nStrikes}>=${requiredStrikes} then ${nHalt}() end end`,
    `end`,
  ];

  return lines.join("\n") + "\n";
}
