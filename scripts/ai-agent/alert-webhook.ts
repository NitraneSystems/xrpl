/**
 * Alert webhook stub + optional local recorder HTTP server.
 */
import * as dotenv from "dotenv";
import { createServer } from "http";
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
dotenv.config({ path: join(ROOT, ".env") });

const ALERT_DIR = join(ROOT, "scripts/.alerts");
const PORT = Number(process.env.MIRROR_ALERT_PORT ?? 8790);

export type MirrorAlert = {
  type: "drift" | "liquidation_risk" | "topup_executed" | "info";
  lead?: string;
  follower?: string;
  message: string;
  meta?: Record<string, unknown>;
  at: string;
};

const alerts: MirrorAlert[] = [];

export async function sendAlert(alert: Omit<MirrorAlert, "at"> & { at?: string }) {
  const full: MirrorAlert = { ...alert, at: alert.at ?? new Date().toISOString() };
  alerts.push(full);
  mkdirSync(ALERT_DIR, { recursive: true });
  const json = JSON.stringify(
    alerts.slice(-50),
    (_k, v) => (typeof v === "bigint" ? v.toString() : v),
    2,
  );
  writeFileSync(join(ALERT_DIR, "latest.json"), json);

  const url = process.env.MIRROR_ALERT_WEBHOOK_URL;
  if (url) {
    try {
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(full, (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
      });
    } catch (e) {
      console.warn("webhook post failed", e);
    }
  }
  return full;
}

export function getAlerts(): MirrorAlert[] {
  if (existsSync(join(ALERT_DIR, "latest.json"))) {
    return JSON.parse(readFileSync(join(ALERT_DIR, "latest.json"), "utf8")) as MirrorAlert[];
  }
  return [...alerts];
}

function startRecorder() {
  const server = createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    if (urlPath(req) === "/alerts") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(getAlerts()));
      return;
    }
    if (urlPath(req) === "/alert" && req.method === "POST") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", async () => {
        const j = JSON.parse(body || "{}");
        const a = await sendAlert(j);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(a));
      });
      return;
    }
    res.writeHead(404);
    res.end("not found");
  });
  server.listen(PORT, "127.0.0.1", () => {
    console.log(`Alert recorder http://127.0.0.1:${PORT}/alerts`);
  });
}

function urlPath(req: { url?: string | null }) {
  return new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`).pathname;
}

if (process.argv[1]?.includes("alert-webhook")) {
  startRecorder();
}
