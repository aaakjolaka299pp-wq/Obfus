document.addEventListener("DOMContentLoaded", () => {
  // --- Tabs ---
  const tabButtons = document.querySelectorAll(".tab-btn");
  const tabPanels = document.querySelectorAll(".tab-panel");

  tabButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      tabButtons.forEach(b => { b.classList.remove("is-active"); b.setAttribute("aria-selected", "false"); });
      tabPanels.forEach(p => p.classList.remove("is-active"));
      btn.classList.add("is-active");
      btn.setAttribute("aria-selected", "true");
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add("is-active");
    });
  });

  const inputEditor = document.getElementById("input-editor");
  const outputEditor = document.getElementById("output-editor");

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

  let debounceTimer;

  performLiveValidation();

  inputEditor.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(performLiveValidation, 600);
  });

  btnObfuscate.addEventListener("click", performObfuscation);

  btnCopy.addEventListener("click", () => {
    if (outputEditor.value.trim() === "") return;

    navigator.clipboard.writeText(outputEditor.value).then(() => {
      const copyText = document.getElementById("copy-text");
      const originalText = copyText.innerText;
      copyText.innerText = "Copied ✓";

      setTimeout(() => {
        copyText.innerText = originalText;
      }, 2000);
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

  async function performObfuscation() {
    const code = inputEditor.value;
    if (code.trim() === "") {
      showToast("Add some Luau code first", "error");
      return;
    }

    const btnText = btnObfuscate.querySelector(".btn-text");
    const loader = btnObfuscate.querySelector(".btn-loader");

    const originalBtnText = btnText.innerText;
    btnText.innerText = "Compiling...";
    loader.classList.remove("hidden");
    btnObfuscate.disabled = true;
    setRailState("running");

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
      btnCopy.disabled = false;
      btnDownload.disabled = false;
      btnShare.disabled = false;
      btnSaveScript.disabled = false;

      setRailState("success");

    } catch (err) {
      showToast(err.message, "error");
      outputEditor.value = "";
      btnCopy.disabled = true;
      btnDownload.disabled = true;
      btnShare.disabled = true;
      btnSaveScript.disabled = true;
      setRailState("error");
    } finally {
      btnText.innerText = originalBtnText;
      loader.classList.add("hidden");
      btnObfuscate.disabled = false;
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

  // --- Key System (gated by an access key, remembered once verified) ---

  const ksGate = document.getElementById("ks-gate");
  const ksGateInput = document.getElementById("ks-gate-input");
  const ksGateSubmit = document.getElementById("ks-gate-submit");
  const ksGateError = document.getElementById("ks-gate-error");
  const ksContent = document.getElementById("ks-content");

  const ksBtnCreate = document.getElementById("ks-btn-create");
  const ksNewKeyType = document.getElementById("ks-new-key-type");
  const ksNewKeyDuration = document.getElementById("ks-new-key-duration");
  const ksNewKeyLoader = document.getElementById("ks-new-key-loader");
  const ksBtnLogout = document.getElementById("ks-btn-logout");
  const ksList = document.getElementById("ks-list");
  const ksLoaderTitle = document.getElementById("ks-loader-title");
  const ksLoaderType = document.getElementById("ks-loader-type");
  const ksLoaderScriptMultiselect = document.getElementById("ks-loader-script-multiselect");
  const ksBtnLoader = document.getElementById("ks-btn-loader");
  const ksLoaderOutput = document.getElementById("ks-loader-output");
  const ksBtnLoaderCopy = document.getElementById("ks-btn-loader-copy");
  const ksBtnLoaderDownload = document.getElementById("ks-btn-loader-download");
  const ksLoaderList = document.getElementById("ks-loader-list");

  const settingsStatus = document.getElementById("settings-status");
  const settingsBtnLogout = document.getElementById("settings-btn-logout");

  const scriptsGate = document.getElementById("scripts-gate");
  const scriptsContent = document.getElementById("scripts-content");
  const scriptsList = document.getElementById("scripts-list");
  const scriptsNewTitle = document.getElementById("scripts-new-title");
  const scriptsNewSource = document.getElementById("scripts-new-source");
  const scriptsBtnSave = document.getElementById("scripts-btn-save");
  const btnSaveScript = document.getElementById("btn-save-script");

  const overviewGate = document.getElementById("overview-gate");
  const overviewContent = document.getElementById("overview-content");
  const overviewPeriod = document.getElementById("overview-period");
  const overviewCards = document.getElementById("overview-cards");
  const overviewChart = document.getElementById("overview-chart");
  const overviewBounce = document.getElementById("overview-bounce");

  let ksAccessKey = null;

  async function ksFetch(path, options = {}) {
    const res = await fetch(path, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        "X-Admin-Key": ksAccessKey || "",
        ...(options.headers || {}),
      },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  function showKeySystemLocked() {
    ksGate.style.display = "";
    ksContent.style.display = "none";
    scriptsGate.style.display = "";
    scriptsContent.style.display = "none";
    overviewGate.style.display = "";
    overviewContent.style.display = "none";
    if (settingsStatus) settingsStatus.innerText = "Key System: locked";
    stopPolling();
  }

  function showKeySystemUnlocked() {
    ksGate.style.display = "none";
    ksContent.style.display = "";
    scriptsGate.style.display = "none";
    scriptsContent.style.display = "";
    overviewGate.style.display = "none";
    overviewContent.style.display = "";
    if (settingsStatus) settingsStatus.innerText = "Key System: unlocked";
    startPolling();
  }

  function lockKeySystem() {
    ksAccessKey = null;
    localStorage.removeItem("zer_admin_key");
    showKeySystemLocked();
  }

  async function tryUnlock(key) {
    ksAccessKey = key;
    try {
      const data = await ksFetch("/api/admin/keys");
      localStorage.setItem("zer_admin_key", key);
      showKeySystemUnlocked();
      renderKeys(data.keys || []);
      loadScripts();
      loadLoaders();
      loadOverview();
    } catch (err) {
      ksAccessKey = null;
      ksGateError.innerText = "Invalid access key.";
    }
  }

  ksGateSubmit.addEventListener("click", () => {
    const key = ksGateInput.value.trim();
    if (!key) return;
    ksGateError.innerText = "";
    tryUnlock(key);
  });

  ksBtnLogout.addEventListener("click", lockKeySystem);
  if (settingsBtnLogout) settingsBtnLogout.addEventListener("click", lockKeySystem);

  function renderKeys(keys) {
    if (!keys.length) {
      ksList.innerHTML = `<div style="color:var(--muted)">No keys yet.</div>`;
      return;
    }
    ksList.innerHTML = keys.map(k => {
      const status = k.revoked ? "REVOKED" : (k.expiresAt && Date.now() > k.expiresAt ? "EXPIRED" : "ACTIVE");
      const statusColor = status === "ACTIVE" ? "var(--ok)" : "var(--warn)";
      const limitText = k.hwidLimit === null ? "unlimited" : k.hwidLimit;
      const typeColor = k.type === "free" ? "var(--muted)" : "var(--signal)";
      const typeLabel = k.type === "free" ? "FREE" : "PREMIUM";
      const expiresText = k.expiresAt ? new Date(k.expiresAt).toLocaleString() : "never";
      return `
        <div style="border:1px solid var(--line); border-radius:8px; padding:10px; margin-bottom:8px;">
          <div style="display:flex; justify-content:space-between; gap:8px; flex-wrap:wrap; align-items:center;">
            <span style="word-break:break-all;">${k.key}</span>
            <span style="display:flex; align-items:center; gap:8px; flex-shrink:0;">
              <button class="ks-copy-key" data-key="${k.key}" style="background:none; border:none; color:var(--signal); cursor:pointer; font-size:11px; padding:0;">Copy</button>
              <span style="color:${typeColor}; font-weight:600; font-size:11px;">${typeLabel}</span>
              <span style="color:${statusColor}">${status}</span>
            </span>
          </div>
          <div style="color:var(--muted); margin-top:4px;">${k.note ? k.note + " · " : ""}Loader: ${k.loaderId || "any"} · Script: ${k.scriptId || "any"} · Uses: ${k.uses || 0} · Expires: ${expiresText}</div>

          <button class="btn btn-ghost ks-toggle-hwid" data-key="${k.key}" style="font-size:11px; padding:6px 10px; margin-top:8px;">
            HWIDs: ${k.hwids.length}/${limitText}
          </button>

          <div class="ks-hwid-panel" data-key="${k.key}" style="display:none; margin-top:8px; padding:10px; border:1px solid var(--line); border-radius:6px;">
            <div class="ks-hwid-items"></div>
            <div style="display:flex; gap:6px; margin-top:8px;">
              <input type="text" class="select-input ks-hwid-add-input" data-key="${k.key}" placeholder="Add HWID manually" style="font-size:12px; padding:6px 8px;">
              <button class="btn btn-ghost ks-hwid-add" data-key="${k.key}" style="font-size:11px; padding:6px 10px; flex-shrink:0;">Add</button>
            </div>
            <div style="display:flex; gap:6px; margin-top:8px; align-items:center;">
              <span style="font-size:11px; color:var(--muted); flex-shrink:0;">Limit:</span>
              <input type="number" class="select-input ks-hwid-limit-input" data-key="${k.key}" value="${k.hwidLimit === null ? '' : k.hwidLimit}" placeholder="unlimited" min="0" style="font-size:12px; padding:6px 8px;">
              <button class="btn btn-ghost ks-hwid-limit-save" data-key="${k.key}" style="font-size:11px; padding:6px 10px; flex-shrink:0;">Save</button>
            </div>
          </div>

          <div class="stage-actions" style="margin-top:8px;">
            <button class="btn btn-ghost ks-revoke" data-key="${k.key}" style="font-size:11px; padding:6px 10px;">Revoke</button>
            <button class="btn btn-ghost ks-reset" data-key="${k.key}" style="font-size:11px; padding:6px 10px;">Reset all HWIDs</button>
            <button class="btn btn-ghost ks-delete" data-key="${k.key}" style="font-size:11px; padding:6px 10px;">Delete</button>
          </div>
        </div>
      `;
    }).join("");

    const keysById = {};
    keys.forEach(k => keysById[k.key] = k);

    function renderHwidItems(panel, keyStr) {
      const k = keysById[keyStr];
      const container = panel.querySelector(".ks-hwid-items");
      if (!k.hwids.length) {
        container.innerHTML = `<div style="color:var(--muted); font-size:12px;">No devices bound yet.</div>`;
        return;
      }
      container.innerHTML = k.hwids.map(h => `
        <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; padding:6px 0; border-bottom:1px solid var(--line); font-size:12px;">
          <span style="word-break:break-all;">${h}</span>
          <span style="display:flex; gap:8px; flex-shrink:0;">
            <button class="ks-hwid-copy" data-hwid="${h}" style="background:none; border:none; color:var(--signal); cursor:pointer; font-size:11px; padding:0;">Copy</button>
            <button class="ks-hwid-remove" data-key="${keyStr}" data-hwid="${h}" style="background:none; border:none; color:var(--warn); cursor:pointer; font-size:11px; padding:0;">Remove</button>
          </span>
        </div>
      `).join("");

      container.querySelectorAll(".ks-hwid-copy").forEach(btn => {
        btn.addEventListener("click", () => {
          navigator.clipboard.writeText(btn.dataset.hwid).then(() => showToast("HWID copied", "success"));
        });
      });
      container.querySelectorAll(".ks-hwid-remove").forEach(btn => {
        btn.addEventListener("click", async () => {
          try {
            await ksFetch(`/api/admin/keys/${btn.dataset.key}/hwid/${encodeURIComponent(btn.dataset.hwid)}`, { method: "DELETE" });
            await loadKeys();
          } catch (err) { showToast(err.message, "error"); }
        });
      });
    }

    ksList.querySelectorAll(".ks-copy-key").forEach(btn => {
      btn.addEventListener("click", () => {
        navigator.clipboard.writeText(btn.dataset.key).then(() => showToast("Key copied", "success"));
      });
    });

    ksList.querySelectorAll(".ks-toggle-hwid").forEach(btn => {
      btn.addEventListener("click", () => {
        const panel = ksList.querySelector(`.ks-hwid-panel[data-key="${btn.dataset.key}"]`);
        const isOpen = panel.style.display !== "none";
        panel.style.display = isOpen ? "none" : "";
        if (!isOpen) renderHwidItems(panel, btn.dataset.key);
      });
    });

    ksList.querySelectorAll(".ks-hwid-add").forEach(btn => {
      btn.addEventListener("click", async () => {
        const input = ksList.querySelector(`.ks-hwid-add-input[data-key="${btn.dataset.key}"]`);
        const hwid = input.value.trim();
        if (!hwid) return;
        try {
          await ksFetch(`/api/admin/keys/${btn.dataset.key}/hwid`, { method: "POST", body: JSON.stringify({ hwid }) });
          input.value = "";
          await loadKeys();
        } catch (err) { showToast(err.message, "error"); }
      });
    });

    ksList.querySelectorAll(".ks-hwid-limit-save").forEach(btn => {
      btn.addEventListener("click", async () => {
        const input = ksList.querySelector(`.ks-hwid-limit-input[data-key="${btn.dataset.key}"]`);
        const raw = input.value.trim();
        const limit = raw === "" ? null : parseInt(raw, 10);
        try {
          await ksFetch(`/api/admin/keys/${btn.dataset.key}/hwid-limit`, { method: "POST", body: JSON.stringify({ limit }) });
          showToast("HWID limit updated", "success");
          await loadKeys();
        } catch (err) { showToast(err.message, "error"); }
      });
    });

    ksList.querySelectorAll(".ks-revoke").forEach(btn => {
      btn.addEventListener("click", async () => {
        try {
          await ksFetch(`/api/admin/keys/${btn.dataset.key}/revoke`, { method: "POST" });
          await loadKeys();
        } catch (err) { showToast(err.message, "error"); }
      });
    });
    ksList.querySelectorAll(".ks-reset").forEach(btn => {
      btn.addEventListener("click", async () => {
        try {
          await ksFetch(`/api/admin/keys/${btn.dataset.key}/reset-hwid`, { method: "POST" });
          await loadKeys();
        } catch (err) { showToast(err.message, "error"); }
      });
    });
    ksList.querySelectorAll(".ks-delete").forEach(btn => {
      btn.addEventListener("click", async () => {
        try {
          await ksFetch(`/api/admin/keys/${btn.dataset.key}`, { method: "DELETE" });
          await loadKeys();
        } catch (err) { showToast(err.message, "error"); }
      });
    });
  }

  async function loadKeys() {
    try {
      const data = await ksFetch("/api/admin/keys");
      renderKeys(data.keys || []);
    } catch (err) {
      showToast(err.message, "error");
    }
  }

  const ksNewKeyHwidLimit = document.getElementById("ks-new-key-hwidlimit");

  ksBtnCreate.addEventListener("click", async () => {
    try {
      const type = ksNewKeyType.value === "free" ? "free" : "premium";
      const duration = ksNewKeyDuration.value || "unlimited";
      const loaderId = ksNewKeyLoader.value || undefined;
      const rawLimit = ksNewKeyHwidLimit.value.trim();
      const hwidLimit = rawLimit === "" ? null : parseInt(rawLimit, 10);
      const data = await ksFetch("/api/admin/keys", {
        method: "POST",
        body: JSON.stringify({ type, duration, loaderId, hwidLimit }),
      });
      await navigator.clipboard.writeText(data.key.key).catch(() => {});
      showToast(`${type === "free" ? "Free" : "Premium"} key created & copied: ${data.key.key}`, "success");
      await loadKeys();
    } catch (err) {
      showToast(err.message, "error");
    }
  });

  // Tracks which script ids are currently checked in the multi-select.
  let selectedLoaderScriptIds = new Set();

  function renderScriptMultiselect(scripts) {
    if (!scripts.length) {
      ksLoaderScriptMultiselect.innerHTML = `<div style="color:var(--muted); font-size:12.5px;">No saved scripts yet — add one below first.</div>`;
      return;
    }
    // Preserve checked state across re-renders (e.g. from polling).
    ksLoaderScriptMultiselect.innerHTML = scripts.map(s => `
      <label style="display:flex; align-items:center; gap:8px; padding:7px 4px; border-bottom:1px solid var(--line); font-size:12.5px; cursor:pointer;">
        <input type="checkbox" class="ks-loader-script-check" value="${s.id}" ${selectedLoaderScriptIds.has(s.id) ? "checked" : ""}>
        <span>${s.title}</span>
        <span style="color:var(--muted); margin-left:auto;">${s.id}</span>
      </label>
    `).join("");

    ksLoaderScriptMultiselect.querySelectorAll(".ks-loader-script-check").forEach(cb => {
      cb.addEventListener("change", () => {
        if (cb.checked) selectedLoaderScriptIds.add(cb.value);
        else selectedLoaderScriptIds.delete(cb.value);
      });
    });
  }

  ksBtnLoader.addEventListener("click", async () => {
    try {
      const scriptIds = Array.from(selectedLoaderScriptIds);
      if (scriptIds.length === 0) {
        showToast("Select at least one script to include", "error");
        return;
      }
      const data = await ksFetch("/api/admin/loaders", {
        method: "POST",
        body: JSON.stringify({
          title: ksLoaderTitle.value.trim(),
          loaderType: ksLoaderType.value === "free" ? "free" : "premium",
          scriptIds,
        }),
      });
      ksLoaderOutput.value = data.loader;
      ksBtnLoaderCopy.disabled = false;
      ksBtnLoaderDownload.disabled = false;
      showToast("Loader generated", "success");
      await loadLoaders();
    } catch (err) {
      showToast(err.message, "error");
    }
  });

  ksBtnLoaderCopy.addEventListener("click", () => {
    navigator.clipboard.writeText(ksLoaderOutput.value).then(() => {
      showToast("Loader copied to clipboard", "success");
    }).catch(err => showToast(err.message, "error"));
  });

  ksBtnLoaderDownload.addEventListener("click", () => {
    const blob = new Blob([ksLoaderOutput.value], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "loader.lua";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });

  function renderLoaders(loaders) {
    if (!loaders.length) {
      ksLoaderList.innerHTML = `<div style="color:var(--muted)">No loaders generated yet.</div>`;
      return;
    }
    ksLoaderList.innerHTML = loaders.map(l => {
      const typeColor = l.type === "free" ? "var(--muted)" : "var(--signal)";
      const created = new Date(l.createdAt).toLocaleString();
      return `
        <div style="border:1px solid var(--line); border-radius:8px; padding:10px; margin-bottom:8px;">
          <div style="display:flex; justify-content:space-between; gap:8px; flex-wrap:wrap; align-items:center;">
            <span>${l.title}</span>
            <span style="color:${typeColor}; font-weight:600; font-size:11px;">${l.type.toUpperCase()}</span>
          </div>
          <div style="color:var(--muted); margin-top:4px;">${l.id} · ${l.scriptIds.length} script(s) · created ${created}</div>
          <div class="stage-actions" style="margin-top:8px;">
            <button class="btn btn-ghost ks-loader-delete" data-id="${l.id}" style="font-size:11px; padding:6px 10px;">Delete</button>
          </div>
        </div>
      `;
    }).join("");

    ksLoaderList.querySelectorAll(".ks-loader-delete").forEach(btn => {
      btn.addEventListener("click", async () => {
        try {
          await ksFetch(`/api/admin/loaders/${btn.dataset.id}`, { method: "DELETE" });
          await loadLoaders();
        } catch (err) { showToast(err.message, "error"); }
      });
    });
  }

  async function loadLoaders() {
    try {
      const data = await ksFetch("/api/admin/loaders");
      const loaders = data.loaders || [];
      renderLoaders(loaders);

      const currentValue = ksNewKeyLoader.value;
      ksNewKeyLoader.innerHTML = `<option value="">Any / not loader-scoped</option>` +
        loaders.map(l => `<option value="${l.id}">${l.title} (${l.type})</option>`).join("");
      ksNewKeyLoader.value = currentValue;
    } catch (err) {
      showToast(err.message, "error");
    }
  }

  // --- Scripts (private storage; same access key as Key System) ---

  function renderScripts(scripts) {
    if (!scripts.length) {
      scriptsList.innerHTML = `<div style="color:var(--muted)">No scripts saved yet.</div>`;
      return;
    }
    scriptsList.innerHTML = scripts.map(s => {
      const kb = (s.size / 1024).toFixed(1);
      const updated = new Date(s.updatedAt).toLocaleString();
      const statusColor = s.status === "enabled" ? "var(--ok)" : "var(--warn)";
      const placeChips = (s.placeIds || []).map(pid => `
        <span style="display:inline-flex; align-items:center; gap:6px; border:1px solid var(--line); border-radius:6px; padding:3px 8px; margin:3px 4px 0 0; font-size:11px;">
          ${pid}
          <button class="scripts-remove-place" data-id="${s.id}" data-place="${pid}" style="background:none; border:none; color:var(--warn); cursor:pointer; padding:0; font-size:13px; line-height:1;">×</button>
        </span>
      `).join("") || `<span style="color:var(--muted); font-size:12px;">No Place IDs assigned</span>`;

      return `
        <div style="border:1px solid var(--line); border-radius:8px; padding:10px; margin-bottom:8px;">
          <div style="display:flex; justify-content:space-between; gap:8px; flex-wrap:wrap;">
            <span>${s.title}</span>
            <span style="color:${statusColor}">${s.status.toUpperCase()}</span>
          </div>
          <div style="color:var(--muted); margin-top:4px;">${s.id} · ${kb} KB · updated ${updated}</div>

          <div style="margin-top:8px;">${placeChips}</div>
          <div style="display:flex; gap:6px; margin-top:6px;">
            <input type="text" class="select-input scripts-place-input" data-id="${s.id}" placeholder="Place ID" style="font-size:12px; padding:6px 8px;">
            <button class="btn btn-ghost scripts-add-place" data-id="${s.id}" style="font-size:11px; padding:6px 10px; flex-shrink:0;">Add</button>
          </div>

          <div class="stage-actions" style="margin-top:8px;">
            <button class="btn btn-ghost scripts-view" data-id="${s.id}" style="font-size:11px; padding:6px 10px;">Copy Source</button>
            <button class="btn btn-ghost scripts-rename" data-id="${s.id}" data-title="${s.title.replace(/"/g, '&quot;')}" style="font-size:11px; padding:6px 10px;">Rename</button>
            <button class="btn btn-ghost scripts-toggle" data-id="${s.id}" data-status="${s.status}" style="font-size:11px; padding:6px 10px;">${s.status === "enabled" ? "Disable" : "Enable"}</button>
            <button class="btn btn-ghost scripts-delete" data-id="${s.id}" style="font-size:11px; padding:6px 10px;">Delete</button>
          </div>
        </div>
      `;
    }).join("");

    scriptsList.querySelectorAll(".scripts-view").forEach(btn => {
      btn.addEventListener("click", async () => {
        try {
          const data = await ksFetch(`/api/admin/scripts/${btn.dataset.id}`);
          await navigator.clipboard.writeText(data.script.source).catch(() => {});
          showToast("Script source copied to clipboard", "success");
        } catch (err) { showToast(err.message, "error"); }
      });
    });
    scriptsList.querySelectorAll(".scripts-rename").forEach(btn => {
      btn.addEventListener("click", async () => {
        const newTitle = prompt("New title:", btn.dataset.title);
        if (!newTitle || !newTitle.trim() || newTitle.trim() === btn.dataset.title) return;
        try {
          await ksFetch(`/api/admin/scripts/${btn.dataset.id}`, {
            method: "PUT",
            body: JSON.stringify({ title: newTitle.trim() }),
          });
          showToast("Script renamed", "success");
          await loadScripts();
        } catch (err) { showToast(err.message, "error"); }
      });
    });
    scriptsList.querySelectorAll(".scripts-delete").forEach(btn => {
      btn.addEventListener("click", async () => {
        try {
          await ksFetch(`/api/admin/scripts/${btn.dataset.id}`, { method: "DELETE" });
          await loadScripts();
        } catch (err) { showToast(err.message, "error"); }
      });
    });
    scriptsList.querySelectorAll(".scripts-toggle").forEach(btn => {
      btn.addEventListener("click", async () => {
        const next = btn.dataset.status === "enabled" ? "disabled" : "enabled";
        try {
          await ksFetch(`/api/admin/scripts/${btn.dataset.id}/status`, {
            method: "POST",
            body: JSON.stringify({ status: next }),
          });
          await loadScripts();
        } catch (err) { showToast(err.message, "error"); }
      });
    });
    scriptsList.querySelectorAll(".scripts-add-place").forEach(btn => {
      btn.addEventListener("click", async () => {
        const input = scriptsList.querySelector(`.scripts-place-input[data-id="${btn.dataset.id}"]`);
        const placeId = input.value.trim();
        if (!placeId) return;
        try {
          await ksFetch(`/api/admin/scripts/${btn.dataset.id}/places`, {
            method: "POST",
            body: JSON.stringify({ placeId }),
          });
          await loadScripts();
        } catch (err) { showToast(err.message, "error"); }
      });
    });
    scriptsList.querySelectorAll(".scripts-remove-place").forEach(btn => {
      btn.addEventListener("click", async () => {
        try {
          await ksFetch(`/api/admin/scripts/${btn.dataset.id}/places/${encodeURIComponent(btn.dataset.place)}`, { method: "DELETE" });
          await loadScripts();
        } catch (err) { showToast(err.message, "error"); }
      });
    });
  }

  async function loadScripts() {
    try {
      const data = await ksFetch("/api/admin/scripts");
      const scripts = data.scripts || [];
      renderScripts(scripts);
      renderScriptMultiselect(scripts);
    } catch (err) {
      showToast(err.message, "error");
    }
  }

  scriptsBtnSave.addEventListener("click", async () => {
    const source = scriptsNewSource.value.trim();
    if (!source) {
      showToast("Paste a script first", "error");
      return;
    }
    try {
      await ksFetch("/api/admin/scripts", {
        method: "POST",
        body: JSON.stringify({ title: scriptsNewTitle.value.trim(), source }),
      });
      scriptsNewTitle.value = "";
      scriptsNewSource.value = "";
      showToast("Script saved", "success");
      await loadScripts();
    } catch (err) {
      showToast(err.message, "error");
    }
  });

  btnSaveScript.addEventListener("click", async () => {
    if (outputEditor.value.trim() === "") return;
    if (!ksAccessKey) {
      showToast("Unlock the Key System tab first", "error");
      document.querySelector('.tab-btn[data-tab="keysystem"]').click();
      return;
    }
    try {
      await ksFetch("/api/admin/scripts", {
        method: "POST",
        body: JSON.stringify({ title: "Obfuscator output", source: outputEditor.value }),
      });
      showToast("Saved to Scripts", "success");
    } catch (err) {
      showToast(err.message, "error");
    }
  });

  // --- Overview tab: cards + combined activity chart + bounce rate ---

  function renderOverviewCards(totals) {
    const cards = [
      { label: "Clicks", value: totals.clicks },
      { label: "Checkpoints", value: totals.checkpoints },
      { label: "Keys Generated", value: totals.keysGenerated },
      { label: "Keys Used", value: totals.keysUsed },
      { label: "Script Executions", value: totals.scriptExecutions },
    ];
    overviewCards.innerHTML = cards.map(c => `
      <div class="overview-card">
        <div class="overview-card-value">${c.value.toLocaleString()}</div>
        <div class="overview-card-label">${c.label}</div>
      </div>
    `).join("");
  }

  // Renders a simple dependency-free multi-line SVG chart so Overview
  // doesn't need to pull in a charting library.
  function renderCombinedChart(daily) {
    const width = 640;
    const height = 220;
    const padding = { top: 10, right: 10, bottom: 24, left: 34 };
    const plotW = width - padding.left - padding.right;
    const plotH = height - padding.top - padding.bottom;

    const series = [
      { key: "clicks", color: "#7aa2ff", label: "Clicks" },
      { key: "checkpoints", color: "#f2c14e", label: "Checkpoints" },
      { key: "keysGenerated", color: "#4ade80", label: "Keys Generated" },
      { key: "keysUsed", color: "#22d3ee", label: "Keys Used" },
      { key: "scriptExecutions", color: "#f87171", label: "Script Executions" },
    ];

    const maxVal = Math.max(1, ...daily.flatMap(d => series.map(s => d[s.key] || 0)));
    const n = daily.length;
    const xStep = n > 1 ? plotW / (n - 1) : 0;

    function pointsFor(key) {
      return daily.map((d, i) => {
        const x = padding.left + i * xStep;
        const y = padding.top + plotH - (d[key] / maxVal) * plotH;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      }).join(" ");
    }

    // Sparse x-axis labels so dates don't overlap on narrow screens.
    const labelEvery = Math.ceil(n / 6) || 1;
    const xLabels = daily.map((d, i) => {
      if (i % labelEvery !== 0 && i !== n - 1) return "";
      const x = padding.left + i * xStep;
      const short = d.date.slice(5); // MM-DD
      return `<text x="${x.toFixed(1)}" y="${height - 6}" font-size="9" fill="var(--muted)" text-anchor="middle">${short}</text>`;
    }).join("");

    const gridLines = [0, 0.25, 0.5, 0.75, 1].map(f => {
      const y = padding.top + plotH * (1 - f);
      const val = Math.round(maxVal * f);
      return `
        <line x1="${padding.left}" y1="${y.toFixed(1)}" x2="${width - padding.right}" y2="${y.toFixed(1)}" stroke="var(--line)" stroke-width="1" />
        <text x="${padding.left - 6}" y="${(y + 3).toFixed(1)}" font-size="9" fill="var(--muted)" text-anchor="end">${val}</text>
      `;
    }).join("");

    const lines = series.map(s => `<polyline points="${pointsFor(s.key)}" fill="none" stroke="${s.color}" stroke-width="2" />`).join("");

    const legend = series.map(s => `
      <span style="display:inline-flex; align-items:center; gap:5px; margin-right:14px; font-size:11.5px; color:var(--muted);">
        <span style="width:9px; height:9px; border-radius:2px; background:${s.color}; display:inline-block;"></span>${s.label}
      </span>
    `).join("");

    overviewChart.innerHTML = `
      <svg viewBox="0 0 ${width} ${height}" style="width:100%; height:auto; display:block;">
        ${gridLines}
        ${lines}
        ${xLabels}
      </svg>
      <div style="margin-top:8px;">${legend}</div>
    `;
  }

  function renderBounceRate(rate) {
    overviewBounce.innerHTML = `
      <div class="overview-card" style="max-width:220px;">
        <div class="overview-card-value">${rate.toFixed(1)}%</div>
        <div class="overview-card-label">Checkpoint Bounce Rate</div>
      </div>
    `;
  }

  async function loadOverview() {
    try {
      const days = overviewPeriod.value || "30";
      const data = await ksFetch(`/api/admin/analytics?days=${days}`);
      renderOverviewCards(data.totals);
      renderCombinedChart(data.daily);
      renderBounceRate(data.checkpointBounceRate);
    } catch (err) {
      showToast(err.message, "error");
    }
  }

  overviewPeriod.addEventListener("change", loadOverview);

  // --- Automatic real-time updates (polling) ---
  // Replaces manual "Refresh List" buttons: each unlocked tab refreshes
  // itself in the background, only while that tab is actually visible so
  // we're not hammering the API for panels the admin isn't looking at.
  let pollHandle = null;
  const POLL_INTERVAL_MS = 4000;

  function activeTabName() {
    const active = document.querySelector(".tab-btn.is-active");
    return active ? active.dataset.tab : null;
  }

  function startPolling() {
    if (pollHandle) return;
    pollHandle = setInterval(() => {
      if (!ksAccessKey) return;
      const tab = activeTabName();
      if (tab === "keysystem") loadKeys();
      else if (tab === "scripts") { loadScripts(); loadLoaders(); }
      else if (tab === "overview") loadOverview();
    }, POLL_INTERVAL_MS);
  }

  function stopPolling() {
    if (pollHandle) {
      clearInterval(pollHandle);
      pollHandle = null;
    }
  }

  // Refresh immediately when switching into a data tab, rather than
  // waiting for the next poll tick.
  tabButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      if (!ksAccessKey) return;
      if (btn.dataset.tab === "keysystem") loadKeys();
      else if (btn.dataset.tab === "scripts") { loadScripts(); loadLoaders(); }
      else if (btn.dataset.tab === "overview") loadOverview();
    });
  });

  // Auto-unlock silently if we already have a verified key from before
  const savedAccessKey = localStorage.getItem("zer_admin_key");
  if (savedAccessKey) {
    tryUnlock(savedAccessKey);
  } else {
    showKeySystemLocked();
  }
});
