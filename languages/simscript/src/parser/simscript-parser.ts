// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Structured parser for SIMSCRIPT II.5 (RAND Discrete-Event Simulation Language).
 *
 * Parses PREAMBLE declarations (TEMPORARY/PERMANENT ENTITIES, PROCESSES, RESOURCES,
 * EVENT NOTICES, EVERY ... HAS / OWNS / BELONGS TO, DEFINE, TALLY, ACCUMULATE),
 * MAIN, PROCESS, EVENT, and ROUTINE blocks into a typed `SimscriptModel`.
 */

import type {
  SimscriptDefineDecl,
  SimscriptDistributionExpr,
  SimscriptEntityDecl,
  SimscriptEntityKind,
  SimscriptModel,
  SimscriptPreamble,
  SimscriptRoutineBlock,
  SimscriptSetDiscipline,
  SimscriptStatDecl,
  SimscriptStatMeasure,
  SimscriptStatement,
  SimscriptSyntaxError,
  SourceSpan,
} from "../types.js";

const NOISE_WORDS = new Set(["A", "AN", "THE", "EVERY", "AND", "SOME", "EACH"]);

interface SourceLine {
  lineNum: number;
  raw: string;
  clean: string;
  startOffset: number;
  endOffset: number;
}

function stripComment(line: string): string {
  const idx = line.indexOf("''");
  if (idx >= 0) return line.slice(0, idx).trim();
  return line.trim();
}

function splitLinesWithOffsets(source: string): SourceLine[] {
  const result: SourceLine[] = [];
  let offset = 0;
  let lineNum = 1;
  const parts = source.split("\n");
  for (const rawPart of parts) {
    const raw = rawPart.endsWith("\r") ? rawPart.slice(0, -1) : rawPart;
    const clean = stripComment(raw);
    result.push({
      lineNum,
      raw,
      clean,
      startOffset: offset,
      endOffset: offset + raw.length,
    });
    offset += rawPart.length + 1;
    lineNum++;
  }
  return result;
}

function makeSpan(sl: SourceLine): SourceSpan {
  const firstNonSpace = sl.raw.search(/\S/);
  return {
    line: sl.lineNum,
    column: firstNonSpace >= 0 ? firstNonSpace + 1 : 1,
    startOffset: sl.startOffset,
    endOffset: sl.endOffset,
  };
}

/**
 * Parses a SIMSCRIPT II.5 distribution expression or numeric constant.
 * Examples:
 * - `EXPONENTIAL.F(5.0, 1)`
 * - `NORMAL.F(10.0, 2.0, 2)`
 * - `UNIFORM.F(2.0, 8.0, 1)`
 * - `POISSON.F(3.0, 1)`
 * - `ERLANG.F(6.0, 2, 1)`
 * - `4.5`
 */
export function parseDistributionExpr(rawExpr: string): SimscriptDistributionExpr {
  const trimmed = rawExpr.trim();
  const fnMatch = trimmed.match(/^(EXPONENTIAL\.F|NORMAL\.F|UNIFORM\.F|POISSON\.F|ERLANG\.F)\s*\(([^)]*)\)/i);
  if (fnMatch) {
    const kind = fnMatch[1]!.toUpperCase() as SimscriptDistributionExpr["kind"];
    const parts = fnMatch[2]!
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => !Number.isNaN(n));
    let stream = 1;
    let args = parts;
    if (kind === "EXPONENTIAL.F" || kind === "POISSON.F") {
      if (parts.length >= 2) {
        stream = Math.max(1, Math.round(parts[1]!));
        args = [parts[0]!];
      }
    } else if (kind === "NORMAL.F" || kind === "UNIFORM.F" || kind === "ERLANG.F") {
      if (parts.length >= 3) {
        stream = Math.max(1, Math.round(parts[2]!));
        args = [parts[0]!, parts[1]!];
      }
    }
    return { kind, args, stream, raw: trimmed };
  }

  const numMatch = trimmed.match(/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/);
  const val = numMatch ? Number(numMatch[0]) : 1.0;
  return {
    kind: "CONSTANT",
    args: [Number.isNaN(val) ? 1.0 : val],
    stream: 1,
    raw: trimmed,
  };
}

