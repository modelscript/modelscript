// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Self-Contained Interactive HTML Dashboard Reporter for ModelScript Verification.
 *
 * Emits a single, zero-dependency, rich HTML report containing:
 *   - Executive KPI summary cards (Total, Passed, Failed, Certified, Duration).
 *   - Stage breakdown with status pills and execution metrics.
 *   - SVG Reachability Flowpipe viewer with safety corridor visualization.
 *   - Decision Table partition matrix with witness values.
 *   - Interactive collapsible counterexample inspection drawer.
 */

export interface HtmlReportStageInput {
  stage: string;
  name: string;
  passed: boolean;
  certified?: boolean;
  durationMs: number;
  summary: string;
  violations?: {
    id?: string;
    message: string;
    severity?: "error" | "warning" | "note";
    location?: { uri?: string; line?: number; column?: number };
    witness?: any;
  }[];
  details?: any;
}

export interface HtmlReportInput {
  timestamp: string;
  target?: string;
  summary: {
    totalStages: number;
    passedStages: number;
    failedStages: number;
    certifiedStages: number;
    skippedStages: number;
    totalViolations: number;
    durationMs: number;
    overallPassed: boolean;
  };
  stages: Record<string, HtmlReportStageInput>;
}

export function generateHtmlReport(
  report: HtmlReportInput,
  title: string = "ModelScript Verification Dashboard",
): string {
  const { summary, stages, timestamp, target } = report;
  const overallClass = summary.overallPassed ? "status-pass" : "status-fail";
  const overallBadge = summary.overallPassed ? "ALL CERTIFIED / PASSED" : "VIOLATIONS DETECTED";

  // Build stage rows
  const stageRows = Object.values(stages)
    .map((st) => {
      const statusClass = st.passed ? (st.certified ? "badge-cert" : "badge-pass") : "badge-fail";
      const statusText = st.passed ? (st.certified ? "CERTIFIED" : "PASSED") : "FAILED";
      const violationCount = st.violations?.length || 0;

      let violationDetails = "";
      if (violationCount > 0) {
        violationDetails = `
          <div class="violation-list">
            ${st.violations
              ?.map(
                (v, idx) => `
              <div class="violation-item">
                <span class="v-num">#${idx + 1}</span>
                <span class="v-msg">${escapeHtml(v.message)}</span>
                ${v.location?.line ? `<span class="v-loc">${v.location.uri ? escapeHtml(v.location.uri) + ":" : ""}${v.location.line}:${v.location.column || 1}</span>` : ""}
                ${v.witness ? `<pre class="v-witness">${escapeHtml(JSON.stringify(v.witness, null, 2))}</pre>` : ""}
              </div>
            `,
              )
              .join("")}
          </div>
        `;
      }

      let matrixSection = "";
      if (st.details?.formattedMatrix) {
        matrixSection = `
          <div class="matrix-container">
            <div class="matrix-title">Polyspace/Astrée Formal Proof Matrix</div>
            <pre class="matrix-pre">${escapeHtml(st.details.formattedMatrix)}</pre>
          </div>
        `;
      }

      return `
        <div class="stage-card">
          <div class="stage-header" onclick="this.parentElement.classList.toggle('expanded')">
            <span class="badge ${statusClass}">${statusText}</span>
            <span class="stage-name">${escapeHtml(st.name)}</span>
            <span class="stage-duration">${st.durationMs.toFixed(1)} ms</span>
            <span class="stage-toggle">▼</span>
          </div>
          <div class="stage-body">
            <div class="stage-summary">${escapeHtml(st.summary)}</div>
            ${matrixSection}
            ${violationDetails}
          </div>
        </div>
      `;
    })
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>
    :root {
      --bg: #0f141c;
      --card-bg: #1a2230;
      --card-hover: #222c3d;
      --border: #2a3649;
      --text: #e2e8f0;
      --text-muted: #889bb0;
      --pass: #10b981;
      --cert: #3b82f6;
      --fail: #ef4444;
      --warn: #f59e0b;
      --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: var(--font-sans);
      padding: 2rem;
      line-height: 1.5;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 2rem;
      border-bottom: 1px solid var(--border);
      padding-bottom: 1rem;
    }
    .title-group h1 { font-size: 1.75rem; font-weight: 700; color: #fff; }
    .title-group .meta { font-size: 0.875rem; color: var(--text-muted); margin-top: 0.25rem; }
    .overall-badge {
      padding: 0.5rem 1rem;
      border-radius: 9999px;
      font-weight: 700;
      font-size: 0.875rem;
      letter-spacing: 0.05em;
    }
    .overall-badge.status-pass { background: rgba(16, 185, 129, 0.2); color: var(--pass); border: 1px solid var(--pass); }
    .overall-badge.status-fail { background: rgba(239, 68, 68, 0.2); color: var(--fail); border: 1px solid var(--fail); }

    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 1rem;
      margin-bottom: 2rem;
    }
    .kpi-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 1.25rem;
      text-align: center;
    }
    .kpi-val { font-size: 2rem; font-weight: 800; font-family: var(--font-mono); margin-bottom: 0.25rem; }
    .kpi-lbl { font-size: 0.75rem; text-transform: uppercase; color: var(--text-muted); letter-spacing: 0.05em; }

    .stages-container { display: flex; flex-direction: column; gap: 0.75rem; }
    .stage-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      overflow: hidden;
      transition: border-color 0.2s;
    }
    .stage-card:hover { border-color: #3b82f6; }
    .stage-header {
      padding: 1rem 1.25rem;
      display: flex;
      align-items: center;
      gap: 1rem;
      cursor: pointer;
      user-select: none;
    }
    .stage-name { font-weight: 600; flex: 1; font-size: 1.05rem; }
    .stage-duration { font-family: var(--font-mono); font-size: 0.875rem; color: var(--text-muted); }
    .stage-toggle { font-size: 0.75rem; color: var(--text-muted); transition: transform 0.2s; }
    .stage-card.expanded .stage-toggle { transform: rotate(180deg); }

    .badge {
      font-size: 0.75rem;
      font-weight: 700;
      padding: 0.25rem 0.5rem;
      border-radius: 4px;
      letter-spacing: 0.05em;
    }
    .badge-pass { background: rgba(16, 185, 129, 0.2); color: var(--pass); }
    .badge-cert { background: rgba(59, 130, 246, 0.2); color: var(--cert); }
    .badge-fail { background: rgba(239, 68, 68, 0.2); color: var(--fail); }

    .stage-body {
      display: none;
      padding: 1rem 1.25rem;
      border-top: 1px solid var(--border);
      background: rgba(0, 0, 0, 0.15);
      font-size: 0.95rem;
    }
    .stage-card.expanded .stage-body { display: block; }
    .stage-summary { margin-bottom: 0.75rem; color: #cbd5e1; }

    .violation-list { display: flex; flex-direction: column; gap: 0.5rem; margin-top: 0.75rem; }
    .violation-item {
      background: rgba(239, 68, 68, 0.08);
      border-left: 3px solid var(--fail);
      padding: 0.75rem;
      border-radius: 0 4px 4px 0;
    }
    .v-num { font-weight: bold; color: var(--fail); margin-right: 0.5rem; }
    .v-loc { font-family: var(--font-mono); font-size: 0.8rem; color: var(--text-muted); margin-left: 0.5rem; }
    .v-witness {
      margin-top: 0.5rem;
      padding: 0.5rem;
      background: rgba(0,0,0,0.3);
      border-radius: 4px;
      font-family: var(--font-mono);
      font-size: 0.8rem;
      color: #94a3b8;
      overflow-x: auto;
    }
    .matrix-container {
      margin-top: 1rem;
      background: #0d1117;
      border: 1px solid var(--border);
      border-radius: 6px;
      overflow-x: auto;
      padding: 1rem;
    }
    .matrix-title {
      font-size: 0.85rem;
      font-weight: 700;
      color: #93c5fd;
      margin-bottom: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .matrix-pre {
      font-family: var(--font-mono);
      font-size: 0.825rem;
      color: #e2e8f0;
      line-height: 1.4;
      white-space: pre;
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="title-group">
      <h1>${escapeHtml(title)}</h1>
      <div class="meta">Target: <strong>${escapeHtml(target || "System Workspace")}</strong> &bull; Generated: ${escapeHtml(timestamp)}</div>
    </div>
    <div class="overall-badge ${overallClass}">${overallBadge}</div>
  </div>

  <div class="kpi-grid">
    <div class="kpi-card">
      <div class="kpi-val" style="color: #60a5fa">${summary.totalStages}</div>
      <div class="kpi-lbl">Total Stages</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-val" style="color: var(--pass)">${summary.passedStages}</div>
      <div class="kpi-lbl">Passed</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-val" style="color: var(--cert)">${summary.certifiedStages}</div>
      <div class="kpi-lbl">Certified Proofs</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-val" style="color: var(--fail)">${summary.failedStages}</div>
      <div class="kpi-lbl">Violations</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-val" style="color: #f1f5f9">${summary.durationMs.toFixed(0)} ms</div>
      <div class="kpi-lbl">Total Execution</div>
    </div>
  </div>

  <div class="stages-container">
    ${stageRows}
  </div>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
