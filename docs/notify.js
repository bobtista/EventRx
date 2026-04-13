let soundEnabled = true;
let notificationsEnabled = true;
let flashInterval = null;
const originalTitle = "EventRx";

export function setSoundEnabled(enabled) {
  soundEnabled = enabled;
}

export function getSoundEnabled() {
  return soundEnabled;
}

export function setNotificationsEnabled(enabled) {
  notificationsEnabled = enabled;
}

export function getNotificationsEnabled() {
  return notificationsEnabled;
}

export async function requestPermission() {
  if (!("Notification" in window)) return "denied";
  if (Notification.permission === "granted") return "granted";
  return Notification.requestPermission();
}

export function getPermission() {
  if (!("Notification" in window)) return "denied";
  return Notification.permission;
}

export function alertNewCrl(record, ticker, isRevision) {
  const prefix = isRevision ? "REVISED CRL" : "CRL";
  const tickerStr = ticker ? ` ($${ticker})` : "";
  const headline = `🚨 ${prefix} — ${record.company_name}${tickerStr}`;

  if (notificationsEnabled && Notification.permission === "granted") {
    new Notification(headline, {
      body: `${record.application_number} · ${record.letter_date}`,
      tag: record.event_id,
    });
  }

  if (soundEnabled) {
    playAlertSound();
  }

  startTitleFlash(ticker ? `$${ticker}` : record.company_name, isRevision);
}

function playAlertSound() {
  try {
    const audio = new Audio("alert.mp3");
    audio.volume = 0.7;
    audio.play().catch(() => {});
  } catch {
    // Audio playback can fail silently — not critical
  }
}

function startTitleFlash(label, isRevision) {
  stopTitleFlash();
  const prefix = isRevision ? "REVISED CRL" : "NEW CRL";
  const alertTitle = `🚨 ${prefix} — ${label}`;
  let showAlert = true;

  flashInterval = setInterval(() => {
    document.title = showAlert ? alertTitle : originalTitle;
    showAlert = !showAlert;
  }, 1000);

  const stopOnFocus = () => {
    stopTitleFlash();
    window.removeEventListener("focus", stopOnFocus);
  };
  window.addEventListener("focus", stopOnFocus);
}

export function stopTitleFlash() {
  if (flashInterval) {
    clearInterval(flashInterval);
    flashInterval = null;
  }
  document.title = originalTitle;
}
