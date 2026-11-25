// SPDX-License-Identifier: AGPL-3.0-or-later

export interface SimulinkDropTextEdit {
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
  newText: string;
}

export interface SimulinkForeignDropInfo {
  cleanName: string;
  shortName: string;
  sourceLanguage: string;
  explicitLanguage: string | null;
  symbol: unknown | null;
  ports: Array<{ name: string; direction?: string }>;
  params: Array<{ name: string; defaultValue: string }>;
}

export interface SimulinkDropBuildOptions {
  docText: string;
  info: SimulinkForeignDropInfo;
  x: number;
  y: number;
  instanceName?: string | undefined;
  section?: string | undefined;
  batchState?: unknown;
  sanitizeIdentifier: (raw: string, fallback?: string) => string;
  allocateUniqueIdentifier: (docText: string, baseName: string, batchState?: unknown) => string;
}

const SIMULINK_NATIVE_BLOCK_TYPES = new Set<string>([
  "Inport",
  "Outport",
  "Constant",
  "Integrator",
  "UnitDelay",
  "Gain",
  "Sum",
  "Product",
  "TransferFcn",
  "DiscreteFilter",
  "StateSpace",
  "SubSystem",
  "BusCreator",
  "BusSelector",
  "Mux",
  "Demux",
  "Math",
  "RelationalOperator",
  "LogicalOperator",
  "Switch",
  "Scope",
  "Lookup_nD",
  "Ground",
  "Terminator",
]);

function isWsChar(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\r" || ch === "\n";
}

function stripHashCommentOutsideQuotes(line: string): string {
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === "\\" && i + 1 < line.length) {
        i++;
        continue;
      }
      if (ch === '"') inQuotes = false;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === "#") return line.slice(0, i);
    }
  }
  return line;
}

function findSimulinkTargetSystemInsertLine(docText: string, section?: string): number {
  const lines = docText.split("\n");
  const stack: Array<{ kind: string; name?: string; openLine: number }> = [];
  let rootSystemCloseLine = -1;
  let sectionSystemCloseLine = -1;
  let pendingNameTarget = false;
  let lastWord = "";

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    const stripped = stripHashCommentOutsideQuotes(raw);
    let j = 0;
    let inQuotes = false;
    let token = "";

    const flushToken = () => {
      if (!token) return;
      lastWord = token;
      if (pendingNameTarget && stack.length > 0 && !stack[stack.length - 1]!.name) {
        // Ignore bare unquoted Name token keyword itself
      } else if (token === "Name") {
        pendingNameTarget = true;
      } else {
        pendingNameTarget = false;
      }
      token = "";
    };

    while (j < stripped.length) {
      const ch = stripped[j]!;
      if (inQuotes) {
        if (ch === "\\" && j + 1 < stripped.length) {
          j += 2;
          continue;
        }
        if (ch === '"') {
          if (pendingNameTarget && stack.length > 0) {
            stack[stack.length - 1]!.name = token;
            pendingNameTarget = false;
          }
          token = "";
          lastWord = "";
          inQuotes = false;
        } else {
          token += ch;
        }
        j++;
        continue;
      }

      if (ch === '"') {
        flushToken();
        inQuotes = true;
        token = "";
        j++;
        continue;
      }
      if (ch === "{") {
        const blockKind = token.trim() || lastWord || "Block";
        token = "";
        lastWord = "";
        pendingNameTarget = false;
        stack.push({ kind: blockKind, openLine: i });
        j++;
        continue;
      }
      if (ch === "}") {
        flushToken();
        const popped = stack.pop();
        if (popped && popped.kind.toLowerCase() === "system") {
          const parent = stack[stack.length - 1];
          if (parent && parent.kind.toLowerCase() === "model" && rootSystemCloseLine === -1) {
            rootSystemCloseLine = i;
          }
          if (section && popped.name === section) {
            sectionSystemCloseLine = i;
          }
        }
        j++;
        continue;
      }
      if (isWsChar(ch)) {
        flushToken();
      } else {
        token += ch;
      }
      j++;
    }
    if (!inQuotes) {
      flushToken();
    }
  }

  if (sectionSystemCloseLine !== -1) return sectionSystemCloseLine;
  if (rootSystemCloseLine !== -1) return rootSystemCloseLine;
  return Math.max(0, lines.length - 1);
}

/**
 * Computes `.mdl` TextEdits inserting either a native Simulink `Block` or a self-consistent
 * `SubSystem` `@twin` black-box stub preserving the foreign symbol's ports and parameters.
 */
