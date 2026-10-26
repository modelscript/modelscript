// SPDX-License-Identifier: AGPL-3.0-or-later

import type {
  DssCapacitor,
  DssCircuit,
  DssDeck,
  DssLine,
  DssLineCode,
  DssLoad,
  DssPVSystem,
  DssRange,
  DssStorage,
  DssTransformer,
} from "../types.js";

function isWhitespace(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\r" || ch === "\n";
}

/**
 * Extract clean bus identifier, removing node/phase suffixes (e.g. "SubBus.1.2.3" -> "SubBus").
 */
export function extractBaseBusName(rawBus: string): string {
  const dot = rawBus.indexOf(".");
  if (dot !== -1) {
    return rawBus.slice(0, dot).trim();
  }
  return rawBus.trim();
}

/**
 * Split line into key-value pairs without regex:
 * e.g. "New Line.L1 Bus1=B1 Bus2=B2 Length=500 Units=m"
 */
function parseKeyValuePairs(tokens: string[]): Map<string, string> {
  const pairs = new Map<string, string>();

  for (const tok of tokens) {
    const eqIdx = tok.indexOf("=");
    if (eqIdx !== -1) {
      const key = tok.slice(0, eqIdx).trim().toLowerCase();
      let val = tok.slice(eqIdx + 1).trim();
      // Strip brackets or quotes
      if (
        (val.startsWith("[") && val.endsWith("]")) ||
        (val.startsWith("(") && val.endsWith(")")) ||
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1).trim();
      }
      pairs.set(key, val);
    }
  }

  return pairs;
}

/**
 * Parse an array of values from a string: e.g. "115, 12.47" or "[b1, b2]"
 */
export function parseArrayValues(raw: string): string[] {
  let s = raw.trim();
  if ((s.startsWith("[") && s.endsWith("]")) || (s.startsWith("(") && s.endsWith(")"))) {
    s = s.slice(1, -1).trim();
  }

  const result: string[] = [];
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (ch === "," || ch === " " || ch === "\t") {
      if (cur.trim().length > 0) {
        result.push(cur.trim());
        cur = "";
      }
    } else {
      cur += ch;
    }
  }
  if (cur.trim().length > 0) {
    result.push(cur.trim());
  }

  return result;
}

/**
 * Zero-regex parser for EPRI OpenDSS distribution circuit files (.dss).
 */
