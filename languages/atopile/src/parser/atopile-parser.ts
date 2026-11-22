// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/atopile — Indentation-Aware `.ato` Parser & Physical Unit Evaluator.
 */

import type {
  AtoAssertion,
  AtoAssignment,
  AtoBlock,
  AtoConnection,
  AtoDiagnostic,
  AtoFile,
  AtoImport,
  AtoInstance,
  AtoPhysicalValue,
  AtoSpan,
} from "../types.js";

const SI_PREFIX: Record<string, number> = {
  f: 1e-15,
  p: 1e-12,
  n: 1e-9,
  u: 1e-6,
  µ: 1e-6,
  m: 1e-3,
  k: 1e3,
  K: 1e3,
  M: 1e6,
  G: 1e9,
  T: 1e12,
};

const KNOWN_UNITS = ["ohm", "ohms", "Ω", "V", "A", "W", "F", "H", "Hz", "s", "degC", "C", "%"];

function parseScalarUnit(raw: string): { value: number; unit: string } | null {
  const s = raw.trim();
  const m = /^(-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)\s*([A-Za-zΩµ%]*)$/.exec(s);
  if (!m) return null;
  const num = Number.parseFloat(m[1]!);
  if (!Number.isFinite(num)) return null;
  const unitToken = m[2] ?? "";
  if (!unitToken) return { value: num, unit: "" };

  // Direct match to a base unit without prefix
  for (const u of KNOWN_UNITS) {
    if (unitToken === u) {
      return { value: num, unit: u === "ohms" || u === "Ω" ? "ohm" : u };
    }
  }
  // SI prefix + base unit (e.g. kohm, nF, uH, mV, MHz)
  const prefix = unitToken.charAt(0);
  const rest = unitToken.slice(1);
  const scale = SI_PREFIX[prefix];
  if (scale !== undefined) {
    for (const u of KNOWN_UNITS) {
      if (rest === u || rest === "") {
        return { value: num * scale, unit: rest === "ohms" || rest === "Ω" ? "ohm" : rest };
      }
    }
  }
  return { value: num, unit: unitToken };
}

/**
 * Parses an atopile physical literal with optional tolerance or range:
 *   - `10kohm +/- 1%`
 *   - `3.3V to 3.6V`
 *   - `100nF`
 */
export function parseAtoPhysicalValue(raw: string): AtoPhysicalValue | null {
  const s = raw.trim();
  if (!s) return null;

  // Range: `3.3V to 3.6V`
  const rangeMatch = /^(.+?)\s+to\s+(.+)$/i.exec(s);
  if (rangeMatch) {
    const lo = parseScalarUnit(rangeMatch[1]!);
    const hi = parseScalarUnit(rangeMatch[2]!);
    if (!lo || !hi) return null;
    const min = Math.min(lo.value, hi.value);
    const max = Math.max(lo.value, hi.value);
    return {
      raw: s,
      nominal: (min + max) / 2,
      unit: lo.unit || hi.unit,
      min,
      max,
    };
  }

  // Tolerance: `10kohm +/- 1%` or `5V +/- 0.1V`
  const tolMatch = /^(.+?)\s*(?:\+\/-|±)\s*(.+)$/.exec(s);
  if (tolMatch) {
    const base = parseScalarUnit(tolMatch[1]!);
    const tolRaw = tolMatch[2]!.trim();
    if (!base) return null;
    if (tolRaw.endsWith("%")) {
      const pct = Number.parseFloat(tolRaw.slice(0, -1));
      if (!Number.isFinite(pct)) return null;
      const delta = Math.abs(base.value) * (pct / 100);
      return {
        raw: s,
        nominal: base.value,
        unit: base.unit,
        tolerancePct: pct,
        min: base.value - delta,
        max: base.value + delta,
      };
    }
    const absTol = parseScalarUnit(tolRaw);
    if (!absTol) return null;
    return {
      raw: s,
      nominal: base.value,
      unit: base.unit,
      min: base.value - Math.abs(absTol.value),
      max: base.value + Math.abs(absTol.value),
    };
  }

  const scalar = parseScalarUnit(s);
  if (!scalar) return null;
  return {
    raw: s,
    nominal: scalar.value,
    unit: scalar.unit,
    min: scalar.value,
    max: scalar.value,
  };
}

function stripComment(line: string): string {
  let inQuote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQuote) {
      if (ch === "\\" && i + 1 < line.length) {
        i++;
        continue;
      }
      if (ch === inQuote) inQuote = null;
    } else if (ch === '"' || ch === "'") {
      inQuote = ch;
    } else if (ch === "#") {
      return line.slice(0, i);
    }
  }
  return line;
}

