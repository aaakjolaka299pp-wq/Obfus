document.addEventListener("DOMContentLoaded", () => {
  const inputEditor = document.getElementById("input-editor");
  const outputEditor = document.getElementById("output-editor");

  const optRename = document.getElementById("opt-rename");
  const optPreserve = document.getElementById("opt-preserve");
  const optEncode = document.getElementById("opt-encode");
  const optScramble = document.getElementById("opt-scramble");
  const optOneLine = document.getElementById("opt-oneline");
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
});
