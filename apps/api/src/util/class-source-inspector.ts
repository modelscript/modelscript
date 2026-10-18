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
  const shortName = className.split(".").pop() ?? className;
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
  for (const sf of sysmlFiles) {
    try {
      const content = fs.readFileSync(sf.fullPath, "utf-8");
      const escapedShort = shortName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const symRegex = new RegExp(
        `\\b(?:package|part\\s+def|part|requirement\\s+def|requirement|port\\s+def|item\\s+def)\\s+${escapedShort}\\b`,
      );
      if (symRegex.test(content) || (sysmlFiles.length === 1 && !allFiles.some((f) => f.relPath.endsWith(".mo")))) {
        result.sourceFile = sf.relPath;
        result.sourceCode = content;
        const sysmlMeta = parseSysmlSourceMetadata(content, sf.relPath);
        result.sysmlConfig = sysmlMeta;
        result.extractedComponents = extractSysmlComponentsFromSource(content);
        result.equations = sysmlMeta.connections.map(
          (c) => `connect ${c.source} to ${c.target}${c.flowType ? ` /* ${c.flowType} */` : ""};`,
        );
        return result;
      }
    } catch {
      // ignore
    }
  }

  // 3. Check Modelica (.mo) files
  const moFiles = allFiles.filter((f) => f.relPath.toLowerCase().endsWith(".mo"));
  const escapedShort = shortName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const classBlockRegex = new RegExp(
    `((?:partial\\s+|encapsulated\\s+|expandable\\s+)*(?:model|block|class|connector|record|package|function|type|operator)\\s+${escapedShort}\\b[\\s\\S]*?\\bend\\s+${escapedShort}\\s*;)`,
  );

  // Prefer file whose name matches shortName.mo or dotted path
  const sortedMo = [...moFiles].sort((a, b) => {
    const aBase = path.basename(a.relPath, ".mo");
    const bBase = path.basename(b.relPath, ".mo");
    if (aBase === shortName && bBase !== shortName) return -1;
    if (bBase === shortName && aBase !== shortName) return 1;
    return a.relPath.localeCompare(b.relPath);
  });

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
    } catch {
      // ignore
    }
  }

  // Fallback if class declaration uses short syntax (`type Foo = Real(...);`)
  const shortClassRegex = new RegExp(`((?:model|block|class|connector|record|type)\\s+${escapedShort}\\s*=[^;]+;)`);
  for (const mf of sortedMo) {
    try {
      const content = fs.readFileSync(mf.fullPath, "utf-8");
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

  return result;
}
