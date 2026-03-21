import express from "express";
import { fileURLToPath } from "url";
import path from "path";
import type { Messenger } from "./messengers/types.js";
import { createApiRouter } from "./routes/api.js";
import { createSettingsRouter } from "./routes/settings.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Shared server state ---
let activeMessenger: Messenger | null = null;

export function getActiveMessenger(): Messenger | null {
  return activeMessenger;
}

export function setActiveMessenger(m: Messenger): void {
  activeMessenger = m;
}

// --- Express app ---
const app = express();

// DEV-only: redirect root to meeting-assistant overlay when integration is enabled
if (process.env.DEV_MEETING_ASSISTANT_OVERLAY === "true") {
  const overlayUrl =
    process.env.MEETING_ASSISTANT_OVERLAY_URL ??
    "http://localhost:3000/even-hub/overlay";
  const port = process.env.PORT || "3000";

  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      bridgeMode: true,
      overlayUrl: process.env.MEETING_ASSISTANT_OVERLAY_URL ?? null,
    });
  });

  app.get("/", (req, res) => {
    const proto =
      req.protocol === "https" || req.get("x-forwarded-proto") === "https"
        ? "wss"
        : "ws";
    const host = req.get("x-forwarded-host") || req.get("host") || `localhost:${port}`;
    const url = new URL(overlayUrl);
    url.searchParams.set("bridgeWsUrl", `${proto}://${host}/ws`);
    for (const [k, v] of Object.entries(req.query)) {
      if (typeof v === "string") url.searchParams.set(k, v);
    }
    res.redirect(url.toString());
  });
}

const noCacheHtml: express.RequestHandler = (_req, res, next) => {
  if (_req.path === "/" || _req.path.endsWith(".html")) {
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
  }
  next();
};

const publicDir = path.join(__dirname, "public");
const srcPublicDir = path.resolve(__dirname, "..", "src", "public");
app.use(noCacheHtml);
app.use(express.static(publicDir));
app.use(express.static(srcPublicDir));
app.use(express.json());
app.use("/api/settings", createSettingsRouter());
app.use("/api", createApiRouter(() => activeMessenger));

export default app;
