/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Markdown-It plugin for ModelScript directives.
 *
 * Handles:
 *   - {{ VarName }}           → styled <code> with resolved value (or placeholder)
 *   - ::diagram{target="X"}   → styled <div> with component table (or placeholder)
 *   - ::requirements{target="X"} → styled <div> with requirements table (or placeholder)
 */

export interface RequirementRow {
  reqId: string;
  name: string;
  text: string;
  status: string;
}

export interface DiagramComponent {
  name: string;
  type: string;
}

export interface DiagramConnection {
  from: string;
  to: string;
}

export interface MarkdownResolver {
  resolveVariable(name: string): string | undefined;
  resolveDiagramSvg(target: string): string | undefined;
  resolveRequirements(target: string): RequirementRow[] | undefined;
  resolveDiagramComponents(target: string): DiagramComponent[] | undefined;
  resolveDiagramConnections(target: string): DiagramConnection[] | undefined;
}

const defaultResolver: MarkdownResolver = {
  resolveVariable: () => undefined,
  resolveDiagramSvg: () => undefined,
  resolveRequirements: () => undefined,
  resolveDiagramComponents: () => undefined,
  resolveDiagramConnections: () => undefined,
};

/**
 * Build an HTML table for requirements data.
 */
function buildRequirementsHtml(target: string, rows: RequirementRow[]): string {
  const statusIcon = (s: string) => {
    switch (s) {
      case "Passed":
        return "✅";
      case "Failed":
        return "❌";
      default:
        return "⏳";
    }
  };

  let html = `<table class="modelscript-req-table" style="width:100%;border-collapse:collapse;font-size:13px;">`;
  html += `<thead><tr style="border-bottom:2px solid var(--vscode-panel-border,#444);text-align:left;">`;
  html += `<th style="padding:6px 10px;">ID</th>`;
  html += `<th style="padding:6px 10px;">Requirement</th>`;
  html += `<th style="padding:6px 10px;">Description</th>`;
  html += `<th style="padding:6px 10px;text-align:center;">Status</th>`;
  html += `</tr></thead><tbody>`;

  for (const row of rows) {
    html += `<tr style="border-bottom:1px solid var(--vscode-panel-border,#333);">`;
    html += `<td style="padding:5px 10px;font-family:monospace;font-size:12px;">${escapeHtml(row.reqId)}</td>`;
    html += `<td style="padding:5px 10px;font-weight:500;">${escapeHtml(row.name)}</td>`;
    html += `<td style="padding:5px 10px;opacity:0.85;">${escapeHtml(row.text)}</td>`;
    html += `<td style="padding:5px 10px;text-align:center;">${statusIcon(row.status)}</td>`;
    html += `</tr>`;
  }

  html += `</tbody></table>`;
  return html;
}

/**
 * Build an inline SVG block diagram representing components and connections.
 */
