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
  const ksNewKeyScript = document.getElementById("ks-new-key-script");
  const ksBtnRefresh = document.getElementById("ks-btn-refresh");
  const ksBtnLogout = document.getElementById("ks-btn-logout");
  const ksList = document.getElementById("ks-list");
  const ksLoaderTitle = document.getElementById("ks-loader-title");
  const ksLoaderScript = document.getElementById("ks-loader-script");
  const ksBtnLoader = document.getElementById("ks-btn-loader");
  const ksLoaderOutput = document.getElementById("ks-loader-output");
  const ksBtnLoaderCopy = document.getElementById("ks-btn-loader-copy");
  const ksBtnLoaderDownload = document.getElementById("ks-btn-loader-download");

  const settingsStatus = document.getElementById("settings-status");
  const settingsBtnLogout = document.getElementById("settings-btn-logout");

  const scriptsGate = document.getElementById("scripts-gate");
  const scriptsContent = document.getElementById("scripts-content");
  const scriptsBtnRefresh = document.getElementById("scripts-btn-refresh");
  const scriptsList = document.getElementById("scripts-list");
  const scriptsNewTitle = document.getElementById("scripts-new-title");
  const scriptsNewSource = document.getElementById("scripts-new-source");
  const scriptsBtnSave = document.getElementById("scripts-btn-save");
  const btnSaveScript = document.getElementById("btn-save-script");

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
    if (settingsStatus) settingsStatus.innerText = "Key System: locked";
  }

  function showKeySystemUnlocked() {
    ksGate.style.display = "none";
    ksContent.style.display = "";
    scriptsGate.style.display = "none";
    scriptsContent.style.display = "";
    if (settingsStatus) settingsStatus.innerText = "Key System: unlocked";
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
      return `
        <div style="border:1px solid var(--line); border-radius:8px; padding:10px; margin-bottom:8px;">
          <div style="display:flex; justify-content:space-between; gap:8px; flex-wrap:wrap; align-items:center;">
            <span style="word-break:break-all;">${k.key}</span>
            <span style="display:flex; align-items:center; gap:8px; flex-shrink:0;">
              <button class="ks-copy-key" data-key="${k.key}" style="background:none; border:none; color:var(--signal); cursor:pointer; font-size:11px; padding:0;">Copy</button>
              <span style="color:${statusColor}">${status}</span>
            </span>
          </div>
          <div style="color:var(--muted); margin-top:4px;">${k.note ? k.note + " · " : ""}Script: ${k.scriptId || "any"} · Uses: ${k.uses || 0}</div>

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
      const scriptId = ksNewKeyScript.value || undefined;
      const rawLimit = ksNewKeyHwidLimit.value.trim();
      const hwidLimit = rawLimit === "" ? null : parseInt(rawLimit, 10);
      const data = await ksFetch("/api/admin/keys", { method: "POST", body: JSON.stringify({ scriptId, hwidLimit }) });
      await navigator.clipboard.writeText(data.key.key).catch(() => {});
      showToast(`Key created & copied: ${data.key.key}`, "success");
      await loadKeys();
    } catch (err) {
      showToast(err.message, "error");
    }
  });

  ksBtnRefresh.addEventListener("click", loadKeys);

  ksBtnLoader.addEventListener("click", async () => {
    try {
      const res = await fetch("/api/loader/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: ksLoaderTitle.value.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to generate loader");
      ksLoaderOutput.value = data.loader;
      ksBtnLoaderCopy.disabled = false;
      ksBtnLoaderDownload.disabled = false;
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

      const currentValue = ksNewKeyScript.value;
      ksNewKeyScript.innerHTML = `<option value="">Any script</option>` +
        scripts.map(s => `<option value="${s.id}">${s.title} (${s.id})</option>`).join("");
      ksNewKeyScript.value = currentValue;

      const currentLoaderValue = ksLoaderScript.value;
      ksLoaderScript.innerHTML = `<option value="">— none —</option>` +
        scripts.map(s => `<option value="${s.id}">${s.title}</option>`).join("");
      ksLoaderScript.value = currentLoaderValue;
    } catch (err) {
      showToast(err.message, "error");
    }
  }

  ksLoaderScript.addEventListener("change", () => {
    const selected = ksLoaderScript.selectedOptions[0];
    if (selected && selected.value) {
      ksLoaderTitle.value = selected.textContent;
    }
  });

  scriptsBtnRefresh.addEventListener("click", loadScripts);

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

  // Auto-unlock silently if we already have a verified key from before
  const savedAccessKey = localStorage.getItem("zer_admin_key");
  if (savedAccessKey) {
    tryUnlock(savedAccessKey);
  } else {
    showKeySystemLocked();
  }
});