export function parseOpenDss(content: string, filename?: string): DssDeck {
  const comments: string[] = [];
  const linesMap = new Map<string, DssLine>();
  const transformers = new Map<string, DssTransformer>();
  const loads = new Map<string, DssLoad>();
  const pvSystems = new Map<string, DssPVSystem>();
  const storages = new Map<string, DssStorage>();
  const capacitors = new Map<string, DssCapacitor>();
  const lineCodes = new Map<string, DssLineCode>();
  const voltageBases: number[] = [];
  let circuit: DssCircuit | undefined;

  // Split lines manually
  const rawLines: string[] = [];
  let lineStart = 0;
  const len = content.length;
  for (let i = 0; i < len; i++) {
    if (content[i] === "\n") {
      rawLines.push(content.slice(lineStart, i));
      lineStart = i + 1;
    } else if (content[i] === "\r") {
      rawLines.push(content.slice(lineStart, i));
      if (i + 1 < len && content[i + 1] === "\n") i++;
      lineStart = i + 1;
    }
  }
  if (lineStart < len) {
    rawLines.push(content.slice(lineStart));
  }

  for (let lineNum = 0; lineNum < rawLines.length; lineNum++) {
    let lineText = rawLines[lineNum]!;

    // Strip comments: !, //
    const exclamIdx = lineText.indexOf("!");
    if (exclamIdx !== -1) {
      comments.push(lineText.slice(exclamIdx + 1).trim());
      lineText = lineText.slice(0, exclamIdx);
    }
    const slashSlashIdx = lineText.indexOf("//");
    if (slashSlashIdx !== -1) {
      comments.push(lineText.slice(slashSlashIdx + 2).trim());
      lineText = lineText.slice(0, slashSlashIdx);
    }

    lineText = lineText.trim();
    if (lineText.length === 0) continue;

    // Tokenize words, preserving brackets and quoted strings
    const tokens: string[] = [];
    let i = 0;
    const lLen = lineText.length;
    while (i < lLen) {
      while (i < lLen && isWhitespace(lineText[i]!)) i++;
      if (i >= lLen) break;

      let tok = "";
      let inBrackets = false;
      let inQuotes = false;
      let quoteChar = "";

      while (i < lLen) {
        const ch = lineText[i]!;
        if (!inBrackets && !inQuotes && isWhitespace(ch)) {
          break;
        }

        if (ch === "[" || ch === "(") {
          inBrackets = true;
        } else if (ch === "]" || ch === ")") {
          inBrackets = false;
        } else if (ch === '"' || ch === "'") {
          if (!inQuotes) {
            inQuotes = true;
            quoteChar = ch;
          } else if (quoteChar === ch) {
            inQuotes = false;
          }
        }

        tok += ch;
        i++;
      }

      if (tok.length > 0) tokens.push(tok);
    }

    if (tokens.length === 0) continue;

    const firstWord = tokens[0]!.toLowerCase();
    const range: DssRange = {
      startLine: lineNum + 1,
      startCol: 1,
      endLine: lineNum + 1,
      endCol: lineText.length + 1,
    };

    if (firstWord === "new" || firstWord === "edit") {
      if (tokens.length < 2) continue;
      const target = tokens[1]!;
      const dotIdx = target.indexOf(".");
      const elemClass = (dotIdx !== -1 ? target.slice(0, dotIdx) : target).toLowerCase();
      const elemName = dotIdx !== -1 ? target.slice(dotIdx + 1) : "Default";
      const props = parseKeyValuePairs(tokens.slice(2));

      if (elemClass === "circuit") {
        circuit = {
          name: elemName,
          baseKv: parseFloat(props.get("basekv") ?? "115.0") || 115.0,
          pu: parseFloat(props.get("pu") ?? "1.0") || 1.0,
          phases: parseInt(props.get("phases") ?? "3", 10) || 3,
          bus1: extractBaseBusName(props.get("bus1") ?? "SourceBus"),
          angle: props.has("angle") ? parseFloat(props.get("angle")!) : 0,
          frequency: props.has("frequency") ? parseFloat(props.get("frequency")!) : 60,
          range,
        };
      } else if (elemClass === "line") {
        const bus1 = extractBaseBusName(props.get("bus1") ?? "Bus1");
        const bus2 = extractBaseBusName(props.get("bus2") ?? "Bus2");
        const phases = parseInt(props.get("phases") ?? "3", 10) || 3;
        const length = parseFloat(props.get("length") ?? "1.0") || 1.0;
        const lineCode = props.get("linecode");
        const r1 = props.has("r1") ? parseFloat(props.get("r1")!) : undefined;
        const x1 = props.has("x1") ? parseFloat(props.get("x1")!) : undefined;
        const c1 = props.has("c1") ? parseFloat(props.get("c1")!) : undefined;

        linesMap.set(elemName, {
          name: elemName,
          bus1,
          bus2,
          phases,
          length,
          units: props.get("units"),
          lineCode,
          r1,
          x1,
          c1,
          range,
        });
      } else if (elemClass === "transformer") {
        const phases = parseInt(props.get("phases") ?? "3", 10) || 3;
        const windings = parseInt(props.get("windings") ?? "2", 10) || 2;
        const rawBuses = props.get("buses") ?? "";
        const buses = parseArrayValues(rawBuses).map(extractBaseBusName);
        const rawKvs = props.get("kvs") ?? "";
        const kvs = parseArrayValues(rawKvs).map((v) => parseFloat(v) || 12.47);
        const rawKvas = props.get("kvas") ?? "";
        const kvas = parseArrayValues(rawKvas).map((v) => parseFloat(v) || 1000);

        transformers.set(elemName, {
          name: elemName,
          phases,
          windings,
          buses: buses.length > 0 ? buses : ["Bus1", "Bus2"],
          kvs: kvs.length > 0 ? kvs : [115.0, 12.47],
          kvas: kvas.length > 0 ? kvas : [10000.0, 10000.0],
          pctLoadLoss: props.has("%loadloss") ? parseFloat(props.get("%loadloss")!) : undefined,
          xhl: props.has("xhl") ? parseFloat(props.get("xhl")!) : undefined,
          range,
        });
      } else if (elemClass === "load") {
        const bus1 = extractBaseBusName(props.get("bus1") ?? "Bus1");
        const phases = parseInt(props.get("phases") ?? "3", 10) || 3;
        const kv = parseFloat(props.get("kv") ?? "12.47") || 12.47;
        const kw = parseFloat(props.get("kw") ?? "100.0");
        const kvar = parseFloat(props.get("kvar") ?? "30.0") || 0.0;

        loads.set(elemName, {
          name: elemName,
          bus1,
          phases,
          kv,
          kw: isNaN(kw) ? 100.0 : kw,
          kvar,
          model: props.has("model") ? parseInt(props.get("model")!, 10) : 1,
          range,
        });
      } else if (elemClass === "pvsystem") {
        const bus1 = extractBaseBusName(props.get("bus1") ?? "Bus1");
        const phases = parseInt(props.get("phases") ?? "3", 10) || 3;
        const kv = parseFloat(props.get("kv") ?? "12.47") || 12.47;
        const kva = parseFloat(props.get("kva") ?? "500.0") || 500.0;
        const pmpp = parseFloat(props.get("pmpp") ?? "450.0") || 450.0;

        pvSystems.set(elemName, {
          name: elemName,
          bus1,
          phases,
          kv,
          kva,
          pmpp,
          range,
        });
      } else if (elemClass === "storage") {
        const bus1 = extractBaseBusName(props.get("bus1") ?? "Bus1");
        const phases = parseInt(props.get("phases") ?? "3", 10) || 3;
        const kv = parseFloat(props.get("kv") ?? "12.47") || 12.47;
        const kwRated = parseFloat(props.get("kwrated") ?? "250.0") || 250.0;
        const kwhRated = parseFloat(props.get("kwhrated") ?? "1000.0") || 1000.0;

        storages.set(elemName, {
          name: elemName,
          bus1,
          phases,
          kv,
          kwRated,
          kwhRated,
          range,
        });
      } else if (elemClass === "capacitor") {
        const bus1 = extractBaseBusName(props.get("bus1") ?? "Bus1");
        const phases = parseInt(props.get("phases") ?? "3", 10) || 3;
        const kvar = parseFloat(props.get("kvar") ?? "600.0") || 600.0;
        const kv = parseFloat(props.get("kv") ?? "12.47") || 12.47;

        capacitors.set(elemName, {
          name: elemName,
          bus1,
          phases,
          kvar,
          kv,
          range,
        });
      } else if (elemClass === "linecode") {
        const nphases = parseInt(props.get("nphases") ?? "3", 10) || 3;
        const r1 = parseFloat(props.get("r1") ?? "0.1") || 0.1;
        const x1 = parseFloat(props.get("x1") ?? "0.4") || 0.4;
        const c1 = props.has("c1") ? parseFloat(props.get("c1")!) : undefined;

        lineCodes.set(elemName, {
          name: elemName,
          nphases,
          r1,
          x1,
          c1,
          range,
        });
      }
    } else if (firstWord === "set") {
      const rest = tokens.slice(1).join(" ");
      const eqIdx = rest.indexOf("=");
      if (eqIdx !== -1) {
        const prop = rest.slice(0, eqIdx).trim().toLowerCase();
        const val = rest.slice(eqIdx + 1).trim();
        if (prop.startsWith("voltagebases")) {
          const vals = parseArrayValues(val);
          for (const v of vals) {
            const num = parseFloat(v);
            if (!isNaN(num)) voltageBases.push(num);
          }
        }
      }
    }
  }

  return {
    circuit,
    lines: linesMap,
    transformers,
    loads,
    pvSystems,
    storages,
    capacitors,
    lineCodes,
    voltageBases,
    comments,
    sourceFile: filename,
  };
}