function cleanIdentifierList(segment: string): string[] {
  return segment
    .split(/[\s,]+/)
    .map((t) => t.trim().toUpperCase())
    .filter((t) => t.length > 0 && !NOISE_WORDS.has(t) && /^[A-Z][A-Z0-9._]*$/.test(t));
}

function parseEveryClause(
  text: string,
  sectionKind: SimscriptEntityKind,
  span: SourceSpan,
  entities: SimscriptEntityDecl[],
  sets: Map<string, SimscriptSetDiscipline>,
): void {
  const match = text.match(/^EVERY\s+([A-Za-z][A-Za-z0-9._]*)\s*(.*)$/i);
  if (!match) return;
  const name = match[1]!.toUpperCase();
  const rest = match[2]!.trim();

  const attributes: string[] = [];
  const ownedSets: string[] = [];
  const belongsToSets: string[] = [];

  // Split clauses on HAS, OWNS, BELONGS TO, MAY BELONG TO
  const clauseRegex = /\b(HAS|OWNS|MAY\s+BELONG\s+TO|BELONGS\s+TO)\b/gi;
  const matches: Array<{ keyword: string; index: number; length: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = clauseRegex.exec(rest)) !== null) {
    matches.push({ keyword: m[1]!.toUpperCase().replace(/\s+/g, " "), index: m.index, length: m[0].length });
  }

  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i]!;
    const nextStart = i + 1 < matches.length ? matches[i + 1]!.index : rest.length;
    const body = rest.slice(cur.index + cur.length, nextStart).trim();
    const ids = cleanIdentifierList(body);
    if (cur.keyword === "HAS") {
      attributes.push(...ids);
    } else if (cur.keyword === "OWNS") {
      for (const s of ids) {
        ownedSets.push(s);
        if (!sets.has(s)) sets.set(s, "FIFO");
      }
    } else {
      belongsToSets.push(...ids);
    }
  }

  entities.push({
    name,
    kind: sectionKind,
    attributes,
    ownedSets,
    belongsToSets,
    span,
  });
}

function parseDefineClause(
  text: string,
  span: SourceSpan,
  defines: SimscriptDefineDecl[],
  sets: Map<string, SimscriptSetDiscipline>,
): void {
  const m = text.match(/^DEFINE\s+(.+?)\s+AS\s+(.+)$/i);
  if (!m) return;
  const names = cleanIdentifierList(m[1]!);
  const spec = m[2]!.toUpperCase();

  let dataType: SimscriptDefineDecl["dataType"] = "VARIABLE";
  let setDiscipline: SimscriptSetDiscipline | undefined;
  let dimensions: number | undefined;

  if (/\bSET\b/.test(spec)) {
    dataType = "SET";
    if (/\bLIFO\b/.test(spec)) setDiscipline = "LIFO";
    else if (/\bRANKED\b/.test(spec)) setDiscipline = "RANKED";
    else setDiscipline = "FIFO";
    for (const n of names) {
      sets.set(n, setDiscipline);
    }
  } else if (/\bREAL\b/.test(spec)) {
    dataType = "REAL";
  } else if (/\bINTEGER\b/.test(spec)) {
    dataType = "INTEGER";
  } else if (/\bALPHA\b/.test(spec)) {
    dataType = "ALPHA";
  } else if (/\bTEXT\b/.test(spec)) {
    dataType = "TEXT";
  }

  const dimMatch = spec.match(/(\d+)\s*-?\s*DIMENSIONAL/i);
  if (dimMatch) {
    dimensions = Number(dimMatch[1]);
  }

  defines.push({
    names,
    dataType,
    setDiscipline,
    dimensions,
    span,
  });
}

