let statusEl, logEl;

export function initUtils(elements) {
  statusEl = elements.statusEl;
  logEl = elements.logEl;
}

export function log(msg) {
  const time = new Date().toLocaleTimeString();
  logEl.textContent += `[${time}] ${msg}\n`;
  logEl.scrollTop = logEl.scrollHeight;
}

export function setStatus(text, className) {
  statusEl.textContent = text;
  statusEl.className = className || "";
}

export function getStatusText() {
  return statusEl.textContent;
}

export function formatDateTime(isoString) {
  const d = new Date(isoString);
  const date = d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return `${date} ${time}`;
}

export function formatTime(unixTimestamp) {
  const d = new Date(unixTimestamp * 1000);
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

export function sanitizeG2Name(name) {
  if (!name) return "Unknown";
  let clean = String(name).trim();
  if (!clean) return "Unknown";
  if (clean.length > 55) clean = clean.slice(0, 55);
  return clean;
}

export function renderIconToCanvas(canvas, iconData) {
  const bytes = new Uint8Array(iconData.data);
  const blob = new Blob([bytes], { type: "image/png" });
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.onload = () => {
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, 24, 24);
    URL.revokeObjectURL(url);
  };
  img.src = url;
}