/**
 * Serialize an OpenDSS AST back into .dss script text.
 */
export function serializeOpenDss(deck: DssDeck): string {
  const lines: string[] = [];

  lines.push("! ModelScript OpenDSS Circuit Serializer");
  for (const c of deck.comments) {
    lines.push(`! ${c}`);
  }
  lines.push("Clear");
  lines.push("");

  if (deck.circuit) {
    const c = deck.circuit;
    lines.push(`New Circuit.${c.name} basekv=${c.baseKv} pu=${c.pu} phases=${c.phases} bus1=${c.bus1}`);
  }

  for (const [, lc] of deck.lineCodes) {
    lines.push(`New LineCode.${lc.name} nphases=${lc.nphases} r1=${lc.r1} x1=${lc.x1}`);
  }

  for (const [, xfmr] of deck.transformers) {
    lines.push(
      `New Transformer.${xfmr.name} phases=${xfmr.phases} windings=${xfmr.windings} buses=[${xfmr.buses.join(", ")}] kvs=[${xfmr.kvs.join(", ")}] kvas=[${xfmr.kvas.join(", ")}]`,
    );
  }

  for (const [, line] of deck.lines) {
    let s = `New Line.${line.name} bus1=${line.bus1} bus2=${line.bus2} phases=${line.phases} length=${line.length}`;
    if (line.lineCode) s += ` linecode=${line.lineCode}`;
    if (line.r1 !== undefined) s += ` r1=${line.r1}`;
    if (line.x1 !== undefined) s += ` x1=${line.x1}`;
    lines.push(s);
  }

  for (const [, cap] of deck.capacitors) {
    lines.push(`New Capacitor.${cap.name} bus1=${cap.bus1} phases=${cap.phases} kvar=${cap.kvar} kv=${cap.kv}`);
  }

  for (const [, load] of deck.loads) {
    lines.push(
      `New Load.${load.name} bus1=${load.bus1} phases=${load.phases} kv=${load.kv} kw=${load.kw} kvar=${load.kvar}`,
    );
  }

  for (const [, pv] of deck.pvSystems) {
    lines.push(`New PVSystem.${pv.name} bus1=${pv.bus1} phases=${pv.phases} kv=${pv.kv} kva=${pv.kva} pmpp=${pv.pmpp}`);
  }

  for (const [, st] of deck.storages) {
    lines.push(
      `New Storage.${st.name} bus1=${st.bus1} phases=${st.phases} kv=${st.kv} kwrated=${st.kwRated} kwhrated=${st.kwhRated}`,
    );
  }

  if (deck.voltageBases.length > 0) {
    lines.push(`Set VoltageBases = [${deck.voltageBases.join(", ")}]`);
    lines.push("CalcVoltageBases");
  }

  lines.push("Solve");
  return lines.join("\n") + "\n";
}