function buildSvgDiagramHtml(
  target: string,
  components: DiagramComponent[],
  connections: DiagramConnection[] = [],
): string {
  // Simple auto-layout algorithm for a block diagram
  const boxWidth = 140;
  const boxHeight = 60;
  const paddingX = 40;
  const paddingY = 60;
  const startX = 20;
  const startY = 20;

  // Assign positions
  const positions = new Map<string, { x: number; y: number }>();
  let currentX = startX;
  let currentY = startY;
  const maxCols = 3;
  let col = 0;

  for (const comp of components) {
    positions.set(comp.name, { x: currentX, y: currentY });
    col++;
    if (col >= maxCols) {
      col = 0;
      currentX = startX;
      currentY += boxHeight + paddingY;
    } else {
      currentX += boxWidth + paddingX;
    }
  }

  // Calculate SVG bounds
  const rows = Math.ceil(components.length / maxCols);
  const svgWidth =
    startX * 2 +
    Math.min(components.length, maxCols) * boxWidth +
    Math.max(0, Math.min(components.length, maxCols) - 1) * paddingX;
  const svgHeight = startY * 2 + rows * boxHeight + Math.max(0, rows - 1) * paddingY;

  let svg = `<svg class="modelscript-svg-diagram" width="${svgWidth}" height="${svgHeight}" xmlns="http://www.w3.org/2000/svg" style="background-color: var(--vscode-editor-background, #1e1e1e); border: 1px solid var(--vscode-panel-border, #444); border-radius: 4px;">`;

  // Draw connections first (so they are under boxes)
  for (const conn of connections) {
    // Parse "CompName.portName"
    const fromCompName = conn.from.split(".")[0];
    const toCompName = conn.to.split(".")[0];

    const p1 = positions.get(fromCompName);
    const p2 = positions.get(toCompName);

    if (p1 && p2) {
      const x1 = p1.x + boxWidth / 2;
      const y1 = p1.y + boxHeight / 2;
      const x2 = p2.x + boxWidth / 2;
      const y2 = p2.y + boxHeight / 2;

      // Simple straight line for now. Could add orthogonal routing.
      svg += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="var(--vscode-symbolIcon-enumeratorMemberForeground, #007acc)" stroke-width="2" />`;
    }
  }

  // Draw component boxes
  for (const comp of components) {
    const pos = positions.get(comp.name);
    if (!pos) continue;

    svg += `<g transform="translate(${pos.x}, ${pos.y})">`;
    // Box
    svg += `<rect width="${boxWidth}" height="${boxHeight}" rx="4" fill="var(--vscode-editorWidget-background, #252526)" stroke="var(--vscode-widget-border, #454545)" stroke-width="1"/>`;
    // Name (bold)
    svg += `<text x="${boxWidth / 2}" y="${boxHeight / 2 - 6}" font-family="var(--vscode-font-family, sans-serif)" font-size="12" font-weight="bold" fill="var(--vscode-editor-foreground, #d4d4d4)" text-anchor="middle" dominant-baseline="central">${escapeHtml(comp.name)}</text>`;
    // Type (smaller, muted)
    svg += `<text x="${boxWidth / 2}" y="${boxHeight / 2 + 10}" font-family="var(--vscode-font-family, sans-serif)" font-size="10" fill="var(--vscode-descriptionForeground, #cccccc)" text-anchor="middle" dominant-baseline="central">${escapeHtml(comp.type)}</text>`;
    svg += `</g>`;
  }

  svg += `</svg>`;
  return svg;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function createMarkdownItPlugin(resolver: MarkdownResolver = defaultResolver) {
  return function extendMarkdownIt(md: any) {
    // ── Block rule: ::diagram{target="X"} ──
    md.block.ruler.before(
      "paragraph",
      "modelscript_diagram",
      (state: any, startLine: number, _endLine: number, silent: boolean) => {
        const pos = state.bMarks[startLine] + state.tShift[startLine];
        const max = state.eMarks[startLine];
        const src = state.src.slice(pos, max);
        if (!src.startsWith("::diagram")) return false;
        const match = /^::diagram\{target="([^"]+)"\}/.exec(src);
        if (!match) return false;
        if (!silent) {
          const target = match[1];
          const svg = resolver.resolveDiagramSvg(target);
          const components = resolver.resolveDiagramComponents(target);

          if (svg) {
            const open = state.push("modelscript_diagram_open", "div", 1);
            open.attrs = [
              ["class", "modelscript-diagram"],
              ["data-target", target],
            ];
            open.map = [startLine, startLine + 1];

            const h = state.push("html_block", "", 0);
            h.content = svg;

            state.push("modelscript_diagram_close", "div", -1);
          } else if (components && components.length > 0) {
            const connections = resolver.resolveDiagramConnections(target) || [];
            const svgHtml = buildSvgDiagramHtml(target, components, connections);

            const open = state.push("modelscript_diagram_open", "div", 1);
            open.attrs = [
              ["class", "modelscript-diagram"],
              ["data-target", target],
            ];
            open.map = [startLine, startLine + 1];

            const h = state.push("html_block", "", 0);
            h.content = svgHtml;

            state.push("modelscript_diagram_close", "div", -1);
          } else {
            const open = state.push("modelscript_diagram_open", "div", 1);
            open.attrs = [
              ["class", "modelscript-diagram"],
              ["data-target", target],
            ];
            open.map = [startLine, startLine + 1];

            const t = state.push("text", "", 0);
            t.content = `Loading diagram: ${target}... (components: ${JSON.stringify(components)})`;

            state.push("modelscript_diagram_close", "div", -1);
          }
        }
        state.line = startLine + 1;
        return true;
      },
    );

    // ── Block rule: ::requirements{target="X"} ──
    md.block.ruler.before(
      "paragraph",
      "modelscript_requirements",
      (state: any, startLine: number, _endLine: number, silent: boolean) => {
        const pos = state.bMarks[startLine] + state.tShift[startLine];
        const max = state.eMarks[startLine];
        const src = state.src.slice(pos, max);
        if (!src.startsWith("::requirements")) return false;
        const match = /^::requirements\{target="([^"]+)"\}/.exec(src);
        if (!match) return false;
        if (!silent) {
          const target = match[1];
          const rows = resolver.resolveRequirements(target);
          const open = state.push("modelscript_req_open", "div", 1);
          open.attrs = [
            ["class", "modelscript-requirements"],
            ["data-target", target],
          ];
          open.map = [startLine, startLine + 1];
          if (rows && rows.length > 0) {
            const h = state.push("html_block", "", 0);
            h.content = buildRequirementsHtml(target, rows);
          } else {
            const t = state.push("text", "", 0);
            t.content = `[Requirements View: ${target}]`;
          }
          state.push("modelscript_req_close", "div", -1);
        }
        state.line = startLine + 1;
        return true;
      },
    );

    // ── Core rule: {{ variable }} post-processing ──
    // Runs AFTER inline parsing to handle {{ var }} patterns that get split
    // across multiple text tokens by markdown-it's inline parser (because
    // '{' is a terminator character that splits text tokens).
    md.core.ruler.push("modelscript_vars", (state: any) => {
      const varRegex = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

      for (const blockToken of state.tokens) {
        if (blockToken.type !== "inline" || !blockToken.children) continue;

        const children: any[] = blockToken.children;

        // Step 1: Merge adjacent text tokens so {{ var }} is in one token.
        const merged: any[] = [];
        for (const tok of children) {
          if (tok.type === "text" && merged.length > 0 && merged[merged.length - 1].type === "text") {
            merged[merged.length - 1].content += tok.content;
          } else {
            // Clone the token to avoid mutating the original
            const clone = new state.Token(tok.type, tok.tag, tok.nesting);
            clone.content = tok.content;
            clone.attrs = tok.attrs;
            clone.markup = tok.markup;
            clone.info = tok.info;
            clone.meta = tok.meta;
            clone.block = tok.block;
            clone.hidden = tok.hidden;
            merged.push(clone);
          }
        }

        // Step 2: Find {{ var }} in merged text tokens and split into styled spans.
        const result: any[] = [];
        for (const tok of merged) {
          if (tok.type !== "text" || !tok.content.includes("{{")) {
            result.push(tok);
            continue;
          }

          varRegex.lastIndex = 0;
          let lastIdx = 0;
          let match: RegExpExecArray | null;
          let found = false;

          while ((match = varRegex.exec(tok.content)) !== null) {
            found = true;
            const varName = match[1];
            const resolved = resolver.resolveVariable(varName);

            // Text before the match
            if (match.index > lastIdx) {
              const before = new state.Token("text", "", 0);
              before.content = tok.content.substring(lastIdx, match.index);
              result.push(before);
            }

            // Opening <span> — use span tag with class only (VS Code sanitizes inline styles)
            const open = new state.Token("modelscript_var_open", "span", 1);
            open.attrs = [
              ["class", "modelscript-var"],
              ["data-name", varName],
            ];
            result.push(open);

            // Value text
            const val = new state.Token("text", "", 0);
            val.content = resolved !== undefined ? String(resolved) : `{{ ${varName} }}`;
            result.push(val);

            // Closing </span>
            const close = new state.Token("modelscript_var_close", "span", -1);
            result.push(close);

            lastIdx = match.index + match[0].length;
          }

          if (!found) {
            result.push(tok);
          } else if (lastIdx < tok.content.length) {
            const after = new state.Token("text", "", 0);
            after.content = tok.content.substring(lastIdx);
            result.push(after);
          }
        }

        blockToken.children = result;
      }
    });

    return md;
  };
}

/** Default export for backward compatibility. */
export const extendMarkdownIt = createMarkdownItPlugin();
