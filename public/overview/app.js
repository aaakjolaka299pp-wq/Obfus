document.addEventListener("DOMContentLoaded", () => {

  // --- Toasts ---
  const toastRegion = document.getElementById("ov-toast-region");
  function showToast(message) {
    const toast = document.createElement("div");
    toast.className = "ov-toast";
    toast.textContent = message;
    toastRegion.appendChild(toast);
    setTimeout(() => toast.remove(), 4500);
  }

  // --- Scroll reveal ---
  const revealEls = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1 });
    revealEls.forEach((el) => observer.observe(el));
  } else {
    revealEls.forEach((el) => el.classList.add("is-visible"));
  }

  // --- State ---
  let currentDays = 30;
  let currentData = null;
  const activeMetrics = new Set(["clicks", "checkpoints", "keys", "total", "success"]);

  const METRIC_COLORS = {
    clicks: "var(--ov-orange)",
    checkpoints: "var(--ov-green)",
    keys: "var(--ov-gold)",
    total: "var(--ov-magenta)",
    success: "var(--ov-cyan)",
  };

  const METRIC_FIELD = {
    clicks: "clicks",
    checkpoints: "checkpoints",
    keys: "keysGenerated",
    total: "scriptExecutions",
    success: "successfulExecutions",
  };

  // --- Period pills ---
  const periodPills = document.querySelectorAll(".ov-period-pill");
  periodPills.forEach((pill) => {
    pill.addEventListener("click", () => {
      const days = parseInt(pill.dataset.days, 10);
      if (days === currentDays) return;
      periodPills.forEach((p) => {
        p.classList.toggle("is-active", p === pill);
        p.setAttribute("aria-selected", String(p === pill));
      });
      currentDays = days;
      loadOverview();
    });
  });

  // --- Metric pills (Combined Metrics) ---
  document.querySelectorAll(".ov-metric-pill").forEach((pill) => {
    pill.addEventListener("click", () => {
      const metric = pill.dataset.metric;
      if (activeMetrics.has(metric)) {
        if (activeMetrics.size === 1) return; // keep at least one metric visible
        activeMetrics.delete(metric);
      } else {
        activeMetrics.add(metric);
      }
      pill.classList.toggle("is-active", activeMetrics.has(metric));
      if (currentData) renderCombinedChart(currentData);
    });
  });

  // --- Segmented control (Integration / Provider) ---
  // Both segments currently read from the same per-provider bounce data —
  // "Integration" and "Provider" are the same underlying breakdown until
  // there's a real distinction between the two in the data model. Switching
  // re-renders so the control isn't a dead click.
  document.querySelectorAll(".ov-segment").forEach((seg) => {
    seg.addEventListener("click", () => {
      document.querySelectorAll(".ov-segment").forEach((s) => {
        s.classList.toggle("is-active", s === seg);
        s.setAttribute("aria-selected", String(s === seg));
      });
      if (currentData) renderBounceSection(currentData);
    });
  });

  // --- Formatting helpers ---
  function formatCompact(n) {
    if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "K";
    return String(n);
  }

  function formatDeltaBadge(current, previous) {
    if (previous === 0) {
      return current > 0 ? "100%" : "0%";
    }
    const pct = ((current - previous) / previous) * 100;
    const sign = pct >= 0 ? "+" : "";
    return `${sign}${pct >= 1000 || pct <= -1000 ? Math.round(pct).toLocaleString() : pct.toFixed(1)}%`;
  }

  function formatDateShort(dateStr) {
    const d = new Date(dateStr + "T00:00:00Z");
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  }

  // --- Sparkline (small per-card charts) ---
  function renderSparkline(svg, values, color) {
    if (!svg) return;
    const w = 400, h = svg.classList.contains("ov-sparkline") && svg.closest(".ov-exec-card") ? 130 : 100;
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    const max = Math.max(1, ...values);
    const n = values.length;
    const stepX = n > 1 ? w / (n - 1) : 0;
    const points = values.map((v, i) => {
      const x = i * stepX;
      const y = h - (v / max) * (h - 6) - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ");
    const areaPoints = `0,${h} ${points} ${w},${h}`;
    svg.innerHTML = `
      <polygon points="${areaPoints}" fill="${color}" opacity="0.14"></polygon>
      <polyline points="${points}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"></polyline>
    `;
  }

  // --- Conversion funnel cards ---
  function renderFunnelCards(data) {
    const grid = document.getElementById("ov-funnel-grid");
    const cards = [
      { key: "clicks", label: "Clicks", color: "var(--ov-orange)" },
      { key: "checkpoints", label: "Checkpoints", color: "var(--ov-green)" },
      { key: "keysGenerated", label: "Keys Generated", color: "var(--ov-red)" },
      { key: "keysUsed", label: "Keys Used", color: "var(--ov-gold)" },
    ];

    grid.innerHTML = cards.map((c) => {
      const value = data.totals[c.key];
      const prevValue = data.previousTotals[c.key] ?? 0;
      const badge = formatDeltaBadge(value, prevValue);
      return `
        <article class="ov-funnel-card">
          <span class="ov-card-label">${c.label}</span>
          <div class="ov-card-value">${value.toLocaleString()}</div>
          <span class="ov-badge ov-badge-orange" style="color:${c.color}; background:color-mix(in oklab, ${c.color} 16%, transparent);">${badge}</span>
          <div class="ov-sparkline-wrap">
            <svg viewBox="0 0 400 100" preserveAspectRatio="none" class="ov-sparkline" id="spark-${c.key}"></svg>
          </div>
        </article>
      `;
    }).join("");

    cards.forEach((c) => {
      const svg = document.getElementById(`spark-${c.key}`);
      const values = data.daily.map((d) => d[c.key]);
      renderSparkline(svg, values, c.color);
    });
  }

  // --- Script executions card ---
  function renderExecCard(data) {
    const value = data.totals.scriptExecutions;
    const prevValue = data.previousTotals.scriptExecutions ?? 0;
    document.getElementById("ov-exec-value").textContent = formatCompact(value);
    document.getElementById("ov-exec-badge").textContent = formatDeltaBadge(value, prevValue).replace("%", "×").replace("+", "");
    const svg = document.getElementById("ov-exec-chart");
    const values = data.daily.map((d) => d.scriptExecutions);
    renderSparkline(svg, values, "var(--ov-magenta)");
  }

  // --- Combined metrics chart (multi-line with tooltip) ---
  function renderCombinedChart(data) {
    const svg = document.getElementById("ov-combined-chart");
    const tooltip = document.getElementById("ov-chart-tooltip");
    const width = 800, height = 320;
    const padding = { top: 16, right: 12, bottom: 28, left: 34 };
    const plotW = width - padding.left - padding.right;
    const plotH = height - padding.top - padding.bottom;

    const daily = data.daily;
    const n = daily.length;
    const xStep = n > 1 ? plotW / (n - 1) : 0;

    const series = Object.keys(METRIC_FIELD)
      .filter((m) => activeMetrics.has(m))
      .map((m) => ({
        key: m,
        color: METRIC_COLORS[m],
        values: daily.map((d) => d[METRIC_FIELD[m]]),
      }));

    const maxVal = Math.max(1, ...series.flatMap((s) => s.values));

    function pointsFor(values) {
      return values.map((v, i) => {
        const x = padding.left + i * xStep;
        const y = padding.top + plotH - (v / maxVal) * plotH;
        return [x, y];
      });
    }

    const gridLines = [0, 0.25, 0.5, 0.75, 1].map((f) => {
      const y = padding.top + plotH * (1 - f);
      const val = Math.round(maxVal * f);
      return `
        <line x1="${padding.left}" y1="${y.toFixed(1)}" x2="${width - padding.right}" y2="${y.toFixed(1)}" stroke="var(--ov-border)" stroke-width="1" stroke-dasharray="3,4" />
        <text x="${padding.left - 8}" y="${(y + 4).toFixed(1)}" font-size="10" fill="var(--ov-muted-2)" text-anchor="end">${val}</text>
      `;
    }).join("");

    const labelEvery = Math.ceil(n / 6) || 1;
    const xLabels = daily.map((d, i) => {
      if (i % labelEvery !== 0 && i !== n - 1) return "";
      const x = padding.left + i * xStep;
      return `<text x="${x.toFixed(1)}" y="${height - 8}" font-size="10" fill="var(--ov-muted-2)" text-anchor="middle">${formatDateShort(d.date)}</text>`;
    }).join("");

    const lines = series.map((s) => {
      const pts = pointsFor(s.values);
      const linePath = pts.map((p) => p.join(",")).join(" ");
      const areaPath = `${padding.left},${padding.top + plotH} ${linePath} ${width - padding.right},${padding.top + plotH}`;
      return `
        <polygon points="${areaPath}" fill="${s.color}" opacity="0.08"></polygon>
        <polyline points="${linePath}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" data-series="${s.key}"></polyline>
      `;
    }).join("");

    // Invisible hit-columns for touch/hover tooltips, one per day.
    const hitColumns = daily.map((d, i) => {
      const x = padding.left + i * xStep;
      const colW = xStep || plotW;
      return `<rect x="${(x - colW / 2).toFixed(1)}" y="0" width="${colW.toFixed(1)}" height="${height}" fill="transparent" data-index="${i}" class="ov-hit-col"></rect>`;
    }).join("");

    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.innerHTML = `${gridLines}${lines}${xLabels}${hitColumns}`;

    svg.querySelectorAll(".ov-hit-col").forEach((col) => {
      const showTooltip = (clientX, clientY) => {
        const i = parseInt(col.dataset.index, 10);
        const d = daily[i];
        const rect = svg.getBoundingClientRect();
        const lines = series.map((s) => `${s.key}: ${d[METRIC_FIELD[s.key]]}`).join(" · ");
        tooltip.innerHTML = `<strong>${formatDateShort(d.date)}</strong><br>${lines}`;
        tooltip.hidden = false;
        tooltip.style.left = `${clientX - rect.left}px`;
        tooltip.style.top = `${clientY - rect.top}px`;
      };
      col.addEventListener("mousemove", (e) => showTooltip(e.clientX, e.clientY));
      col.addEventListener("mouseleave", () => { tooltip.hidden = true; });
      col.addEventListener("touchstart", (e) => {
        const t = e.touches[0];
        showTooltip(t.clientX, t.clientY);
      }, { passive: true });
    });

    document.addEventListener("touchend", () => { tooltip.hidden = true; }, { passive: true });
  }

  // --- Conversion summary pills ---
  function renderConversionSummary(data) {
    const checkpointConv = data.totals.clicks > 0
      ? ((data.totals.checkpoints / data.totals.clicks) * 100).toFixed(1) + "%"
      : "0%";
    // Key conversion = of the distinct checkpoint sessions, how many
    // actually resulted in a key — NOT keysGenerated / checkpoints, since
    // keysGenerated also counts admin-issued keys with no checkpoint
    // session behind them at all (that ratio can exceed 100% and would
    // be meaningless here).
    const keyConv = data.checkpointSessions > 0
      ? ((data.checkpointSessionsCompleted / data.checkpointSessions) * 100).toFixed(1) + "%"
      : "0%";
    document.getElementById("ov-checkpoint-conv").textContent = checkpointConv;
    document.getElementById("ov-key-conv").textContent = keyConv;
  }

  // --- Bounce rate section (stats, highlight card, ranking, trend) ---
  function renderBounceSection(data) {
    const providers = data.bounceByProvider || [];
    const totalOpened = providers.reduce((sum, p) => sum + p.opened, 0);
    const totalCompleted = providers.reduce((sum, p) => sum + p.completed, 0);
    const totalLost = providers.reduce((sum, p) => sum + p.usersLost, 0);

    document.getElementById("ov-opened-value").textContent = totalOpened.toLocaleString();
    document.getElementById("ov-completed-value").textContent = totalCompleted.toLocaleString();
    document.getElementById("ov-bounce-value").textContent = `${data.checkpointBounceRate}%`;

    // "vs first half": compare bounce rate of the first half of the daily
    // buckets against the second half, using checkpoints as the proxy
    // activity signal, so the delta reflects a real trend within the
    // period rather than a fabricated number.
    const half = Math.floor(data.daily.length / 2) || 1;
    const firstHalf = data.daily.slice(0, half);
    const secondHalf = data.daily.slice(half);
    const sum = (arr, key) => arr.reduce((s, d) => s + d[key], 0);
    const rate = (arr) => {
      const cp = sum(arr, "checkpoints");
      const kg = sum(arr, "keysGenerated");
      return cp > 0 ? ((cp - kg) / cp) * 100 : 0;
    };
    const deltaPP = rate(secondHalf) - rate(firstHalf);
    const deltaEl = document.getElementById("ov-bounce-delta");
    if (data.totals.checkpoints > 0) {
      const arrow = deltaPP >= 0 ? "↗" : "↘";
      deltaEl.textContent = `${arrow} ${deltaPP >= 0 ? "+" : ""}${deltaPP.toFixed(1)} pp vs. first half`;
    } else {
      deltaEl.textContent = "Not enough data yet";
    }

    // Highest bounce rate highlight card
    const highlightCard = document.getElementById("ov-highest-bounce-card");
    if (providers.length > 0) {
      const top = providers[0];
      highlightCard.hidden = false;
      document.getElementById("ov-highest-name").textContent = top.provider;
      document.getElementById("ov-highest-pct").textContent = `${top.bounceRate}%`;
      document.getElementById("ov-highest-users").textContent = `${top.usersLost} users lost`;
    } else {
      highlightCard.hidden = true;
    }

    // Ranked list
    document.getElementById("ov-rank-total").textContent = `${totalLost.toLocaleString()} users lost total`;
    const rankList = document.getElementById("ov-rank-list");
    if (providers.length === 0) {
      rankList.innerHTML = `<p class="ov-empty-note">No checkpoint sessions recorded yet for this period.</p>`;
    } else {
      const maxRate = Math.max(...providers.map((p) => p.bounceRate), 1);
      rankList.innerHTML = providers.map((p, i) => `
        <div class="ov-rank-row">
          <span class="ov-rank-num">${i + 1}</span>
          <div class="ov-rank-main">
            <div class="ov-rank-top">
              <span class="ov-rank-name">${p.provider}</span>
              <span class="ov-rank-lost">${p.usersLost} lost</span>
            </div>
            <div class="ov-rank-bar-track">
              <div class="ov-rank-bar-fill" style="width:${(p.bounceRate / maxRate) * 100}%"></div>
            </div>
          </div>
          <span class="ov-rank-pct">${p.bounceRate}%</span>
        </div>
      `).join("");
    }

    renderTrendChart(data);
  }

  // --- Bounce rate trend chart ---
  function renderTrendChart(data) {
    const svg = document.getElementById("ov-trend-chart");
    const width = 800, height = 260;
    const padding = { top: 14, right: 12, bottom: 26, left: 40 };
    const plotW = width - padding.left - padding.right;
    const plotH = height - padding.top - padding.bottom;

    // Daily bounce rate proxy: (checkpoints - keysGenerated) / checkpoints
    // for days with checkpoint activity; days with none hold the previous
    // known value so the line doesn't fall to zero for gaps.
    const daily = data.daily;
    let lastRate = data.checkpointBounceRate;
    const rates = daily.map((d) => {
      if (d.checkpoints > 0) {
        lastRate = Math.max(0, Math.min(100, ((d.checkpoints - d.keysGenerated) / d.checkpoints) * 100));
      }
      return lastRate;
    });

    const n = daily.length;
    const xStep = n > 1 ? plotW / (n - 1) : 0;
    const points = rates.map((r, i) => {
      const x = padding.left + i * xStep;
      const y = padding.top + plotH - (r / 100) * plotH;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ");
    const areaPoints = `${padding.left},${padding.top + plotH} ${points} ${width - padding.right},${padding.top + plotH}`;

    const gridLines = [0, 25, 50, 75, 100].map((v) => {
      const y = padding.top + plotH - (v / 100) * plotH;
      return `
        <line x1="${padding.left}" y1="${y.toFixed(1)}" x2="${width - padding.right}" y2="${y.toFixed(1)}" stroke="var(--ov-border)" stroke-width="1" stroke-dasharray="3,4" />
        <text x="${padding.left - 8}" y="${(y + 4).toFixed(1)}" font-size="10" fill="var(--ov-muted-2)" text-anchor="end">${v}%</text>
      `;
    }).join("");

    const labelEvery = Math.ceil(n / 5) || 1;
    const xLabels = daily.map((d, i) => {
      if (i % labelEvery !== 0 && i !== n - 1) return "";
      const x = padding.left + i * xStep;
      return `<text x="${x.toFixed(1)}" y="${height - 6}" font-size="10" fill="var(--ov-muted-2)" text-anchor="middle">${formatDateShort(d.date)}</text>`;
    }).join("");

    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.innerHTML = `
      ${gridLines}
      <polygon points="${areaPoints}" fill="var(--ov-gold)" opacity="0.16"></polygon>
      <polyline points="${points}" fill="none" stroke="var(--ov-gold)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"></polyline>
      ${xLabels}
    `;
  }

  // --- Header meta (date range, sub-labels) ---
  function renderMeta(data) {
    const daily = data.daily;
    if (daily.length > 0) {
      const start = formatDateShort(daily[0].date);
      const end = formatDateShort(daily[daily.length - 1].date);
      document.getElementById("ov-date-range").textContent = `${start} - ${end}`;
    }
    document.getElementById("ov-funnel-sub").textContent = `${currentDays}-day history · compare 7/14 days`;
    document.getElementById("ov-combined-sub").textContent = `Showing activity over the last ${currentDays} days`;
    document.getElementById("ov-updated-when").textContent = "just now";
  }

  // --- Main load ---
  async function loadOverview() {
    try {
      const res = await fetch(`/api/overview?days=${currentDays}`);
      if (!res.ok) throw new Error(`Server responded ${res.status}`);
      const data = await res.json();
      currentData = data;

      renderMeta(data);
      renderFunnelCards(data);
      renderExecCard(data);
      renderConversionSummary(data);
      renderCombinedChart(data);
      renderBounceSection(data);
    } catch (err) {
      showToast(`Couldn't load analytics: ${err.message}`);
    }
  }

  loadOverview();

  // Keep "Updated just now" honest by refreshing quietly in the background,
  // matching the live-dashboard feel from the reference without requiring
  // a manual refresh button.
  setInterval(loadOverview, 30_000);

});
