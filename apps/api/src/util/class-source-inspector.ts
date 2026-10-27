// SPDX-License-Identifier: AGPL-3.0-or-later

import fs from "node:fs";
import path from "node:path";
import { parseSysmlSourceMetadata } from "../artifacts/sysml-handler.js";

export interface ExtractedClassComponent {
  component_name: string;
  type_name: string;
  description: string | null;
  causality: string | null;
  variability: string | null;
  modifiers: { modifier_name: string; modifier_value: string | null }[];
}

export interface InspectedClassSource {
  sourceFile: string | null;
  sourceCode: string | null;
  equations: string[];
  extractedComponents: ExtractedClassComponent[];
  sysmlConfig?: ReturnType<typeof parseSysmlSourceMetadata> | undefined;
  cadResourceUrl?: string | undefined;
}

function listAllFiles(dir: string, relPrefix = ""): { fullPath: string; relPath: string }[] {
  const results: { fullPath: string; relPath: string }[] = [];
  if (!fs.existsSync(dir)) return results;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist") continue;
      const relPath = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...listAllFiles(fullPath, relPath));
      } else if (entry.isFile()) {
        results.push({ fullPath, relPath });
      }
    }
  } catch {
    // ignore read errors
  }
  return results;
}

/**
 * Extract equations and connect statements from a Modelica class body.
 */
