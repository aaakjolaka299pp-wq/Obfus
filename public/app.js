document.addEventListener("DOMContentLoaded", () => {
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
          title: "P20 Lua Obfuscated Script",
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

      setRailState("success");

    } catch (err) {
      showToast(err.message, "error");
      outputEditor.value = "";
      btnCopy.disabled = true;
      btnDownload.disabled = true;
      btnShare.disabled = true;
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

  // --- Key System ---

  const ksAdminKeyInput = document.getElementById("ks-admin-key");
  const ksBtnCreate = document.getElementById("ks-btn-create");
  const ksBtnRefresh = document.getElementById("ks-btn-refresh");
  const ksList = document.getElementById("ks-list");
  const ksLoaderTitle = document.getElementById("ks-loader-title");
  const ksLoaderUrl = document.getElementById("ks-loader-url");
  const ksBtnLoader = document.getElementById("ks-btn-loader");
  const ksLoaderOutput = document.getElementById("ks-loader-output");
  const ksBtnLoaderCopy = document.getElementById("ks-btn-loader-copy");
  const ksBtnLoaderDownload = document.getElementById("ks-btn-loader-download");

  if (ksAdminKeyInput) {
    const saved = localStorage.getItem("p20_admin_key");
    if (saved) ksAdminKeyInput.value = saved;

    ksAdminKeyInput.addEventListener("change", () => {
      localStorage.setItem("p20_admin_key", ksAdminKeyInput.value);
    });

    async function ksFetch(path, options = {}) {
      const adminKey = ksAdminKeyInput.value.trim();
      const res = await fetch(path, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          "X-Admin-Key": adminKey,
          ...(options.headers || {}),
        },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
      return data;
    }

    function renderKeys(keys) {
      if (!keys.length) {
        ksList.innerHTML = `<div style="color:var(--muted)">No keys yet.</div>`;
        return;
      }
      ksList.innerHTML = keys.map(k => {
        const status = k.revoked ? "REVOKED" : (k.expiresAt && Date.now() > k.expiresAt ? "EXPIRED" : "ACTIVE");
        const statusColor = status === "ACTIVE" ? "var(--ok)" : "var(--warn)";
        return `
          <div style="border:1px solid var(--line); border-radius:8px; padding:10px; margin-bottom:8px;">
            <div style="display:flex; justify-content:space-between; gap:8px; flex-wrap:wrap;">
              <span>${k.key}</span>
              <span style="color:${statusColor}">${status}</span>
            </div>
            <div style="color:var(--muted); margin-top:4px;">HWID: ${k.hwid || "not bound yet"}${k.note ? " · " + k.note : ""}</div>
            <div class="stage-actions" style="margin-top:8px;">
              <button class="btn btn-ghost ks-revoke" data-key="${k.key}" style="font-size:11px; padding:6px 10px;">Revoke</button>
              <button class="btn btn-ghost ks-reset" data-key="${k.key}" style="font-size:11px; padding:6px 10px;">Reset HWID</button>
              <button class="btn btn-ghost ks-delete" data-key="${k.key}" style="font-size:11px; padding:6px 10px;">Delete</button>
            </div>
          </div>
        `;
      }).join("");

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

    ksBtnCreate.addEventListener("click", async () => {
      try {
        const data = await ksFetch("/api/admin/keys", { method: "POST", body: JSON.stringify({}) });
        await navigator.clipboard.writeText(data.key.key).catch(() => {});
        showToast(`Key created & copied: ${data.key.key}`, "success");
        await loadKeys();
      } catch (err) {
        showToast(err.message, "error");
      }
    });

    ksBtnRefresh.addEventListener("click", loadKeys);

    ksBtnLoader.addEventListener("click", async () => {
      const scriptUrl = ksLoaderUrl.value.trim();
      if (!scriptUrl) {
        showToast("Enter the obfuscated script's raw URL first", "error");
        return;
      }
      try {
        const res = await fetch("/api/loader/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scriptUrl, title: ksLoaderTitle.value.trim() }),
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

    if (ksAdminKeyInput.value) loadKeys();
  }
});
