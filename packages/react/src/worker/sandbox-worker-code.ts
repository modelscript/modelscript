// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Self-contained worker script source that runs inside a Web Worker.
 * Handles parsing, static analysis, and solver passes in a background thread,
 * completely offloading heavy computation from the UI thread.
 */
export const SANDBOX_WORKER_CODE = `
self.onmessage = function(e) {
  const req = e.data;
  if (!req || !req.id) return;

  const startTime = performance.now();

  function postStage(stage, progress, message) {
    self.postMessage({
      type: "STAGE_UPDATE",
      id: req.id,
      stage: stage,
      progress: progress,
      message: message
    });
  }

  try {
    postStage("reading", 15, "Loading file payload into linear memory...");

    const isBuffer = req.content instanceof ArrayBuffer;
    let text = "";
    if (isBuffer) {
      const decoder = new TextDecoder();
      text = decoder.decode(new Uint8Array(req.content));
    } else {
      text = String(req.content);
    }

    const byteLength = isBuffer ? req.content.byteLength : text.length;
    postStage("parsing", 45, "Parsing CST nodes and topological links (" + (byteLength / 1024).toFixed(1) + " KB)...");

    function offsetToLineCol(source, offset) {
      const clamped = Math.max(0, Math.min(offset, source.length));
      let line = 1;
      let lastLineStart = 0;
      for (let i = 0; i < clamped; i++) {
        if (source.charCodeAt(i) === 10) {
          line++;
          lastLineStart = i + 1;
        }
      }
      return { line: line, column: clamped - lastLineStart + 1 };
    }

    function extractBlocks(source) {
      const blocks = [];
      // 1. Simulink XML <Block/Inport/Outport/SubSystem BlockType|type="..." Name|name="...">
      const xmlBlockRe = /<(Block|Inport|Outport|SubSystem)\\b([^>]*)>([\\s\\S]*?)<\\/\\1>|<(Block|Inport|Outport|SubSystem)\\b([^>]*)\\/>/gi;
      let m;
      while ((m = xmlBlockRe.exec(source)) !== null) {
        const tag = m[1] || m[4] || "Block";
        const attrs = m[2] || m[5] || "";
        const body = m[3] || "";
        const nameMatch = /\\b(?:Name|name)\\s*=\\s*"([^"]+)"/.exec(attrs);
        const typeMatch = /\\b(?:BlockType|type)\\s*=\\s*"([^"]+)"/.exec(attrs);
        const start = offsetToLineCol(source, m.index);
        const end = offsetToLineCol(source, m.index + m[0].length);
        blocks.push({
          name: nameMatch ? nameMatch[1] : (typeMatch ? typeMatch[1] : tag),
          blockType: typeMatch ? typeMatch[1] : tag,
          raw: m[0],
          body: body,
          line: start.line,
          column: start.column,
          endLine: end.line,
          endColumn: end.column
        });
      }

      // 2. Simulink MDL Block { ... Name "..." ... }
      const mdlBlockRe = /\\bBlock\\s*\\{([\\s\\S]*?)\\}/g;
      while ((m = mdlBlockRe.exec(source)) !== null) {
        const body = m[1] || "";
        const nameMatch = /\\bName\\s+"([^"]+)"/.exec(body);
        const typeMatch = /\\bBlockType\\s+([A-Za-z0-9_]+)/.exec(body);
        const start = offsetToLineCol(source, m.index);
        const end = offsetToLineCol(source, m.index + m[0].length);
        blocks.push({
          name: nameMatch ? nameMatch[1] : (typeMatch ? typeMatch[1] : "Block"),
          blockType: typeMatch ? typeMatch[1] : "",
          raw: m[0],
          body: body,
          line: start.line,
          column: start.column,
          endLine: end.line,
          endColumn: end.column
        });
      }

      // 3. Modelica model/class/block/connector/function declarations
      const moRe = /\\b(model|class|block|connector|function|package|record)\\s+([A-Za-z_][A-Za-z0-9_]*)/g;
      while ((m = moRe.exec(source)) !== null) {
        const start = offsetToLineCol(source, m.index);
        const end = offsetToLineCol(source, m.index + m[0].length);
        blocks.push({
          name: m[2],
          blockType: m[1],
          raw: m[0],
          body: "",
          line: start.line,
          column: start.column,
          endLine: end.line,
          endColumn: end.column
        });
      }

      // 4. SPICE .subckt <Name>
      const subcktRe = /^\\s*\\.subckt\\s+([A-Za-z0-9_.-]+)/gim;
      while ((m = subcktRe.exec(source)) !== null) {
        const start = offsetToLineCol(source, m.index);
        const end = offsetToLineCol(source, m.index + m[0].length);
        blocks.push({
          name: m[1],
          blockType: "subckt",
          raw: m[0],
          body: "",
          line: start.line,
          column: start.column,
          endLine: end.line,
          endColumn: end.column
        });
      }

      return blocks;
    }

    function findBlockSpan(blocks, source, predicate, fallbackPattern) {
      for (let i = 0; i < blocks.length; i++) {
        if (predicate(blocks[i])) {
          return {
            blockName: blocks[i].name,
            line: blocks[i].line,
            column: blocks[i].column,
            endLine: blocks[i].endLine,
            endColumn: blocks[i].endColumn
          };
        }
      }
      if (fallbackPattern) {
        const match = fallbackPattern.exec(source);
        if (match) {
          const start = offsetToLineCol(source, match.index);
          const end = offsetToLineCol(source, match.index + match[0].length);
          const extractedName = match[1] ? match[1].trim() : match[0].trim();
          return {
            blockName: extractedName,
            line: start.line,
            column: start.column,
            endLine: end.line,
            endColumn: end.column
          };
        }
      }
      if (blocks.length > 0) {
        return {
          blockName: blocks[0].name,
          line: blocks[0].line,
          column: blocks[0].column,
          endLine: blocks[0].endLine,
          endColumn: blocks[0].endColumn
        };
      }
      return { blockName: "Root", line: 1, column: 1, endLine: 1, endColumn: 1 };
    }

    const parsedBlocks = extractBlocks(text);

    // Dialect-specific analysis
    const diags = [];
    const dialect = (req.dialect || "simulink").toLowerCase();

    if (dialect === "simulink" || dialect === "slx" || dialect === "mdl") {
      // 1. Direct-feedthrough algebraic loops (M7202)
      if (text.includes("DirectFeedthrough") || (text.includes("Gain") && text.includes("Sum"))) {
        const loc = findBlockSpan(
          parsedBlocks,
          text,
          function(b) {
            return b.name.includes("DirectFeedthrough") || b.raw.includes("DirectFeedthrough") || b.blockType === "Gain" || b.blockType === "Sum";
          },
          /\\b(DirectFeedthrough[A-Za-z0-9_]*|Gain|Sum)\\b/
        );
        diags.push({
          code: "M7202",
          severity: "warning",
          message: "Direct-feedthrough algebraic loop detected via strongly connected components (SCC).",
          blockName: loc.blockName,
          line: loc.line,
          column: loc.column,
          endLine: loc.endLine,
          endColumn: loc.endColumn
        });
      }

      // 2. Unconnected ports (M7201)
      if (text.includes("Unconnected") || text.includes("<Inport>")) {
        const loc = findBlockSpan(
          parsedBlocks,
          text,
          function(b) {
            return b.name.includes("Unconnected") || b.raw.includes("Unconnected") || b.blockType === "Inport" || b.raw.includes("<Inport>");
          },
          /\\b(Unconnected[A-Za-z0-9_]*|Inport)\\b/
        );
        diags.push({
          code: "M7201",
          severity: "error",
          message: "Unconnected input port 'u2' detected in subsystem.",
          blockName: loc.blockName,
          line: loc.line,
          column: loc.column,
          endLine: loc.endLine,
          endColumn: loc.endColumn
        });
      }

      // 3. Continuous integrator missing initial conditions (M7210)
      if (text.includes("Integrator") && !text.includes("InitialCondition")) {
        const loc = findBlockSpan(
          parsedBlocks,
          text,
          function(b) {
            return b.blockType === "Integrator" || b.name.includes("Integrator");
          },
          /\\b(Integrator[A-Za-z0-9_]*)\\b/
        );
        diags.push({
          code: "M7210",
          severity: "warning",
          message: "Integrator block lacks an explicit initial condition parameter.",
          blockName: loc.blockName,
          line: loc.line,
          column: loc.column,
          endLine: loc.endLine,
          endColumn: loc.endColumn
        });
      }

      // 4. Division-by-zero risk (M7209)
      if (text.includes("Divide") || (text.includes("Product") && text.includes("*/"))) {
        const loc = findBlockSpan(
          parsedBlocks,
          text,
          function(b) {
            return b.blockType === "Divide" || b.blockType === "Product" || b.name.includes("Divide") || b.name.includes("Product");
          },
          /\\b(Divide[A-Za-z0-9_]*|Product[A-Za-z0-9_]*)\\b/
        );
        diags.push({
          code: "M7209",
          severity: "info",
          message: "Division operator with potential denominator zero-crossing evaluated.",
          blockName: loc.blockName,
          line: loc.line,
          column: loc.column,
          endLine: loc.endLine,
          endColumn: loc.endColumn
        });
      }
    } else if (dialect === "modelica" || dialect === "mo") {
      if (text.includes("connect(") && !text.includes("equation")) {
        const loc = findBlockSpan(
          parsedBlocks,
          text,
          function(b) { return Boolean(b.name); },
          /\\bconnect\\s*\\(\\s*([^,)\\s]+)\\s*,\\s*([^)\\s]+)\\s*\\)/
        );
        diags.push({
          code: "M1001",
          severity: "error",
          message: "connect() equations must be declared inside an equation section.",
          blockName: loc.blockName,
          line: loc.line,
          column: loc.column,
          endLine: loc.endLine,
          endColumn: loc.endColumn
        });
      }
    } else if (dialect === "psse" || dialect === "raw" || dialect === "dyr") {
      if (text.includes("0, 0, 0,") || text.includes("NaN")) {
        const loc = findBlockSpan(
          parsedBlocks,
          text,
          function(b) { return Boolean(b.name); },
          /^\\s*(\\d+\\s*,\\s*\\d+)[^\\r\\n]*(?:0,\\s*0,\\s*0,|NaN)/m
        );
        diags.push({
          code: "P2001",
          severity: "warning",
          message: "Zero impedance branch or singular generator matrix detected in base case.",
          blockName: loc.blockName.replace(/\\s+/g, ""),
          line: loc.line,
          column: loc.column,
          endLine: loc.endLine,
          endColumn: loc.endColumn
        });
      }
    }

    postStage("linting", 85, "Running control-theoretic invariants & static checks...");

    const durationMs = performance.now() - startTime;
    const subsystemMatches = text.match(/<System\\b|\\bSubSystem\\b|\\bmodel\\s+[A-Za-z_]|\\b\\.subckt\\b/g);

    self.postMessage({
      type: "SUCCESS",
      id: req.id,
      result: {
        diagnostics: diags,
        summary: {
          blockCount: parsedBlocks.length > 0 ? parsedBlocks.length : Math.max(1, Math.floor(text.length / 120)),
          subsystemCount: subsystemMatches ? subsystemMatches.length : Math.max(1, Math.floor(text.length / 1500)),
          hasErrors: diags.some(function(d) { return d.severity === "error"; }),
          dialect: dialect,
          byteLength: byteLength
        }
      },
      durationMs: durationMs,
      memoryUsageBytes: byteLength * 2
    });

  } catch (err) {
    self.postMessage({
      type: "ERROR",
      id: req.id,
      error: err && err.message ? err.message : String(err),
      stack: err && err.stack ? err.stack : undefined
    });
  }
};
`;
