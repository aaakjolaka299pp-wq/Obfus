document.addEventListener("DOMContentLoaded", () => {
  const inputEditor = document.getElementById("input-editor");
  const outputEditor = document.getElementById("output-editor");

  // --- Line-number gutters (kept in sync with content + scroll position) ---
  function setupGutter(editor, gutterId) {
    const gutter = document.getElementById(gutterId);
    if (!editor || !gutter) return null;

    function renderLineNumbers() {
      const lineCount = editor.value.split("\n").length;
      const current = gutter.children.length;
      if (current === lineCount) return; // avoid needless DOM churn on every keystroke
      let html = "";
      for (let i = 1; i <= lineCount; i++) html += `<span>${i}</span>`;
      gutter.innerHTML = html;
    }

    function syncScroll() {
      gutter.scrollTop = editor.scrollTop;
    }

    editor.addEventListener("input", renderLineNumbers);
    editor.addEventListener("scroll", syncScroll);
    renderLineNumbers();

    return { renderLineNumbers, syncScroll };
  }

  const inputGutterCtl = setupGutter(inputEditor, "input-gutter");
  const outputGutterCtl = setupGutter(outputEditor, "output-gutter");

  // --- Syntax highlight overlay ---
  // Deliberately simple regex-based tokenizer — this is a visual aid, not a
  // real Lua parser (the actual obfuscator's parser does that job). Order
  // matters: comments and strings are matched first so keywords/numbers
  // inside them are never re-colored.
  const LUA_KEYWORDS = new Set([
    "and","break","do","else","elseif","end","false","for","function","goto",
    "if","in","local","nil","not","or","repeat","return","then","true",
    "until","while","self"
  ]);

  function escapeHtml(str) {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function highlightLua(source) {
    const tokenPattern = /(--\[(=*)\[[\s\S]*?\]\2\])|(--[^\n]*)|("(?:[^"\\]|\\.)*")|('(?:[^'\\]|\\.)*')|(\b0x[0-9a-fA-F]+\b)|(\b\d+\.?\d*\b)|([A-Za-z_][A-Za-z0-9_]*)/g;

    let result = "";
    let lastIndex = 0;
    let match;

    while ((match = tokenPattern.exec(source)) !== null) {
      result += escapeHtml(source.slice(lastIndex, match.index));
      const [full, blockComment, , lineComment, dblString, sglString, hexNum, decNum, word] = match;

      if (blockComment || lineComment) {
        result += `<span class="tok-comment">${escapeHtml(full)}</span>`;
      } else if (dblString || sglString) {
        result += `<span class="tok-string">${escapeHtml(full)}</span>`;
      } else if (hexNum || decNum) {
        result += `<span class="tok-number">${escapeHtml(full)}</span>`;
      } else if (word) {
        if (LUA_KEYWORDS.has(word)) {
          result += `<span class="tok-keyword">${escapeHtml(word)}</span>`;
        } else {
          // A bare word immediately followed by "(" reads as a function call.
          const isCall = source[match.index + word.length] === "(";
          result += isCall ? `<span class="tok-function">${escapeHtml(word)}</span>` : escapeHtml(word);
        }
      } else {
        result += escapeHtml(full);
      }
      lastIndex = match.index + full.length;
    }
    result += escapeHtml(source.slice(lastIndex));
    return result;
  }

  function setupHighlight(editor, highlightId) {
    const wrap = document.getElementById(highlightId);
    const code = wrap ? wrap.querySelector("code") : null;
    if (!editor || !code) return null;

    function render() {
      // A trailing newline keeps the overlay's last empty line the same
      // height as the textarea's, so the two never drift out of sync.
      code.innerHTML = highlightLua(editor.value) + "\n";
    }

    function syncScroll() {
      wrap.scrollTop = editor.scrollTop;
      wrap.scrollLeft = editor.scrollLeft;
    }

    editor.addEventListener("input", render);
    editor.addEventListener("scroll", syncScroll);
    render();

    return { render };
  }

  const inputHighlightCtl = setupHighlight(inputEditor, "input-highlight");
  const outputHighlightCtl = setupHighlight(outputEditor, "output-highlight");

  // --- Current-line highlight (Input editor only — output is read-only) ---
  const inputCurrentLine = document.getElementById("input-current-line");

  function updateCurrentLineHighlight() {
    if (!inputCurrentLine || !inputEditor) return;
    const styles = window.getComputedStyle(inputEditor);
    const lineHeight = parseFloat(styles.lineHeight) || 20.8;
    const paddingTop = parseFloat(styles.paddingTop) || 12;

    const textBeforeCursor = inputEditor.value.slice(0, inputEditor.selectionStart);
    const lineIndex = textBeforeCursor.split("\n").length - 1;

    const top = paddingTop + lineIndex * lineHeight - inputEditor.scrollTop;
    inputCurrentLine.style.top = `${top}px`;
    inputCurrentLine.style.height = `${lineHeight}px`;
    inputCurrentLine.classList.add("is-visible");
  }

  if (inputEditor && inputCurrentLine) {
    ["input", "click", "keyup", "scroll", "select"].forEach((evt) => {
      inputEditor.addEventListener(evt, updateCurrentLineHighlight);
    });
    inputEditor.addEventListener("blur", () => inputCurrentLine.classList.remove("is-visible"));
    inputEditor.addEventListener("focus", updateCurrentLineHighlight);
  }

  const optRename = document.getElementById("opt-rename");
  const optPreserve = document.getElementById("opt-preserve");
  const optEncode = document.getElementById("opt-encode");
  const optScramble = document.getElementById("opt-scramble");
  const optOneLine = document.getElementById("opt-oneline");
  const optAntiTamper = document.getElementById("opt-antitamper");
  const optVmType = document.getElementById("opt-vm-type");
  const optVmLevel = document.getElementById("opt-vm-level");

  const btnObfuscate = document.getElementById("btn-obfuscate");
  const btnCopy = document.getElementById("btn-copy");
  const btnUpload = document.getElementById("btn-upload");
  const fileInput = document.getElementById("file-input");
  const btnDownload = document.getElementById("btn-download");
  const btnShare = document.getElementById("btn-share");
  const optProvider = document.getElementById("opt-provider");

  const statusIndicator = document.getElementById("indicator");
  const statusTitle = document.getElementById("status-title");
  const signalRail = document.getElementById("signal-rail");
  const toastRegion = document.getElementById("toast-region");

  // --- Mobile menu (navbar hamburger) ---
  const menuBtn = document.getElementById("menu-btn");
  const mobileMenu = document.getElementById("mobile-menu");

  if (menuBtn && mobileMenu) {
    menuBtn.addEventListener("click", () => {
      const isOpen = mobileMenu.classList.toggle("is-open");
      menuBtn.setAttribute("aria-expanded", String(isOpen));
    });
  }

  // --- Editor tabs: Input Lua / Output / Logs ---
  const editorTabs = document.querySelectorAll(".editor-tab");
  const editorPanels = document.querySelectorAll(".editor-panel");

  editorTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      editorTabs.forEach((t) => {
        const isActive = t === tab;
        t.classList.toggle("is-active", isActive);
        t.setAttribute("aria-selected", String(isActive));
      });
      editorPanels.forEach((panel) => {
        const isActive = panel.id === `editor-panel-${tab.dataset.editorTab}`;
        panel.classList.toggle("is-active", isActive);
        panel.hidden = !isActive;
      });
    });
  });

  // --- Preset: maps the simplified "Zer Lua" / "Minify" choice onto the
  // existing granular options (vmType, toggles) rather than introducing a
  // second, parallel obfuscation path. Manually changing an advanced option
  // afterwards still works normally — this only sets sensible defaults. ---
  // --- Custom dropdowns (Preset, Lua Version) ---
  // Native <select> popups can't be restyled consistently across mobile
  // browsers, so these are built as a button + listbox pair. The selected
  // value lives in a hidden <input>, which the rest of the app already
  // reads via `.value` exactly like a real <select> would.
  function setupDropdown(rootId) {
    const root = document.getElementById(rootId);
    if (!root) return;
    const trigger = root.querySelector(".dropdown-trigger");
    const label = root.querySelector(".dropdown-trigger-label");
    const menu = root.querySelector(".dropdown-menu");
    const options = root.querySelectorAll(".dropdown-option");
    const hiddenInput = root.parentElement.querySelector("input[type=hidden]");

    function close() {
      menu.hidden = true;
      trigger.setAttribute("aria-expanded", "false");
    }

    function open() {
      // Only one dropdown open at a time.
      document.querySelectorAll(".dropdown-menu").forEach((m) => { m.hidden = true; });
      document.querySelectorAll(".dropdown-trigger").forEach((t) => t.setAttribute("aria-expanded", "false"));
      menu.hidden = false;
      trigger.setAttribute("aria-expanded", "true");
    }

    trigger.addEventListener("click", (e) => {
      e.stopPropagation();
      if (menu.hidden) open(); else close();
    });

    options.forEach((opt) => {
      opt.addEventListener("click", () => {
        options.forEach((o) => { o.classList.remove("is-selected"); o.setAttribute("aria-selected", "false"); });
        opt.classList.add("is-selected");
        opt.setAttribute("aria-selected", "true");
        label.textContent = opt.querySelector("span").textContent;
        if (hiddenInput) {
          hiddenInput.value = opt.dataset.value;
          hiddenInput.dispatchEvent(new Event("change"));
        }
        close();
      });
    });
  }

  setupDropdown("dd-preset");
  setupDropdown("dd-lua-version");

  document.addEventListener("click", (e) => {
    document.querySelectorAll(".dropdown").forEach((d) => {
      if (!d.contains(e.target)) {
        const menu = d.querySelector(".dropdown-menu");
        const trigger = d.querySelector(".dropdown-trigger");
        if (menu) menu.hidden = true;
        if (trigger) trigger.setAttribute("aria-expanded", "false");
      }
    });
  });

  const optPreset = document.getElementById("opt-preset");
  const optPrettyPrint = document.getElementById("opt-pretty-print");

  // --- Lua Version ---
  // The compiler currently only targets Luau — Lua51 is shown as a normal
  // option to match the reference UI, but selecting it doesn't change what
  // gets sent to /api/obfuscate. We're upfront about that via a toast
  // rather than silently compiling something different than what the user
  // picked.
  const optLuaVersion = document.getElementById("opt-lua-version");
  if (optLuaVersion) {
    optLuaVersion.addEventListener("change", () => {
      if (optLuaVersion.value === "lua51") {
        showToast("Lua 5.1 support is coming soon — compiling as LuaU for now", "info");
      }
    });
  }

  const PRESETS = {
    zerlua: {
      vmType: "register", vmLevel: "max",
      rename: true, preserve: true, encode: true, scramble: true, oneLine: false, antiTamper: false,
    },
    minify: {
      vmType: "none", vmLevel: "normal",
      rename: false, preserve: true, encode: false, scramble: false, oneLine: true, antiTamper: false,
    },
  };

  function applyPreset(name) {
    const p = PRESETS[name];
    if (!p) return;
    optVmType.value = p.vmType;
    optVmLevel.value = p.vmLevel;
    optRename.checked = p.rename;
    optPreserve.checked = p.preserve;
    optEncode.checked = p.encode;
    optScramble.checked = p.scramble;
    optOneLine.checked = p.oneLine;
    optAntiTamper.checked = p.antiTamper;
    if (optPrettyPrint) optPrettyPrint.checked = !p.oneLine;
  }

  if (optPreset) {
    optPreset.addEventListener("change", () => applyPreset(optPreset.value));
    applyPreset(optPreset.value);
  }

  // --- Pretty print: inverse of the existing "Minify code" (oneLine) flag ---
  if (optPrettyPrint) {
    optPrettyPrint.checked = !optOneLine.checked;
    optPrettyPrint.addEventListener("change", () => {
      optOneLine.checked = !optPrettyPrint.checked;
    });
    optOneLine.addEventListener("change", () => {
      optPrettyPrint.checked = !optOneLine.checked;
    });
  }

  // --- Seed preview ---
  // The compiler generates a fresh seed internally on every run
  // (polymorphicSeed) — there is no server-side option to pin a specific
  // seed yet. This field is a read-only preview so the control isn't
  // misleading; it is intentionally not wired into the /api/obfuscate
  // payload, and updates each time a compile actually runs.
  const seedDisplay = document.getElementById("seed-display");
  const btnSeedRefresh = document.getElementById("btn-seed-refresh");

  function randomSeedPreview() {
    return String(Math.floor(10000000 + Math.random() * 89999999));
  }

  if (seedDisplay) seedDisplay.value = randomSeedPreview();
  if (btnSeedRefresh) {
    btnSeedRefresh.addEventListener("click", () => {
      seedDisplay.value = randomSeedPreview();
    });
  }

  // --- Compiler Logs tab ---
  const logsList = document.getElementById("logs-list");
  const logsEmpty = document.getElementById("logs-empty");
  const logsCount = document.getElementById("logs-count");
  let logEvents = [];

  function addLogEvent(level, message, stage) {
    logEvents.push({ level, message, stage, at: new Date() });
    renderLogs();
  }

  function renderLogs() {
    if (!logsList) return;
    if (logEvents.length === 0) {
      logsList.innerHTML = "";
      if (logsEmpty) logsList.appendChild(logsEmpty);
      if (logsCount) logsCount.innerText = "0 events";
      return;
    }
    if (logsCount) logsCount.innerText = `${logEvents.length} event${logEvents.length === 1 ? "" : "s"}`;
    logsList.innerHTML = logEvents.map((ev) => {
      const time = ev.at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      const dotClass = ev.level === "error" ? "status-red" : ev.level === "warning" ? "status-amber" : ev.level === "success" ? "status-green" : "";
      return `
        <div class="log-entry log-${ev.level}">
          <span class="status-dot ${dotClass}"></span>
          <span class="log-message">${ev.message}</span>
          ${ev.stage ? `<span class="log-stage">${ev.stage}</span>` : ""}
          <span class="log-time">${time}</span>
        </div>
      `;
    }).join("");
  }

  // --- Output empty state ---
  const outputEmptyState = document.getElementById("output-empty");
  const outputEditorWrap = outputEditor.closest(".editor-wrap");
  function updateOutputEmptyState() {
    if (!outputEmptyState) return;
    const isEmpty = outputEditor.value.trim() === "";
    outputEmptyState.style.display = isEmpty ? "" : "none";
    if (outputEditorWrap) outputEditorWrap.style.display = isEmpty ? "none" : "";
  }
  updateOutputEmptyState();

  let debounceTimer;

  performLiveValidation();

  inputEditor.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(performLiveValidation, 600);
  });

  btnObfuscate.addEventListener("click", performObfuscation);

  const btnRun = document.getElementById("btn-run");
  if (btnRun) btnRun.addEventListener("click", performObfuscation);

  btnCopy.addEventListener("click", () => {
    if (outputEditor.value.trim() === "") return;

    navigator.clipboard.writeText(outputEditor.value).then(() => {
      showToast("Output copied to clipboard", "success");
    }).catch(err => {
      showToast(`Couldn't copy to clipboard: ${err.message}`, "error");
    });
  });

  btnUpload.addEventListener("click", () => {
    fileInput.click();
  });

  fileInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      inputEditor.value = evt.target.result;
      if (inputGutterCtl) inputGutterCtl.renderLineNumbers();
      if (inputHighlightCtl) inputHighlightCtl.render();
      showToast(`Loaded "${file.name}"`, "success");
      performLiveValidation();
    };
    reader.onerror = () => {
      showToast(`Couldn't read "${file.name}"`, "error");
    };
    reader.readAsText(file);

    fileInput.value = "";
  });

  btnDownload.addEventListener("click", () => {
    if (outputEditor.value.trim() === "") return;

    try {
      const blob = new Blob([outputEditor.value], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "obfuscated.lua";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      showToast(`Download failed: ${err.message}`, "error");
    }
  });

  btnShare.addEventListener("click", async () => {
    if (outputEditor.value.trim() === "") return;

    const shareText = document.getElementById("share-text");
    const originalText = shareText.innerText;
    shareText.innerText = "Uploading...";
    btnShare.disabled = true;

    try {
      const response = await fetch("/api/paste", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: outputEditor.value,
          title: "Zer Lua Obfuscated Script",
          provider: optProvider.value
        })
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Upload failed");
      }

      await navigator.clipboard.writeText(result.url).catch(() => {});

      shareText.innerText = "Link copied ✓";
      showToast("Share link copied to clipboard", "success");

      setTimeout(() => {
        shareText.innerText = originalText;
      }, 2500);

    } catch (err) {
      showToast(err.message, "error");
      shareText.innerText = originalText;
    } finally {
      btnShare.disabled = false;
    }
  });

  async function performLiveValidation() {
    const code = inputEditor.value;
    if (code.trim() === "") {
      updateStatus("", "Ready");
      return;
    }

    try {
      const response = await fetch("/api/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });

      if (!response.ok) {
        throw new Error("Validation request failed");
      }

      const result = await response.json();

      if (result && result.errors && result.errors.length > 0) {
        const hasErrors = result.errors.some(e => e.severity === "error");

        if (hasErrors) {
          const first = result.errors.find(e => e.severity === "error") || result.errors[0];
          const locStr = first.line ? `line ${first.line}` : "";
          updateStatus("red", `Syntax error ${locStr}`.trim());
        } else {
          updateStatus("amber", "Warnings");
        }
      } else {
        updateStatus("green", "Syntax valid");
      }

    } catch (err) {
      updateStatus("amber", "Validation offline");
    }
  }

  let isCompiling = false;

  async function performObfuscation() {
    if (isCompiling) return; // guard against double-execution (e.g. rapid double-tap on mobile)

    const code = inputEditor.value;
    if (code.trim() === "") {
      showToast("Add some Luau code first", "error");
      return;
    }

    isCompiling = true;
    const btnText = btnObfuscate.querySelector(".btn-text");
    const loader = btnObfuscate.querySelector(".btn-loader");
    const btnRunEl = document.getElementById("btn-run");

    const originalBtnText = btnText.innerText;
    btnText.innerText = "Compiling...";
    loader.classList.remove("hidden");
    btnObfuscate.disabled = true;
    if (btnRunEl) btnRunEl.disabled = true;
    if (btnSeedRefresh) btnSeedRefresh.disabled = true;
    setRailState("running");
    addLogEvent("info", "Compilation started", "lex+parse");

    const payload = {
      code,
      options: {
        noRename: !optRename.checked,
        noPreserve: !optPreserve.checked,
        encodeStrings: optEncode.checked,
        scramble: optScramble.checked,
        oneLine: optOneLine.checked,
        antiTamper: optAntiTamper.checked,
        vmType: optVmType.value,
        vmLevel: optVmLevel.value
      }
    };

    try {
      const response = await fetch("/api/obfuscate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Obfuscation failed");
      }

      outputEditor.value = result.output;
      if (outputGutterCtl) outputGutterCtl.renderLineNumbers();
      if (outputHighlightCtl) outputHighlightCtl.render();
      btnCopy.disabled = false;
      btnDownload.disabled = false;
      btnShare.disabled = false;
      // btnSaveScript stays disabled: it depends on the Key tab's auth,
      // which isn't part of this page for now.
      updateOutputEmptyState();
      if (seedDisplay) seedDisplay.value = randomSeedPreview();

      addLogEvent("success", `Compiled successfully (${payload.options.vmType} VM, ${payload.options.vmLevel})`, "codegen");
      showToast("Compilation successful", "success");
      setRailState("success");

    } catch (err) {
      showToast(err.message, "error");
      addLogEvent("error", err.message, "compile");
      outputEditor.value = "";
      if (outputGutterCtl) outputGutterCtl.renderLineNumbers();
      if (outputHighlightCtl) outputHighlightCtl.render();
      btnCopy.disabled = true;
      btnDownload.disabled = true;
      btnShare.disabled = true;
      btnSaveScript.disabled = true;
      updateOutputEmptyState();
      setRailState("error");
    } finally {
      btnText.innerText = originalBtnText;
      loader.classList.add("hidden");
      btnObfuscate.disabled = false;
      if (btnRunEl) btnRunEl.disabled = false;
      if (btnSeedRefresh) btnSeedRefresh.disabled = false;
      isCompiling = false;
    }
  }

  function updateStatus(color, text) {
    if (statusIndicator) {
      statusIndicator.className = `status-dot${color ? " status-" + color : ""}`;
    }
    if (statusTitle) {
      statusTitle.innerText = text;
    }
  }

  function setRailState(state) {
    if (!signalRail) return;
    signalRail.classList.remove("is-running", "is-success", "is-error");
    if (state === "running") {
      signalRail.classList.add("is-running");
    } else if (state === "success") {
      signalRail.classList.add("is-success");
      setTimeout(() => signalRail.classList.remove("is-success"), 1400);
    } else if (state === "error") {
      signalRail.classList.add("is-error");
      setTimeout(() => signalRail.classList.remove("is-error"), 1800);
    }
  }

  function showToast(message, type = "info") {
    if (!toastRegion) return;

    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    toast.setAttribute("role", type === "error" ? "alert" : "status");

    const text = document.createElement("span");
    text.innerText = message;
    toast.appendChild(text);

    const dismiss = document.createElement("button");
    dismiss.className = "toast-dismiss";
    dismiss.innerText = "×";
    dismiss.setAttribute("aria-label", "Dismiss notification");
    dismiss.addEventListener("click", () => removeToast(toast));
    toast.appendChild(dismiss);

    toastRegion.appendChild(toast);

    setTimeout(() => removeToast(toast), 4800);
  }

  function removeToast(toast) {
    if (!toast || !toast.parentNode) return;
    toast.classList.add("toast-leaving");
    setTimeout(() => toast.remove(), 180);
  }

  // "Save to Scripts" depends on the Key tab's auth, which isn't part of
  // this page for now — the button stays disabled (see index.html) and
  // this handler is a safety net in case that ever changes upstream.
  const btnSaveScript = document.getElementById("btn-save-script");
  if (btnSaveScript) {
    btnSaveScript.addEventListener("click", () => {
      showToast("Save to Scripts isn't available on this page yet", "error");
    });
  }
});
