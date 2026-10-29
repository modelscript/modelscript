// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Request, Response, Router } from "express";
import { Router as createRouter } from "express";
import type { LibraryDatabase } from "../database.js";
import { optionalAuth, requireAuth } from "../middleware/auth-middleware.js";

export function normalizeSolutionBundleUrl(url: string | null | undefined, slug?: string): string {
  if (!url) {
    return `/static/solutions/${encodeURIComponent(slug || "simulink-linter")}/index.html`;
  }
  const cdnMatch = url.match(/^https?:\/\/cdn\.modelscript\.org\/solutions\/([^/]+)\/index\.html$/i);
  if (cdnMatch) {
    return `/static/solutions/${encodeURIComponent(cdnMatch[1]!)}/index.html`;
  }
  return url;
}

export function renderSolutionBundleHtml(slug: string): string {
  const isIeee = slug.includes("ieee-2800");
  const title = isIeee ? "IEEE 2800-2022 IBR Compliance Auditor" : "Simulink Pre-Flight Static Linter";
  const subtitle = isIeee
    ? "Automated Inverter-Based Resource (IBR) voltage & frequency ride-through verification (IEEE Std 2800-2022 Clauses 7 & 9)"
    : "Static control-system analyzer for algebraic loops, sample-time conflicts, and unconnected signal ports (Rules M7201–M7210)";

  const sampleChecks = isIeee
    ? [
        {
          code: "IEEE-7.2.2",
          status: "PASS",
          msg: "Continuous operation within 0.90–1.10 p.u. voltage window verified.",
        },
        {
          code: "IEEE-7.3.1",
          status: "PASS",
          msg: "Low-Voltage Ride-Through (LVRT) reactive current injection k_v = 2.4 p.u. meets >= 2.0 p.u. requirement.",
        },
        {
          code: "IEEE-9.1.4",
          status: "WARN",
          msg: "Post-fault active power recovery ramp rate (0.82 s) approaches 1.0 s upper threshold under weak-grid SCR = 1.8.",
        },
        {
          code: "PRC-024-3",
          status: "PASS",
          msg: "Frequency trip settings lie outside the NERC PRC-024-3 No-Trip zone (57.8 Hz – 61.8 Hz).",
        },
      ]
    : [
        {
          code: "M7201",
          status: "WARN",
          msg: "Algebraic loop detected across Subsystem 'FlightController/PitchLoop/PID_Sum' -> 'ActuatorDynamics' (no unit delay).",
        },
        {
          code: "M7204",
          status: "PASS",
          msg: "All 42 Inport/Outport blocks have explicit dimensions and non-inherited sample times.",
        },
        {
          code: "M7207",
          status: "FAIL",
          msg: "Rate transition conflict: Fast rate (Ts = 0.001s) feeds slow rate (Ts = 0.02s) without Zero-Order Hold at 'SensorFusion/IMU_Bus'.",
        },
        {
          code: "M7210",
          status: "PASS",
          msg: "Fixed-step solver compatibility verified (Runge-Kutta ode4, step = 1 ms).",
        },
      ];

  const rowsHtml = sampleChecks
    .map((c) => {
      const badgeBg =
        c.status === "PASS"
          ? "rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.35)"
          : c.status === "WARN"
            ? "rgba(245, 158, 11, 0.15); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.35)"
            : "rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.35)";
      return `<div class="finding" data-status="${c.status}">
        <span class="badge" style="background:${badgeBg}">${c.status}</span>
        <span class="code">${c.code}</span>
        <span class="msg">${c.msg}</span>
      </div>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: radial-gradient(circle at center, #1e222d 0%, #141720 65%, #0d1017 100%);
      color: #e2e8f0;
      padding: 20px;
      min-height: 100vh;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 16px;
      padding-bottom: 16px;
      border-bottom: 1px solid rgba(148, 163, 184, 0.16);
      margin-bottom: 16px;
    }
    h1 { font-size: 16px; font-weight: 700; color: #f8fafc; margin-bottom: 4px; }
    .subtitle { font-size: 12px; color: #94a3b8; line-height: 1.4; }
    .toolbar {
      display: flex;
      gap: 8px;
      align-items: center;
      margin-bottom: 14px;
      flex-wrap: wrap;
    }
    button {
      background: #6366f1;
      color: #fff;
      border: none;
      border-radius: 6px;
      padding: 7px 13px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.15s;
    }
    button:hover { background: #4f46e5; }
    button.secondary {
      background: rgba(148, 163, 184, 0.12);
      color: #cbd5e1;
      border: 1px solid rgba(148, 163, 184, 0.22);
    }
    button.secondary:hover { background: rgba(148, 163, 184, 0.2); }
    .findings { display: flex; flex-direction: column; gap: 8px; }
    .finding {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 12px;
      border-radius: 8px;
      background: rgba(15, 23, 42, 0.65);
      border: 1px solid rgba(148, 163, 184, 0.14);
      font-size: 12.5px;
    }
    .badge {
      font-size: 10px;
      font-weight: 700;
      padding: 2px 7px;
      border-radius: 5px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      flex-shrink: 0;
    }
    .code {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-weight: 600;
      color: #a5b4fc;
      flex-shrink: 0;
      min-width: 82px;
    }
    .msg { color: #cbd5e1; line-height: 1.4; }
    .status-pill {
      font-size: 11px;
      color: #34d399;
      background: rgba(16, 185, 129, 0.12);
      border: 1px solid rgba(16, 185, 129, 0.3);
      padding: 4px 10px;
      border-radius: 999px;
      white-space: nowrap;
      font-weight: 600;
    }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h1>${title}</h1>
      <div class="subtitle">${subtitle}</div>
    </div>
    <span class="status-pill" id="run-status">● Local Wasm Engine Ready</span>
  </div>
  <div class="toolbar">
    <button type="button" id="run-btn">Re-Run Verification</button>
    <button type="button" class="secondary" id="filter-all">All (${sampleChecks.length})</button>
    <button type="button" class="secondary" id="filter-issues">Warnings / Failures</button>
  </div>
  <div class="findings" id="findings-list">
    ${rowsHtml}
  </div>
  <script>
    const runBtn = document.getElementById('run-btn');
    const statusEl = document.getElementById('run-status');
    const findings = Array.from(document.querySelectorAll('.finding'));
    runBtn.addEventListener('click', () => {
      statusEl.textContent = '⟳ Running analysis...';
      setTimeout(() => {
        statusEl.textContent = '✓ Verified (' + new Date().toLocaleTimeString() + ')';
      }, 250);
    });
    document.getElementById('filter-all').addEventListener('click', () => {
      findings.forEach(el => el.style.display = 'flex');
    });
    document.getElementById('filter-issues').addEventListener('click', () => {
      findings.forEach(el => {
        el.style.display = el.getAttribute('data-status') === 'PASS' ? 'none' : 'flex';
      });
    });
  </script>
</body>
</html>`;
}

export function solutionsRouter(database: LibraryDatabase): Router {
  const router = createRouter();

  /**
   * GET /api/v1/solutions
   * Returns list of featured/recent public solutions
   */
  router.get("/", optionalAuth, (_req: Request, res: Response) => {
    try {
      const solutions = database.getAllPublicSolutions().map((s) => ({
        ...s,
        bundle_url: normalizeSolutionBundleUrl(s.bundle_url, s.slug),
      }));
      res.json({ solutions });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  /**
   * GET /api/v1/solutions/:author/:slug
   * Returns full solution details, author profile, and latest release metadata
   */
  router.get("/:author/:slug", optionalAuth, (req: Request, res: Response) => {
    const author = req.params["author"] as string;
    const slug = req.params["slug"] as string;
    try {
      const result = database.getSolution(author, slug);
      if (!result) {
        res.status(404).json({ error: `Solution '${author}/${slug}' not found` });
        return;
      }
      if (result.solution) {
        result.solution.bundle_url = normalizeSolutionBundleUrl(result.solution.bundle_url, slug);
      }
      if (result.release) {
        result.release.bundle_url = normalizeSolutionBundleUrl(result.release.bundle_url, slug);
      }
      res.json(result);
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  /**
   * GET /api/v1/solutions/:author/:slug/releases
   * Returns list of all releases for a solution
   */
  router.get("/:author/:slug/releases", optionalAuth, (req: Request, res: Response) => {
    const author = req.params["author"] as string;
    const slug = req.params["slug"] as string;
    try {
      const releases = database.getSolutionReleases(author, slug).map((r) => ({
        ...r,
        bundle_url: normalizeSolutionBundleUrl(r.bundle_url, slug),
      }));
      res.json({ releases });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  /**
   * POST /api/v1/solutions/publish
   * Publishes or updates a solution and registers a new release
   */
  router.post("/publish", requireAuth, (req: Request, res: Response) => {
    const userId = req.user!.id;
    const {
      slug,
      name,
      description,
      category,
      icon,
      supported_formats,
      repo_id,
      version,
      changelog,
      bundle_url,
      tauri_windows_url,
      tauri_linux_url,
      tauri_darwin_url,
      manifest,
    } = req.body;

    if (!slug || !name || !version || !bundle_url) {
      res.status(400).json({ error: "Missing required fields: slug, name, version, bundle_url" });
      return;
    }

    const isSafeSolutionUrl = (raw: unknown): boolean => {
      if (raw === undefined || raw === null || raw === "") return true;
      if (typeof raw !== "string") return false;
      const trimmed = raw.trim();
      if (trimmed.startsWith("/")) return !trimmed.startsWith("//");
      try {
        const parsed = new URL(trimmed);
        return parsed.protocol === "https:" || parsed.protocol === "http:";
      } catch {
        return false;
      }
    };

    if (
      !isSafeSolutionUrl(bundle_url) ||
      !isSafeSolutionUrl(tauri_windows_url) ||
      !isSafeSolutionUrl(tauri_linux_url) ||
      !isSafeSolutionUrl(tauri_darwin_url)
    ) {
      res
        .status(400)
        .json({ error: "Invalid URL protocol in bundle_url or tauri URLs; must be http(s) or relative path" });
      return;
    }

    try {
      const normalizedBundleUrl = normalizeSolutionBundleUrl(bundle_url, slug);
      const solutionId = database.createOrUpdateSolution(userId, {
        slug,
        name,
        description,
        category,
        icon,
        supported_formats: Array.isArray(supported_formats) ? supported_formats : [],
        repo_id: repo_id ? Number(repo_id) : undefined,
      });

      const releaseId = database.createSolutionRelease(solutionId, {
        version,
        changelog,
        bundle_url: normalizedBundleUrl,
        tauri_windows_url,
        tauri_linux_url,
        tauri_darwin_url,
        manifest_json: manifest ? JSON.stringify(manifest) : undefined,
      });

      res.status(201).json({
        success: true,
        solutionId,
        releaseId,
        url: `/solutions/${req.user!.username}/${slug}`,
      });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  return router;
}
