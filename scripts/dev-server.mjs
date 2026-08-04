#!/usr/bin/env node
/* ---------------------------------------------------------------------------
 * Tiny static server for local preview: node scripts/dev-server.mjs
 * Serves the repo root on http://localhost:8123 with caching disabled, so
 * edits to the dashboard show up on plain reload. Production needs no server
 * (GitHub Pages serves the static files).
 * ------------------------------------------------------------------------- */
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 8123;
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

http
  .createServer(async (req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p === "/") p = "/index.html";
    try {
      const buf = await readFile(join(ROOT, p));
      res.writeHead(200, {
        "Content-Type": MIME[extname(p).toLowerCase()] || "application/octet-stream",
        "Cache-Control": "no-store",
      });
      res.end(buf);
    } catch {
      res.writeHead(404);
      res.end("not found");
    }
  })
  .listen(PORT, () => console.log(`serving on http://localhost:${PORT}`));