export function parseAtopile(source: string): AtoFile {
  const imports: AtoImport[] = [];
  const blocks: AtoBlock[] = [];
  const diagnostics: AtoDiagnostic[] = [];

  const lines = source.split(/\r?\n/);
  let currentBlock: AtoBlock | null = null;
  let offset = 0;

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const rawLine = lines[lineIdx]!;
    const lineStart = offset;
    const lineEnd = offset + rawLine.length;
    offset = lineEnd + 1;

    const cleaned = stripComment(rawLine);
    const trimmed = cleaned.trim();
    if (!trimmed) continue;

    const indent = cleaned.length - cleaned.trimStart().length;
    const span: AtoSpan = { startOffset: lineStart, endOffset: lineEnd, line: lineIdx + 1 };

    // Top-level imports
    if (indent === 0) {
      const fromImp = /^from\s+["']([^"']+)["']\s+import\s+(.+)$/.exec(trimmed);
      if (fromImp) {
        imports.push({
          source: fromImp[1]!,
          names: fromImp[2]!
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          span,
        });
        currentBlock = null;
        continue;
      }
      const simpleImp = /^import\s+(.+)$/.exec(trimmed);
      if (simpleImp) {
        imports.push({
          names: simpleImp[1]!
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          span,
        });
        currentBlock = null;
        continue;
      }

      // Block header: `module Foo:`, `component R from Resistor:`, `interface Power:`
      const blockMatch =
        /^(module|component|interface)\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s+from\s+([A-Za-z_][A-Za-z0-9_]*))?\s*:$/.exec(
          trimmed,
        );
      if (blockMatch) {
        const block: AtoBlock = {
          kind: blockMatch[1] as AtoBlock["kind"],
          name: blockMatch[2]!,
          signals: [],
          pins: [],
          instances: [],
          connections: [],
          assignments: [],
          assertions: [],
          span,
        };
        if (blockMatch[3]) block.baseName = blockMatch[3];
        blocks.push(block);
        currentBlock = block;
        continue;
      }

      diagnostics.push({
        code: "A1001",
        severity: "error",
        message: `Unrecognized top-level atopile statement: '${trimmed}'.`,
        span,
      });
      continue;
    }

    // Inside a block
    if (!currentBlock) {
      diagnostics.push({
        code: "A1001",
        severity: "error",
        message: `Unexpected indented statement outside module/component/interface: '${trimmed}'.`,
        span,
      });
      continue;
    }
    currentBlock.span.endOffset = lineEnd;

    if (trimmed === "pass") continue;

    // `signal vcc`
    const sigMatch = /^signal\s+([A-Za-z_][A-Za-z0-9_]*)$/.exec(trimmed);
    if (sigMatch) {
      currentBlock.signals.push(sigMatch[1]!);
      continue;
    }

    // `pin 1` / `pin a`
    const pinMatch = /^pin\s+([A-Za-z0-9_]+)$/.exec(trimmed);
    if (pinMatch) {
      currentBlock.pins.push(pinMatch[1]!);
      continue;
    }

    // `r1 = new Resistor` or `r = new Resistor[4]`
    const instMatch = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*new\s+([A-Za-z_][A-Za-z0-9_]*)(?:\[(\d+)\])?$/.exec(trimmed);
    if (instMatch) {
      const inst: AtoInstance = { name: instMatch[1]!, typeName: instMatch[2]!, span };
      if (instMatch[3]) inst.count = Number.parseInt(instMatch[3], 10);
      currentBlock.instances.push(inst);
      continue;
    }

    // `assert r1.resistance within 9kohm to 11kohm` or `assert v_out >= 3.0V`
    const assertMatch = /^assert\s+([A-Za-z_][A-Za-z0-9_.]*)\s+(within|<=|>=|<|>|==)\s+(.+)$/.exec(trimmed);
    if (assertMatch) {
      const bound = parseAtoPhysicalValue(assertMatch[3]!);
      if (bound) {
        const assertion: AtoAssertion = {
          target: assertMatch[1]!,
          operator: assertMatch[2] as AtoAssertion["operator"],
          bound,
          span,
        };
        currentBlock.assertions.push(assertion);
      } else {
        diagnostics.push({
          code: "A1001",
          severity: "error",
          message: `Invalid physical bound '${assertMatch[3]}' in assert statement.`,
          span,
        });
      }
      continue;
    }

    // Bridge connection: `v_in ~> r1 ~> v_out`
    if (trimmed.includes("~>")) {
      const parts = trimmed
        .split("~>")
        .map((p) => p.trim())
        .filter(Boolean);
      if (parts.length >= 3) {
        const conn: AtoConnection = { kind: "bridge", endpoints: parts, span };
        currentBlock.connections.push(conn);
        continue;
      }
    }

    // Direct connection: `r1.p1 ~ vcc` or `a ~ b ~ c`
    if (trimmed.includes("~")) {
      const parts = trimmed
        .split("~")
        .map((p) => p.trim())
        .filter(Boolean);
      if (parts.length >= 2) {
        const conn: AtoConnection = { kind: "direct", endpoints: parts, span };
        currentBlock.connections.push(conn);
        continue;
      }
    }

    // Property assignment: `r1.resistance = 10kohm +/- 1%` or `r1.mpn = "RC0603..."`
    const assignMatch = /^([A-Za-z_][A-Za-z0-9_.]*)\s*=\s*(.+)$/.exec(trimmed);
    if (assignMatch) {
      const target = assignMatch[1]!;
      const rawValue = assignMatch[2]!.trim();
      const assign: AtoAssignment = { target, rawValue, span };
      const strMatch = /^["'](.*)["']$/.exec(rawValue);
      if (strMatch) {
        assign.stringValue = strMatch[1]!;
      } else {
        const pv = parseAtoPhysicalValue(rawValue);
        if (pv) assign.physicalValue = pv;
      }
      currentBlock.assignments.push(assign);
      continue;
    }

    diagnostics.push({
      code: "A1001",
      severity: "error",
      message: `Unrecognized atopile statement inside '${currentBlock.name}': '${trimmed}'.`,
      span,
    });
  }

  return { imports, blocks, diagnostics };
}