export function buildSimulinkComponentDropEdits(opts: SimulinkDropBuildOptions): SimulinkDropTextEdit[] {
  const { docText, info, x, y, instanceName, section, batchState, sanitizeIdentifier, allocateUniqueIdentifier } = opts;

  const nativeMatch = Array.from(SIMULINK_NATIVE_BLOCK_TYPES).find(
    (bt) => bt.toLowerCase() === info.shortName.toLowerCase(),
  );
  const isForeign =
    info.sourceLanguage !== "simulink" &&
    (info.symbol !== null ||
      info.explicitLanguage !== null ||
      (info.sourceLanguage !== "unknown" && !nativeMatch) ||
      (!nativeMatch && info.cleanName.includes(".")));

  const instName = instanceName
    ? sanitizeIdentifier(instanceName, "blk")
    : allocateUniqueIdentifier(docText, info.shortName, batchState);

  const rx = Math.round(x);
  const ry = Math.round(y);
  const insertLine = findSimulinkTargetSystemInsertLine(docText, section);
  const insertPos = { line: insertLine, character: 0 };

  if (!isForeign && nativeMatch) {
    const paramLine =
      nativeMatch === "Gain" ? `      Gain "1"\n` : nativeMatch === "Constant" ? `      Value "1"\n` : "";
    const blockText = [
      `    Block {`,
      `      BlockType ${nativeMatch}`,
      `      Name "${instName}"`,
      `      Position [${rx}, ${ry}, ${rx + 80}, ${ry + 40}]`,
      ...(paramLine ? [paramLine.trimEnd()] : []),
      `    }`,
    ].join("\n");
    return [{ range: { start: insertPos, end: insertPos }, newText: `${blockText}\n` }];
  }

  const inPorts: Array<{ name: string; direction?: string }> = [];
  const outPorts: Array<{ name: string; direction?: string }> = [];
  for (const p of info.ports) {
    if (p.direction === "out") outPorts.push(p);
    else if (p.direction === "in") inPorts.push(p);
    else {
      if (inPorts.length <= outPorts.length) inPorts.push(p);
      else outPorts.push(p);
    }
  }

  const innerLines: string[] = [`        Name "${instName}"`];
  let rowY = 40;
  inPorts.forEach((p, idx) => {
    innerLines.push(
      `        Block {`,
      `          BlockType Inport`,
      `          Name "${p.name}"`,
      `          Port "${idx + 1}"`,
      `          Position [40, ${rowY}, 70, ${rowY + 20}]`,
      `        }`,
    );
    rowY += 50;
  });

  rowY = 40;
  outPorts.forEach((p, idx) => {
    innerLines.push(
      `        Block {`,
      `          BlockType Outport`,
      `          Name "${p.name}"`,
      `          Port "${idx + 1}"`,
      `          Position [260, ${rowY}, 290, ${rowY + 20}]`,
      `        }`,
    );
    rowY += 50;
  });

  if (outPorts.length > 0) {
    if (inPorts.length > 0) {
      outPorts.forEach((op, idx) => {
        const srcIn = inPorts[Math.min(idx, inPorts.length - 1)]!;
        innerLines.push(
          `        Line {`,
          `          SrcBlock "${srcIn.name}"`,
          `          SrcPort 1`,
          `          DstBlock "${op.name}"`,
          `          DstPort 1`,
          `        }`,
        );
      });
    } else {
      innerLines.push(
        `        Block {`,
        `          BlockType Constant`,
        `          Name "${instName}_src"`,
        `          Value "0"`,
        `          Position [120, 40, 150, 70]`,
        `        }`,
      );
      for (const op of outPorts) {
        innerLines.push(
          `        Line {`,
          `          SrcBlock "${instName}_src"`,
          `          SrcPort 1`,
          `          DstBlock "${op.name}"`,
          `          DstPort 1`,
          `        }`,
        );
      }
    }
  }

  const paramAttrs = info.params
    .slice(0, 8)
    .map((p) => `      ${sanitizeIdentifier(p.name, "Param")} "${p.defaultValue.replaceAll('"', "'")}"`);

  const subBlock = [
    `    # @twin ${info.cleanName} (${info.sourceLanguage})`,
    `    Block {`,
    `      BlockType SubSystem`,
    `      Name "${instName}"`,
    `      Tag "@twin ${info.cleanName}"`,
    `      Ports [${inPorts.length}, ${outPorts.length}]`,
    `      Position [${rx}, ${ry}, ${rx + 110}, ${ry + 64}]`,
    ...paramAttrs,
    `      System {`,
    ...innerLines,
    `      }`,
    `    }`,
  ].join("\n");

  return [{ range: { start: insertPos, end: insertPos }, newText: `${subBlock}\n` }];
}
