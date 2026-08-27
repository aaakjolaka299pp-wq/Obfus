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
// Both checks are heuristics, not guarantees — a sufficiently determined
// reverse engineer can work around either on its own. Combined, they raise
// the cost of casually hooking or single-stepping through the output.

export interface AntiTamperOptions {
  enabled: boolean;
  // Number of timing-anomaly hits allowed before halting. Keeping this above
  // 1 avoids false positives from an occasional GC pause or frame hitch.
  strikeLimit?: number;
}

const GUARDED_GLOBALS = [
  "print", "warn", "pcall", "xpcall", "pairs", "ipairs",
  "type", "tostring", "setmetatable", "rawget", "rawset",
];

export function generateAntiTamperPrelude(options: AntiTamperOptions): string {
  if (!options.enabled) return "";

  const strikeLimit = options.strikeLimit ?? 3;
  const guardedList = GUARDED_GLOBALS.map((n) => `"${n}"`).join(", ");

  return `do
  local _rawget = rawget
  local _pcall = pcall
  local _tostring = tostring
  local _type = type
  local _find = string.find
  local _clock = (os and os.clock) or (tick and tick) or nil

  local function __p20_halt()
    while true do end
  end

  local function __p20_checkNative(fn)
    if _type(fn) ~= "function" then return end
    local rep = _tostring(fn)
    if not _find(rep, "builtin", 1, true) and not _find(rep, "0x", 1, true) then
      __p20_halt()
    end
  end

  local __p20_guarded = { ${guardedList} }
  for i = 1, #__p20_guarded do
    local ok, fn = _pcall(function() return _rawget(_G, __p20_guarded[i]) end)
    if ok and fn then __p20_checkNative(fn) end
  end

  if _clock then
    local __p20_strikes = 0
    for __p20_i = 1, ${strikeLimit} do
      local ok = _pcall(function()
        local t0 = _clock()
        local x = 0
        for i = 1, 30000 do x = x + i end
        local dt = _clock() - t0
        if dt > 0.35 then
          __p20_strikes = __p20_strikes + 1
        end
      end)
    end
    if __p20_strikes >= ${Math.max(2, Math.ceil(strikeLimit / 2))} then
      __p20_halt()
    end
  end
end
`;
}