function parseStatClause(text: string, span: SourceSpan, stats: SimscriptStatDecl[]): void {
  const m = text.match(
    /^(TALLY|ACCUMULATE)\s+([A-Za-z][A-Za-z0-9._]*)\s+AS\s+(?:THE\s+)?(MEAN|MAX|MAXIMUM|MIN|MINIMUM|NUMBER|SUM|STD\.DEV|VARIANCE)\s+OF\s+([A-Za-z][A-Za-z0-9._]*)/i,
  );
  if (!m) return;
  const kind = m[1]!.toUpperCase() as "TALLY" | "ACCUMULATE";
  const statName = m[2]!.toUpperCase();
  let rawMeasure = m[3]!.toUpperCase();
  if (rawMeasure === "MAXIMUM") rawMeasure = "MAX";
  if (rawMeasure === "MINIMUM") rawMeasure = "MIN";
  const measure = rawMeasure as SimscriptStatMeasure;
  const target = m[4]!.toUpperCase();
  stats.push({ kind, statName, measure, target, span });
}

function parseStatement(
  clean: string,
  span: SourceSpan,
  syntaxErrors: SimscriptSyntaxError[],
): SimscriptStatement | null {
  const upper = clean.toUpperCase();

  if (/^START\s+SIMULATION\b/.test(upper)) {
    return { kind: "START_SIMULATION", span };
  }

  if (/^RETURN\b/.test(upper)) {
    return { kind: "RETURN", span };
  }

  if (/^STOP\b/.test(upper)) {
    return { kind: "STOP", span };
  }

  if (/^PRINT\b/.test(upper)) {
    return { kind: "PRINT", text: clean.slice(5).trim(), span };
  }

  // CREATE EVERY <RES>(N) or CREATE A/AN <ENTITY>
  const createEvery = clean.match(/^CREATE\s+EVERY\s+([A-Za-z][A-Za-z0-9._]*)\s*(?:\(\s*(\d+)\s*\))?/i);
  if (createEvery) {
    return {
      kind: "CREATE",
      entity: createEvery[1]!.toUpperCase(),
      every: true,
      count: createEvery[2] ? Number(createEvery[2]) : 1,
      span,
    };
  }
  const createOne = clean.match(/^CREATE\s+(?:A\s+|AN\s+|THE\s+)?([A-Za-z][A-Za-z0-9._]*)/i);
  if (createOne) {
    return { kind: "CREATE", entity: createOne[1]!.toUpperCase(), span };
  }

  // DESTROY [THIS|THE] <ENTITY>
  const destroyMatch = clean.match(/^DESTROY\s+(?:THIS\s+|THE\s+)?([A-Za-z][A-Za-z0-9._]*)/i);
  if (destroyMatch) {
    return { kind: "DESTROY", entity: destroyMatch[1]!.toUpperCase(), span };
  }

  // ACTIVATE [A|AN] <PROCESS> [NOW | IN <expr> [<units>]]
  const activateMatch = clean.match(
    /^ACTIVATE\s+(?:A\s+|AN\s+|THE\s+)?([A-Za-z][A-Za-z0-9._]*)(?:\s+(NOW)|(?:\s+IN\s+(.+)))?$/i,
  );
  if (activateMatch) {
    const processName = activateMatch[1]!.toUpperCase();
    const isNow = Boolean(activateMatch[2]) || !activateMatch[3];
    let delay: SimscriptDistributionExpr | undefined;
    let units: string | undefined;
    if (activateMatch[3]) {
      const rest = activateMatch[3].trim();
      const unitMatch = rest.match(/\b(DAYS|HOURS|MINUTES|SECONDS|UNITS)\s*$/i);
      const exprText = unitMatch ? rest.slice(0, unitMatch.index).trim() : rest;
      units = unitMatch ? unitMatch[1]!.toUpperCase() : undefined;
      delay = parseDistributionExpr(exprText);
    }
    return { kind: "ACTIVATE", processName, now: isNow, delay, units, span };
  }

  // SCHEDULE [A|AN] <EVENT> [NOW | IN <expr> [<units>]]
  const scheduleMatch = clean.match(
    /^SCHEDULE\s+(?:A\s+|AN\s+|THE\s+)?([A-Za-z][A-Za-z0-9._]*)(?:\s+(NOW)|(?:\s+IN\s+(.+)))?$/i,
  );
  if (scheduleMatch) {
    const eventName = scheduleMatch[1]!.toUpperCase();
    const isNow = Boolean(scheduleMatch[2]) || !scheduleMatch[3];
    let delay: SimscriptDistributionExpr | undefined;
    let units: string | undefined;
    if (scheduleMatch[3]) {
      const rest = scheduleMatch[3].trim();
      const unitMatch = rest.match(/\b(DAYS|HOURS|MINUTES|SECONDS|UNITS)\s*$/i);
      const exprText = unitMatch ? rest.slice(0, unitMatch.index).trim() : rest;
      units = unitMatch ? unitMatch[1]!.toUpperCase() : undefined;
      delay = parseDistributionExpr(exprText);
    }
    return { kind: "SCHEDULE", eventName, now: isNow, delay, units, span };
  }

  // WORK <expr> [<units>]
  const workMatch = clean.match(/^WORK\s+(.+)$/i);
  if (workMatch) {
    const rest = workMatch[1]!.trim();
    const unitMatch = rest.match(/\b(DAYS|HOURS|MINUTES|SECONDS|UNITS)\s*$/i);
    const exprText = unitMatch ? rest.slice(0, unitMatch.index).trim() : rest;
    const units = unitMatch ? unitMatch[1]!.toUpperCase() : undefined;
    return { kind: "WORK", duration: parseDistributionExpr(exprText), units, span };
  }

  // WAIT <expr> [<units>]
  const waitMatch = clean.match(/^WAIT\s+(.+)$/i);
  if (waitMatch) {
    const rest = waitMatch[1]!.trim();
    const unitMatch = rest.match(/\b(DAYS|HOURS|MINUTES|SECONDS|UNITS)\s*$/i);
    const exprText = unitMatch ? rest.slice(0, unitMatch.index).trim() : rest;
    const units = unitMatch ? unitMatch[1]!.toUpperCase() : undefined;
    return { kind: "WAIT", duration: parseDistributionExpr(exprText), units, span };
  }

  // REQUEST <qty> [UNIT|UNITS OF] <RES> [WITH PRIORITY <p>]
  const reqMatch = clean.match(
    /^REQUEST\s+(\d+)\s+(?:UNITS?\s+OF\s+)?([A-Za-z][A-Za-z0-9._]*)(?:\s*\([^)]*\))?(?:\s+WITH\s+PRIORITY\s+(\d+))?/i,
  );
  if (reqMatch) {
    return {
      kind: "REQUEST",
      quantity: Number(reqMatch[1]),
      resource: reqMatch[2]!.toUpperCase(),
      priority: reqMatch[3] ? Number(reqMatch[3]) : undefined,
      span,
    };
  }

  // RELINQUISH <qty> [UNIT|UNITS OF] <RES>
  const relMatch = clean.match(/^RELINQUISH\s+(\d+)\s+(?:UNITS?\s+OF\s+)?([A-Za-z][A-Za-z0-9._]*)(?:\s*\([^)]*\))?/i);
  if (relMatch) {
    return {
      kind: "RELINQUISH",
      quantity: Number(relMatch[1]),
      resource: relMatch[2]!.toUpperCase(),
      span,
    };
  }

  // FILE [THIS|THE] <ENTITY> IN [THE] <SET>
  const fileMatch = clean.match(
    /^FILE\s+(?:THIS\s+|THE\s+)?([A-Za-z][A-Za-z0-9._]*)\s+IN\s+(?:THE\s+)?([A-Za-z][A-Za-z0-9._]*)/i,
  );
  if (fileMatch) {
    return {
      kind: "FILE",
      entity: fileMatch[1]!.toUpperCase(),
      setName: fileMatch[2]!.toUpperCase(),
      span,
    };
  }

  // REMOVE [THE] [FIRST|LAST] <ENTITY> FROM [THE] <SET>
  const removeMatch = clean.match(
    /^REMOVE\s+(?:THE\s+)?(?:(FIRST|LAST)\s+)?([A-Za-z][A-Za-z0-9._]*)\s+FROM\s+(?:THE\s+)?([A-Za-z][A-Za-z0-9._]*)/i,
  );
  if (removeMatch) {
    return {
      kind: "REMOVE",
      position: removeMatch[1] ? (removeMatch[1].toUpperCase() as "FIRST" | "LAST") : undefined,
      entity: removeMatch[2]!.toUpperCase(),
      setName: removeMatch[3]!.toUpperCase(),
      span,
    };
  }

  // LET <target> = <expr>
  const letMatch = clean.match(/^LET\s+([A-Za-z][A-Za-z0-9._]*(?:\([^)]*\))?)\s*=\s*(.+)$/i);
  if (letMatch) {
    const target = letMatch[1]!.toUpperCase();
    const expression = letMatch[2]!.trim();
    const numVal = Number(expression);
    return {
      kind: "LET",
      target,
      expression,
      numericValue: !Number.isNaN(numVal) ? numVal : undefined,
      span,
    };
  }

  // Skip structural noise keywords inside blocks (DO, LOOP, ALWAYS, ENDIF, IF, ELSE, OTHERWISE)
  if (
    /^(DO|LOOP|ALWAYS|ENDIF|IF\b|ELSE\b|OTHERWISE\b|REGARDLESS\b|WHILE\b|UNTIL\b|ADD\b|SUBTRACT\b|WRITE\b|READ\b)/i.test(
      upper,
    )
  ) {
    return null;
  }

  syntaxErrors.push({
    message: `Unrecognized statement '${clean.slice(0, 60)}'`,
    line: span.line,
    column: span.column,
    startOffset: span.startOffset,
    endOffset: span.endOffset,
  });
  return null;
}

