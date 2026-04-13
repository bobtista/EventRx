import { lookupTicker } from "./tickers.js";
import * as store from "./store.js";
import { fetchRecent, fetchAllPaginated } from "./poller.js";
import {
  alertNewCrl,
  requestPermission,
  getPermission,
  setSoundEnabled,
  getSoundEnabled,
  setNotificationsEnabled,
  getNotificationsEnabled,
  stopTitleFlash,
} from "./notify.js";

const POLL_INTERVAL_MS = 60_000;
let lastCheckedAt = null;
let lastCheckedTimer = null;
let allEvents = [];
let currentSort = { field: "letter_date", desc: true };

// --- Initialization ---

async function init() {
  await store.openDB();
  setupToggles();
  setupSearch();
  startLastCheckedTimer();

  const eventCount = await store.count();
  if (eventCount === 0) {
    setStatus("Backfilling...", false);
    await backfill();
  }

  await loadHistory();
  showNotifPromptIfNeeded();
  poll();
  setInterval(poll, POLL_INTERVAL_MS);

  // TODO: REMOVE — test alert fires 5s after load, switch away to see notification
  setTimeout(() => {
    const testRecord = {
      company_name: "Test Corp",
      ticker: "TEST",
      application_number: "BLA 999999",
      letter_date: "04/13/2026",
      event_id: "test-" + Date.now(),
      pdf_url: "#",
      is_revision: false,
    };
    renderAlertCard(testRecord);
    alertNewCrl(testRecord, "TEST", false);
  }, 5000);
}

// --- Backfill ---

async function backfill() {
  const now = new Date().toISOString();
  await fetchAllPaginated(async (page) => {
    const records = page.map((r) => ({
      ...r,
      ticker: lookupTicker(r.company_name) ?? null,
      status: "seen_backfill",
      seen_at: now,
      is_revision: false,
    }));
    await store.bulkInsert(records);
  });
  setStatus("Watching", true);
}

// --- Poll cycle ---

async function poll() {
  try {
    const records = await fetchRecent();
    lastCheckedAt = Date.now();

    for (const record of records) {
      const { isNew, isRevision } = await store.isNewOrRevised(
        record.event_id,
        record.text_hash
      );
      if (!isNew) continue;

      const ticker = lookupTicker(record.company_name);
      const enriched = {
        ...record,
        ticker: ticker ?? null,
        status: "notified",
        seen_at: new Date().toISOString(),
        is_revision: isRevision,
      };
      await store.upsert(enriched);
      renderAlertCard(enriched);
      alertNewCrl(record, ticker, isRevision);
    }

    await loadHistory();
    setStatus("Watching", true);
  } catch (err) {
    console.error("Poll error:", err);
    setStatus("Error — retrying", false);
  }
}

// --- UI Rendering ---

function renderAlertCard(record) {
  const alerts = document.getElementById("alerts");
  const card = document.createElement("div");
  card.className = `alert-card${record.is_revision ? " revision" : ""}`;

  const label = record.is_revision
    ? "⚠️ Revised Complete Response Letter"
    : "🚨 New Complete Response Letter";

  const tickerHtml = record.ticker
    ? ` <span class="alert-ticker">$${escapeHtml(record.ticker)}</span>`
    : "";

  card.innerHTML = `
    <div>
      <div class="alert-label">${label}</div>
      <div class="alert-company">${escapeHtml(record.company_name)}${tickerHtml}</div>
      <div class="alert-details">${escapeHtml(record.application_number)} · Letter date: ${escapeHtml(record.letter_date)}</div>
      <div class="alert-pdf"><a href="${escapeHtml(record.pdf_url)}" target="_blank" rel="noopener">📄 Open CRL PDF ↗</a></div>
    </div>
    <button class="dismiss-btn">Dismiss</button>
  `;

  card.querySelector(".dismiss-btn").addEventListener("click", () => {
    card.remove();
    stopTitleFlash();
  });

  alerts.prepend(card);
}

async function loadHistory() {
  allEvents = await store.queryAll();
  renderHistory();
}