export function extractModelicaEquations(code: string): string[] {
  const equations: string[] = [];
  const eqSectionRegex =
    /\b(?:initial\s+equation|equation)\b([\s\S]*?)(?=\b(?:initial\s+equation|equation|initial\s+algorithm|algorithm|public|protected|annotation|end\s+[A-Za-z0-9_]+)\b|$)/g;
  let m: RegExpExecArray | null;
  while ((m = eqSectionRegex.exec(code)) !== null) {
    const body = m[1] ?? "";
    const statements = body
      .split(";")
      .map((s) =>
        s
          .replace(/\/\/.*$/gm, "")
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .trim(),
      )
      .filter((s) => s.length > 0 && !s.startsWith("annotation"));
    for (const stmt of statements) {
      const cleaned = stmt.replace(/\s*\bannotation\s*\([\s\S]*$/, "").trim();
      if (cleaned) {
        equations.push(`${cleaned};`);
      }
    }
  }
  return equations;
}

/**
 * Lightweight fallback parser for Modelica component declarations when a class was indexed without full CST components.
 */
export function extractModelicaComponentsFromSource(code: string): ExtractedClassComponent[] {
  const components: ExtractedClassComponent[] = [];
  const lines = code.split(/\r?\n/);
  let inEquationOrAlgo = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("//") || line.startsWith("/*") || line.startsWith("*")) continue;
    if (/^(?:initial\s+)?(?:equation|algorithm)\b/.test(line)) {
      inEquationOrAlgo = true;
      continue;
    }
    if (/^(?:public|protected)\b/.test(line)) {
      inEquationOrAlgo = false;
      continue;
    }
    if (/^end\s+[A-Za-z_][A-Za-z0-9_]*\s*;/.test(line)) {
      break;
    }
    if (inEquationOrAlgo) continue;
    if (/^(?:within|model|block|class|connector|record|package|function|type|extends|import|annotation)\b/.test(line)) {
      continue;
    }

    // Match component declaration: [parameter|constant|discrete] [input|output] <Type> <name>[(mods)] [= val] ["desc"];
    const declMatch = line.match(
      /^(?:(parameter|constant|discrete)\s+)?(?:(input|output)\s+)?([A-Za-z_][A-Za-z0-9_.]*(?:\[[^\]]*\])?)\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s*\(([^)]*)\))?(?:\s*=\s*([^";]+))?(?:\s*"([^"]*)")?\s*;/,
    );
    if (declMatch) {
      const variability = declMatch[1] ?? null;
      const causality = declMatch[2] ?? null;
      const typeName = declMatch[3]!;
      const compName = declMatch[4]!;
      const rawMods = declMatch[5]?.trim();
      const bindingVal = declMatch[6]?.trim();
      const description = declMatch[7]?.trim() ?? null;

      const modifiers: { modifier_name: string; modifier_value: string | null }[] = [];
      if (bindingVal) {
        modifiers.push({ modifier_name: "value", modifier_value: bindingVal });
      }
      if (rawMods) {
        for (const part of rawMods.split(",")) {
          const kv = part.split("=");
          if (kv.length === 2 && kv[0] && kv[1]) {
            modifiers.push({ modifier_name: kv[0].trim(), modifier_value: kv[1].trim().replace(/^["']|["']$/g, "") });
          }
        }
      }

      components.push({
        component_name: compName,
        type_name: typeName,
        description,
        causality,
        variability,
        modifiers,
      });
    }
  }

  return components;
}

/**
 * Extract components (attributes, ports, parts, requirements) from SysML v2 source code.
 */
export function extractSysmlComponentsFromSource(code: string): ExtractedClassComponent[] {
  const components: ExtractedClassComponent[] = [];
  const seen = new Set<string>();

  // Attributes: attribute <name> : <Type> = <val>;
  const attrRegex =
    /\battribute\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s*:\s*([A-Za-z_][A-Za-z0-9_.:]*))?(?:\s*=\s*([^;{\n]+))?\s*;/g;
  let m: RegExpExecArray | null;
  while ((m = attrRegex.exec(code)) !== null) {
    const name = m[1]!;
    if (seen.has(name)) continue;
    seen.add(name);
    const typeName = m[2]?.trim() || "Real";
    const defaultVal = m[3]?.trim() || null;
    components.push({
      component_name: name,
      type_name: typeName,
      description: null,
      causality: null,
      variability: "parameter",
      modifiers: defaultVal ? [{ modifier_name: "value", modifier_value: defaultVal }] : [],
    });
  }

  // Ports: port [in|out|inout] <name> : <Type>
  const portRegex =
    /\bport\s+(?!def\b)(?:(in|out|inout)\s+)?([A-Za-z_][A-Za-z0-9_]*)(?:\s*:\s*([A-Za-z_][A-Za-z0-9_.:]*))?/g;
  while ((m = portRegex.exec(code)) !== null) {
    const dir = m[1];
    const name = m[2]!;
    if (seen.has(name)) continue;
    seen.add(name);
    const typeName = m[3]?.trim() || "Port";
    components.push({
      component_name: name,
      type_name: typeName,
      description: null,
      causality: dir === "in" ? "input" : dir === "out" ? "output" : "connector",
      variability: null,
      modifiers: [],
    });
  }

  // Parts: part <name> : <Type>[mult]
  const parsed = parseSysmlSourceMetadata(code);
  for (const part of parsed.parts) {
    if (seen.has(part.name)) continue;
    seen.add(part.name);
    components.push({
      component_name: part.name,
      type_name: part.type,
      description: part.description ?? null,
      causality: null,
      variability: null,
      modifiers:
        part.multiplicity && part.multiplicity !== "1"
          ? [{ modifier_name: "multiplicity", modifier_value: part.multiplicity }]
          : [],
    });
  }

  return components;
}

/**
 * Extract a specific package or definition block (with any leading `doc` comment) from SysML v2 / KerML source.
 */
export function extractSysmlDeclarationBlock(content: string, className: string): string | null {
  const parts = className.split(".");
  const shortName = parts[parts.length - 1] ?? className;
  const parentName = parts.length > 1 ? parts[parts.length - 2] : null;

  let searchSpace = content;
  if (parentName) {
    const parentBlock = extractSingleSysmlBlock(content, parentName);
    if (!parentBlock) {
      return null;
    }
    searchSpace = parentBlock;
  }

  return extractSingleSysmlBlock(searchSpace, shortName);
}

function extractSingleSysmlBlock(source: string, shortName: string): string | null {
  const escaped = shortName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const declRegex = new RegExp(
    `\\b(?:abstract\\s+|standard\\s+|library\\s+)*(?:package|(?:attribute|part|item|port|connection|interface|allocation|action|state|constraint|requirement|calc|calculation|case|analysis|verification|use\\s+case|view|viewpoint|rendering|metadata|enum|enumeration|occurrence|flow|individual)\\s+def|datatype|classifier|struct|class|assoc|behavior|function|predicate|interaction|part|attribute|port|requirement|action|state|constraint|calc|item)\\s+(?:<[^>]+>\\s+)?'?${escaped}'?\\b`,
    "m",
  );
  const match = declRegex.exec(source);
  if (!match || match.index === undefined) return null;

  const startIdx = match.index;
  // Scan forward from the end of match to find either ';' (before '{') or balanced '{ ... }'
  let i = startIdx + match[0].length;
  let depth = 0;
  let foundBrace = false;
  let inBlockComment = false;
  let inLineComment = false;
  let inString: string | null = null;

  while (i < source.length) {
    const ch = source[i]!;
    const next = source[i + 1];

    if (inLineComment) {
      if (ch === "\n") inLineComment = false;
      i++;
      continue;
    }
    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i += 2;
        continue;
      }
      i++;
      continue;
    }
    if (inString) {
      if (ch === "\\" && next) {
        i += 2;
        continue;
      }
      if (ch === inString) inString = null;
      i++;
      continue;
    }

    if (ch === "/" && next === "/") {
      inLineComment = true;
      i += 2;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlockComment = true;
      i += 2;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = ch;
      i++;
      continue;
    }

    if (ch === "{") {
      foundBrace = true;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (foundBrace && depth === 0) {
        return source.slice(startIdx, i + 1).trim();
      }
    } else if (ch === ";" && !foundBrace) {
      return source.slice(startIdx, i + 1).trim();
    }
    i++;
  }

  return source.slice(startIdx).trim();
}

/**
 * Inspect extracted package files to enrich a class detail response with source code,
 * equations, fallback components, and embedded SysML/CAD viewer descriptors.
 */
export function inspectClassSource(
  extractedDir: string,
  packageName: string,
  version: string,
  className: string,
  classKind: string,
): InspectedClassSource {
  const result: InspectedClassSource = {
    sourceFile: null,
    sourceCode: null,
    equations: [],
    extractedComponents: [],
  };

  if (!extractedDir || !fs.existsSync(extractedDir)) {
    return result;
  }

  const allFiles = listAllFiles(extractedDir);
  const fqnParts = className.split(".");
  const shortName = fqnParts[fqnParts.length - 1] ?? className;
  const parentFqn = fqnParts.length > 1 ? fqnParts.slice(0, -1).join(".") : null;
  const encodedPkgPath = packageName.startsWith("@")
    ? packageName
        .split("/")
        .map((s) => encodeURIComponent(s))
        .join("/")
    : encodeURIComponent(packageName);
  const encodedVer = encodeURIComponent(version);

  // 1. Check STEP CAD class
  const lowerKind = classKind.toLowerCase();
  if (lowerKind.includes("cad") || lowerKind.includes("step") || lowerKind.includes("product")) {
    const stepFiles = allFiles.filter(
      (f) => f.relPath.toLowerCase().endsWith(".step") || f.relPath.toLowerCase().endsWith(".stp"),
    );
    const matchingStep =
      stepFiles.find((f) => path.basename(f.relPath).toLowerCase().includes(shortName.toLowerCase())) ?? stepFiles[0];
    if (matchingStep) {
      result.sourceFile = matchingStep.relPath;
      result.cadResourceUrl = `/api/v1/libraries/${encodedPkgPath}/${encodedVer}/resources/${matchingStep.relPath}`;
      try {
        const content = fs.readFileSync(matchingStep.fullPath, "utf-8");
        result.sourceCode = content.length > 16000 ? `${content.slice(0, 16000)}\n/* ... truncated ... */` : content;
      } catch {
        // ignore
      }
      return result;
    }
  }

  // 2. Check SysML v2 / KerML files
  const sysmlFiles = allFiles.filter(
    (f) => f.relPath.toLowerCase().endsWith(".sysml") || f.relPath.toLowerCase().endsWith(".kerml"),
  );
  // Sort so files matching top-level package name or shortName come first
  const topPkg = fqnParts[0] ?? shortName;
  const sortedSysml = [...sysmlFiles].sort((a, b) => {
    const aBase = path.basename(a.relPath, path.extname(a.relPath)).toLowerCase();
    const bBase = path.basename(b.relPath, path.extname(b.relPath)).toLowerCase();
    const targetLower = topPkg.toLowerCase();
    if (aBase === targetLower && bBase !== targetLower) return -1;
    if (bBase === targetLower && aBase !== targetLower) return 1;
    return a.relPath.localeCompare(b.relPath);
  });

  for (const sf of sortedSysml) {
    try {
      const content = fs.readFileSync(sf.fullPath, "utf-8");
      const scopedBlock = extractSysmlDeclarationBlock(content, className);
      if (scopedBlock) {
        result.sourceFile = sf.relPath;
        result.sourceCode = scopedBlock;
        const sysmlMeta = parseSysmlSourceMetadata(scopedBlock, sf.relPath);
        sysmlMeta.systemName = className;
        result.sysmlConfig = sysmlMeta;
        result.extractedComponents = extractSysmlComponentsFromSource(scopedBlock);
        result.equations = sysmlMeta.connections.map(
          (c) => `connect ${c.source} to ${c.target}${c.flowType ? ` /* ${c.flowType} */` : ""};`,
        );
        return result;
      }
    } catch {
      // ignore
    }
  }
  // Fallback for root package (e.g. className === "SysML" when file is KerML.sysml/SysML.sysml)
  if (sortedSysml.length > 0 && !allFiles.some((f) => f.relPath.endsWith(".mo"))) {
    const sf = sortedSysml[0]!;
    try {
      const content = fs.readFileSync(sf.fullPath, "utf-8");
      result.sourceFile = sf.relPath;
      result.sourceCode = content;
      const sysmlMeta = parseSysmlSourceMetadata(content, sf.relPath);
      sysmlMeta.systemName = className;
      result.sysmlConfig = sysmlMeta;
      result.extractedComponents = extractSysmlComponentsFromSource(content);
      result.equations = sysmlMeta.connections.map(
        (c) => `connect ${c.source} to ${c.target}${c.flowType ? ` /* ${c.flowType} */` : ""};`,
      );
      return result;
    } catch {
      // ignore
    }
  }

  // 3. Check Modelica (.mo) files with FQN-aware candidate ranking
  const moFiles = allFiles.filter((f) => f.relPath.toLowerCase().endsWith(".mo"));
  const escapedShort = shortName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const classBlockRegex = new RegExp(
    `((?:partial\\s+|encapsulated\\s+|expandable\\s+|replaceable\\s+|redeciare\\s+)*(?:model|block|class|connector|record|package|function|type|operator\\s+record|operator\\s+function|operator)\\s+${escapedShort}\\b[\\s\\S]*?\\bend\\s+${escapedShort}\\s*;)`,
  );
  const shortClassRegex = new RegExp(
    `((?:replaceable\\s+|redeclare\\s+)*(?:model|block|class|connector|record|type|package|function)\\s+${escapedShort}\\s*=\\s*[^;]+;)`,
  );

  // Build expected relative paths from FQN (both with and without leading root package segment)
  const relSegmentsWithRoot = fqnParts.join("/");
  const relSegmentsWithoutRoot = fqnParts.length > 1 ? fqnParts.slice(1).join("/") : fqnParts[0]!;
  const parentWithRoot = fqnParts.length > 1 ? fqnParts.slice(0, -1).join("/") : "";
  const parentWithoutRoot = fqnParts.length > 2 ? fqnParts.slice(1, -1).join("/") : "";

  const scoreMoFile = (relPath: string): number => {
    const norm = relPath.replace(/\\/g, "/");
    if (
      norm === `${relSegmentsWithoutRoot}.mo` ||
      norm === `${relSegmentsWithRoot}.mo` ||
      norm === `${relSegmentsWithoutRoot}/package.mo` ||
      norm === `${relSegmentsWithRoot}/package.mo`
    ) {
      return 100;
    }
    if (fqnParts.length === 1 && norm === "package.mo") {
      return 100;
    }
    if (
      (parentWithoutRoot && (norm === `${parentWithoutRoot}.mo` || norm === `${parentWithoutRoot}/package.mo`)) ||
      (parentWithRoot && (norm === `${parentWithRoot}.mo` || norm === `${parentWithRoot}/package.mo`))
    ) {
      return 90;
    }
    if (parentWithoutRoot && norm.startsWith(`${parentWithoutRoot}/`)) {
      return 80;
    }
    if (parentWithRoot && norm.startsWith(`${parentWithRoot}/`)) {
      return 75;
    }
    const base = path.basename(norm, ".mo");
    if (base === shortName) return 50;
    return 0;
  };

  const sortedMo = [...moFiles]
    .map((f) => ({ ...f, score: scoreMoFile(f.relPath) }))
    .sort((a, b) => b.score - a.score || a.relPath.localeCompare(b.relPath));

  const withinMatchesParent = (content: string): boolean => {
    if (!parentFqn) return true;
    const withinMatch = content.match(/^\s*within\s+([A-Za-z0-9_.]+)\s*;/m);
    if (!withinMatch?.[1]) return true;
    const fileWithin = withinMatch[1].trim();
    return parentFqn === fileWithin || parentFqn.startsWith(`${fileWithin}.`);
  };

  // Pass 1: strict `within` verification + block or short class match
  for (const mf of sortedMo) {
    if (mf.score === 0 && sortedMo[0] && sortedMo[0].score >= 75) continue;
    try {
      const content = fs.readFileSync(mf.fullPath, "utf-8");
      if (!withinMatchesParent(content)) continue;
      const blockMatch = content.match(classBlockRegex);
      if (blockMatch?.[1]) {
        result.sourceFile = mf.relPath;
        result.sourceCode = blockMatch[1].trim();
        result.equations = extractModelicaEquations(result.sourceCode);
        result.extractedComponents = extractModelicaComponentsFromSource(result.sourceCode);
        return result;
      }
      const shortMatch = content.match(shortClassRegex);
      if (shortMatch?.[1]) {
        result.sourceFile = mf.relPath;
        result.sourceCode = shortMatch[1].trim();
        return result;
      }
    } catch {
      // ignore
    }
  }

  // Pass 2: fallback without `within` constraint
  for (const mf of sortedMo) {
    try {
      const content = fs.readFileSync(mf.fullPath, "utf-8");
      const blockMatch = content.match(classBlockRegex);
      if (blockMatch?.[1]) {
        result.sourceFile = mf.relPath;
        result.sourceCode = blockMatch[1].trim();
        result.equations = extractModelicaEquations(result.sourceCode);
        result.extractedComponents = extractModelicaComponentsFromSource(result.sourceCode);
        return result;
      }
      const shortMatch = content.match(shortClassRegex);
      if (shortMatch?.[1]) {
        result.sourceFile = mf.relPath;
        result.sourceCode = shortMatch[1].trim();
        return result;
      }
    } catch {
      // ignore
    }
  }

  // 4. Polyglot fallback across all other 41 engineering languages
  const polyglotCandidates = allFiles.filter((f) => {
    const lower = f.relPath.toLowerCase();
    return (
      !lower.endsWith(".mo") &&
      !lower.endsWith(".sysml") &&
      !lower.endsWith(".kerml") &&
      !lower.endsWith(".step") &&
      !lower.endsWith(".stp") &&
      !lower.endsWith(".json") &&
      !lower.endsWith(".md") &&
      !lower.endsWith(".sha256") &&
      !lower.endsWith(".zip") &&
      !lower.endsWith(".png") &&
      !lower.endsWith(".jpg") &&
      !lower.endsWith(".svg")
    );
  });

  const matchingPolyglot =
    polyglotCandidates.find(
      (f) => path.basename(f.relPath, path.extname(f.relPath)).toLowerCase() === shortName.toLowerCase(),
    ) ??
    polyglotCandidates.find((f) => {
      try {
        const text = fs.readFileSync(f.fullPath, "utf-8");
        return text.includes(shortName);
      } catch {
        return false;
      }
    }) ??
    polyglotCandidates[0];

  if (matchingPolyglot) {
    try {
      const content = fs.readFileSync(matchingPolyglot.fullPath, "utf-8");
      result.sourceFile = matchingPolyglot.relPath;
      result.sourceCode = content.length > 24000 ? `${content.slice(0, 24000)}\n/* ... truncated ... */` : content;
    } catch {
      // ignore
    }
  }

  return result;
}