/**
 * Parses a SIMSCRIPT II.5 simulation program into a structured `SimscriptModel`.
 */
export function parseSimscript(source: string, fallbackName: string = "SimscriptModel"): SimscriptModel {
  const lines = splitLinesWithOffsets(source);
  const syntaxErrors: SimscriptSyntaxError[] = [];

  const preamble: SimscriptPreamble = {
    present: false,
    hasEnd: false,
    entities: [],
    defines: [],
    stats: [],
    sets: new Map(),
  };

  let main: SimscriptRoutineBlock | undefined;
  const processes = new Map<string, SimscriptRoutineBlock>();
  const events = new Map<string, SimscriptRoutineBlock>();
  const routines = new Map<string, SimscriptRoutineBlock>();
  const resourceCapacities = new Map<string, number>();
  const variables = new Map<string, number>();

  // Derive model name from first comment header if present
  let modelName = fallbackName;
  for (const sl of lines) {
    if (sl.raw.trim().startsWith("''")) {
      const commentText = sl.raw
        .trim()
        .replace(/^''+\s*/, "")
        .trim();
      const titleMatch = commentText.match(/^(?:MODEL|PROGRAM|TITLE)\s*[:=-]\s*([A-Za-z0-9_.-]+)/i);
      if (titleMatch) {
        modelName = titleMatch[1]!;
        break;
      }
    } else if (sl.clean.length > 0) {
      break;
    }
  }

  let idx = 0;

  while (idx < lines.length) {
    const sl = lines[idx]!;
    const clean = sl.clean;
    if (!clean) {
      idx++;
      continue;
    }
    const upper = clean.toUpperCase();

    // 1. PREAMBLE block
    if (/^PREAMBLE\b/.test(upper)) {
      preamble.present = true;
      preamble.span = makeSpan(sl);
      let sectionKind: SimscriptEntityKind = "temporary";
      idx++;

      while (idx < lines.length) {
        const pLine = lines[idx]!;
        const pClean = pLine.clean;
        if (!pClean) {
          idx++;
          continue;
        }
        const pUpper = pClean.toUpperCase();

        if (/^END\b/.test(pUpper)) {
          preamble.hasEnd = true;
          idx++;
          break;
        }
        if (/^(MAIN|PROCESS|EVENT|ROUTINE)\b/.test(pUpper) && !/^EVENT\s+NOTICES\b/.test(pUpper)) {
          // Missing END before next top-level block
          break;
        }

        const pSpan = makeSpan(pLine);

        if (/^TEMPORARY\s+ENTIT(?:Y|IES)\b/.test(pUpper)) {
          sectionKind = "temporary";
        } else if (/^PERMANENT\s+ENTIT(?:Y|IES)\b/.test(pUpper)) {
          sectionKind = "permanent";
        } else if (/^PROCESSES\b/.test(pUpper)) {
          sectionKind = "process";
        } else if (/^RESOURCES\b/.test(pUpper)) {
          sectionKind = "resource";
        } else if (/^EVENT\s+NOTICES\b/.test(pUpper)) {
          sectionKind = "event";
        } else if (/^INCLUDE\s+([A-Za-z][A-Za-z0-9._]*)/i.test(pClean)) {
          const incMatch = pClean.match(/^INCLUDE\s+(.+)$/i);
          if (incMatch) {
            for (const name of cleanIdentifierList(incMatch[1]!)) {
              preamble.entities.push({
                name,
                kind: sectionKind,
                attributes: [],
                ownedSets: [],
                belongsToSets: [],
                span: pSpan,
              });
            }
          }
        } else if (/^EVERY\b/.test(pUpper)) {
          parseEveryClause(pClean, sectionKind, pSpan, preamble.entities, preamble.sets);
        } else if (/^DEFINE\b/.test(pUpper)) {
          parseDefineClause(pClean, pSpan, preamble.defines, preamble.sets);
        } else if (/^(TALLY|ACCUMULATE)\b/.test(pUpper)) {
          parseStatClause(pClean, pSpan, preamble.stats);
        } else if (/^(THE\s+SYSTEM\s+OWNS)\b/.test(pUpper)) {
          const ownsMatch = pClean.match(/^THE\s+SYSTEM\s+OWNS\s+(.+)$/i);
          if (ownsMatch) {
            for (const s of cleanIdentifierList(ownsMatch[1]!)) {
              if (!preamble.sets.has(s)) preamble.sets.set(s, "FIFO");
            }
          }
        } else if (/^(NORMALLY|EXTERNAL|PRIORITY\s+ORDER|BREAK\s+TIES)\b/.test(pUpper)) {
          // Valid SIMSCRIPT II.5 preamble directives
        } else {
          syntaxErrors.push({
            message: `Unrecognized PREAMBLE declaration '${pClean.slice(0, 60)}'`,
            line: pSpan.line,
            column: pSpan.column,
            startOffset: pSpan.startOffset,
            endOffset: pSpan.endOffset,
          });
        }
        idx++;
      }
      continue;
    }

    // 2. MAIN / PROCESS / EVENT / ROUTINE blocks
    const blockHeader = clean.match(
      /^(MAIN|PROCESS|EVENT|ROUTINE)(?:\s+(?:TO\s+)?([A-Za-z][A-Za-z0-9._]*))?(?:\s+GIVEN\s+(.+))?$/i,
    );
    if (blockHeader) {
      const kind = blockHeader[1]!.toUpperCase() as SimscriptRoutineBlock["kind"];
      const name = kind === "MAIN" ? "MAIN" : (blockHeader[2] ?? "UNNAMED").toUpperCase();
      const parameters = blockHeader[3] ? cleanIdentifierList(blockHeader[3]) : [];
      const blockSpan = makeSpan(sl);
      const statements: SimscriptStatement[] = [];
      idx++;

      const loopStack: Array<{
        variable: string;
        start: number;
        end: number;
        body: SimscriptStatement[];
        span: SourceSpan;
      }> = [];

      while (idx < lines.length) {
        const bLine = lines[idx]!;
        const bClean = bLine.clean;
        if (!bClean) {
          idx++;
          continue;
        }
        const bUpper = bClean.toUpperCase();
        if (/^END\b/.test(bUpper)) {
          idx++;
          break;
        }
        if (/^(PREAMBLE|MAIN|PROCESS|EVENT|ROUTINE)\b/.test(bUpper)) {
          break;
        }

        const bSpan = makeSpan(bLine);

        // FOR <var> = <start> TO <end>[,] [DO]
        const forMatch = bClean.match(/^FOR\s+([A-Za-z][A-Za-z0-9._]*)\s*=\s*(\d+)\s+TO\s+(\d+)\s*,?\s*(?:DO)?$/i);
        if (forMatch) {
          loopStack.push({
            variable: forMatch[1]!.toUpperCase(),
            start: Number(forMatch[2]),
            end: Number(forMatch[3]),
            body: [],
            span: bSpan,
          });
          idx++;
          continue;
        }

        if (/^LOOP\b/.test(bUpper)) {
          const top = loopStack.pop();
          if (top) {
            const loopStmt: SimscriptStatement = {
              kind: "FOR_LOOP",
              variable: top.variable,
              start: top.start,
              end: top.end,
              body: top.body,
              span: top.span,
            };
            const parent = loopStack[loopStack.length - 1];
            if (parent) parent.body.push(loopStmt);
            else statements.push(loopStmt);
          }
          idx++;
          continue;
        }

        const stmt = parseStatement(bClean, bSpan, syntaxErrors);
        if (stmt) {
          // Track LET U.<RES> = <N> or LET <VAR> = <N>
          if (stmt.kind === "LET" && stmt.numericValue !== undefined) {
            const uMatch = stmt.target.match(/^U\.([A-Za-z][A-Za-z0-9._]*)(?:\(\d+\))?$/i);
            if (uMatch) {
              resourceCapacities.set(uMatch[1]!.toUpperCase(), stmt.numericValue);
            } else {
              variables.set(stmt.target, stmt.numericValue);
            }
          }
          const parent = loopStack[loopStack.length - 1];
          if (parent) parent.body.push(stmt);
          else statements.push(stmt);
        }
        idx++;
      }

      // Close any unclosed loops defensively
      while (loopStack.length > 0) {
        const top = loopStack.pop()!;
        statements.push({
          kind: "FOR_LOOP",
          variable: top.variable,
          start: top.start,
          end: top.end,
          body: top.body,
          span: top.span,
        });
      }

      const block: SimscriptRoutineBlock = {
        kind,
        name,
        parameters,
        statements,
        span: blockSpan,
      };

      if (kind === "MAIN") main = block;
      else if (kind === "PROCESS") processes.set(name, block);
      else if (kind === "EVENT") events.set(name, block);
      else routines.set(name, block);
      continue;
    }

    const span = makeSpan(sl);
    syntaxErrors.push({
      message: `Unexpected top-level statement '${clean.slice(0, 60)}'`,
      line: span.line,
      column: span.column,
      startOffset: span.startOffset,
      endOffset: span.endOffset,
    });
    idx++;
  }

  // Propagate resource capacities into Preamble entity declarations
  for (const ent of preamble.entities) {
    if (ent.kind === "resource") {
      const cap = resourceCapacities.get(ent.name);
      if (cap !== undefined) {
        ent.capacity = cap;
      }
    }
  }

  return {
    name: modelName,
    preamble,
    main,
    processes,
    events,
    routines,
    resourceCapacities,
    variables,
    syntaxErrors,
  };
}