function renderHistory() {
  const searchTerm = document.getElementById("search-input").value.toLowerCase();
  let filtered = allEvents;

  if (searchTerm) {
    filtered = allEvents.filter(
      (e) =>
        (e.company_name || "").toLowerCase().includes(searchTerm) ||
        (e.ticker || "").toLowerCase().includes(searchTerm)
    );
  }

  filtered.sort((a, b) => {
    const aVal = a[currentSort.field] || "";
    const bVal = b[currentSort.field] || "";
    let cmp;
    if (currentSort.field === "letter_date") {
      // Dates are MM/DD/YYYY — parse to comparable timestamps
      const aTime = Date.parse(aVal) || 0;
      const bTime = Date.parse(bVal) || 0;
      cmp = aTime - bTime;
    } else {
      cmp = aVal.localeCompare(bVal);
    }
    return currentSort.desc ? -cmp : cmp;
  });

  document.getElementById("event-count").textContent = `${filtered.length} events`;

  const tbody = document.getElementById("history-body");
  tbody.innerHTML = "";

  for (const ev of filtered) {
    const tr = document.createElement("tr");
    const tickerCell = ev.ticker
      ? `<td class="ticker-cell">$${escapeHtml(ev.ticker)}</td>`
      : `<td class="ticker-unknown">—</td>`;

    tr.innerHTML = `
      <td>${escapeHtml(ev.letter_date)}</td>
      <td><strong>${escapeHtml(ev.company_name)}</strong></td>
      ${tickerCell}
      <td style="color:#aaa">${escapeHtml(ev.application_number)}</td>
      <td><a class="pdf-link" href="${escapeHtml(ev.pdf_url)}" target="_blank" rel="noopener">📄 Open ↗</a></td>
    `;
    tbody.appendChild(tr);
  }
}

// --- Header controls ---

function setStatus(text, ok) {
  const pill = document.getElementById("status-pill");
  pill.textContent = `● ${text}`;
  pill.className = ok ? "status-pill" : "status-pill error";
}

function startLastCheckedTimer() {
  const el = document.getElementById("last-checked");
  lastCheckedTimer = setInterval(() => {
    if (!lastCheckedAt) {
      el.textContent = "Last checked: —";
      return;
    }
    const seconds = Math.round((Date.now() - lastCheckedAt) / 1000);
    el.textContent = `Last checked: ${seconds}s ago`;
  }, 1000);
}

function setupToggles() {
  const notifBtn = document.getElementById("notif-toggle");
  const soundBtn = document.getElementById("sound-toggle");

  notifBtn.addEventListener("click", () => {
    const enabled = !getNotificationsEnabled();
    setNotificationsEnabled(enabled);
    notifBtn.textContent = enabled ? "🔔 Notifications" : "🔕 Notifications";
    notifBtn.classList.toggle("off", !enabled);
  });

  soundBtn.addEventListener("click", () => {
    const enabled = !getSoundEnabled();
    setSoundEnabled(enabled);
    soundBtn.textContent = enabled ? "🔊 Sound" : "🔇 Sound";
    soundBtn.classList.toggle("off", !enabled);
  });
}

function setupSearch() {
  const input = document.getElementById("search-input");
  input.addEventListener("input", () => renderHistory());

  document.querySelectorAll("#history-table thead th[data-sort]").forEach((th) => {
    th.addEventListener("click", () => {
      const field = th.dataset.sort;
      if (currentSort.field === field) {
        currentSort.desc = !currentSort.desc;
      } else {
        currentSort = { field, desc: true };
      }
      renderHistory();
    });
  });
}

function showNotifPromptIfNeeded() {
  if (getPermission() !== "default") return;
  const prompt = document.getElementById("notif-prompt");
  prompt.classList.remove("hidden");

  document.getElementById("enable-notif-btn").addEventListener("click", async () => {
    await requestPermission();
    prompt.classList.add("hidden");
  });

  document.getElementById("dismiss-notif-btn").addEventListener("click", () => {
    prompt.classList.add("hidden");
  });
}

// --- Utilities ---

function escapeHtml(str) {
  if (!str) return "";
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// --- Start ---

init();
