// Minimal Express server for previewing the static IDE build locally.
// Unlike `serve`, this handles CORS preflight + Private Network Access headers
// required by VS Code's extension host worker iframe.

import express from "express";
import { resolve } from "path";

const __dirname = import.meta.dirname;
const PORT = parseInt(process.env.PORT || "3000", 10);
const STATIC_DIR = resolve(__dirname, "..", "dist", "static");

const app = express();

// CORS + PNA headers on every response (including preflights)
app.use((_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Private-Network", "true");
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  next();
});

// Handle preflight OPTIONS requests
app.options("*path", (_req, res) => {
  res.status(204).end();
});

// Serve the static build
app.use(express.static(STATIC_DIR, { dotfiles: "allow" }));

app.listen(PORT, () => {
  console.log(`Static IDE preview: http://localhost:${PORT}`);
});
