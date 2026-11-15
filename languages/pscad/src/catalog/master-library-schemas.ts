// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * PSCAD v5 Master Library Component Schema Catalog & LSP Intelligence Engine.
 *
 * Provides rich multi-tab parameter schemas (with physical units, bounds, defaults,
 * and enum options), XML component synthesis for canvas drag-and-drop (`addComponent`),
 * context-aware `.pscx` autocomplete, engineering hover cards with computed impedances,
 * Go-to-Definition, Document Symbols, and 1-click Quick-Fix Code Actions (`M6001–M6008`).
 */

import { parseXml, type XmlElement } from "@modelscript/dsl/xml";
import { lintPscx } from "../lints/index.js";
import { readDefinitionForm } from "../model/definition-form.js";
import type { ModelDefinition, ModelPort } from "../model/pscad-model.js";
import { getRegisteredMasterProject } from "../model/workspace-registry.js";
import { extractEmtNetlist } from "../netlist/emt-netlist.js";
import { parsePscx } from "../parser/pscx-parser.js";
import { getPscadSchemasFromLibraries } from "./library-package-adapter.js";

export interface PscadParameterOption {
  label: string;
  value: string;
}

export interface PscadParameterSchema {
  key: string;
  aliases?: string[] | undefined;
  label: string;
  tab: "General" | "Ratings" | "Impedances" | "Control" | "Geometry" | "Protection";
  group: string;
  kind: "number" | "string" | "boolean" | "select";
  unit?: string | undefined;
  defaultValue: string | number | boolean;
  min?: number | undefined;
  max?: number | undefined;
  options?: PscadParameterOption[] | undefined;
  description: string;
}

export interface PscadPortSchema {
  name: string;
  kind: "electrical" | "signal";
  side: "left" | "right" | "top" | "bottom";
  offsetX: number;
  offsetY: number;
}

export interface PscadComponentSchema {
  className: string;
  aliases: string[];
  label: string;
  category:
    | "Sources & Rotating Machines"
    | "Transformers, Lines & Cables"
    | "Power Electronics, HVDC & FACTS"
    | "Switchgear & Protection"
    | "CSMF Control Blocks"
    | "Meters, Probes & Buses";
  domain: "electrical" | "control" | "meter" | "bus";
  description: string;
  defaultWidth: number;
  defaultHeight: number;
  ports: PscadPortSchema[];
  parameters: PscadParameterSchema[];
}

export function getMasterLibrarySchemas(): PscadComponentSchema[] {
  return getPscadSchemasFromLibraries();
}

const DYNAMIC_MASTER_SCHEMAS = new Map<string, PscadComponentSchema>();

function deduceCategory(name: string, _ports: ModelPort[]): PscadComponentSchema["category"] {
  const n = name.toLowerCase();
  if (
    n.includes("machine") ||
    n.includes("motor") ||
    n.includes("gen") ||
    n.includes("source") ||
    n.includes("vsrc") ||
    n.includes("wound_rotor")
  ) {
    return "Sources & Rotating Machines";
  }
  if (
    n.includes("tline") ||
    n.includes("line") ||
    n.includes("cable") ||
    n.includes("xfmr") ||
    n.includes("transformer") ||
    n.includes("inductor") ||
    n.includes("capacitor") ||
    n.includes("resistor") ||
    n.includes("rlc")
  ) {
    return "Transformers, Lines & Cables";
  }
  if (
    n.includes("breaker") ||
    n.includes("switch") ||
    n.includes("fault") ||
    n.includes("tpflt") ||
    n.includes("arrester") ||
    n.includes("mov")
  ) {
    return "Switchgear & Protection";
  }
  if (
    n.includes("vsc") ||
    n.includes("pwm") ||
    n.includes("lcc") ||
    n.includes("thyristor") ||
    n.includes("inverter") ||
    n.includes("converter") ||
    n.includes("peswitch") ||
    n.includes("diode") ||
    n.includes("battery") ||
    n.includes("mmc")
  ) {
    return "Power Electronics, HVDC & FACTS";
  }
  if (
    n.includes("meter") ||
    n.includes("rms") ||
    n.includes("voltmeter") ||
    n.includes("ammeter") ||
    n.includes("probe") ||
    n.includes("pgb") ||
    n.includes("multimeter") ||
    n.includes("annotation") ||
    n.includes("sticky") ||
    n.includes("bus")
  ) {
    return "Meters, Probes & Buses";
  }
  return "CSMF Control Blocks";
}

function deduceDomain(category: PscadComponentSchema["category"]): "electrical" | "control" | "meter" | "bus" {
  if (category === "Meters, Probes & Buses") return "meter";
  if (category === "CSMF Control Blocks") return "control";
  return "electrical";
}

function synthesizeMasterSchema(def: ModelDefinition): PscadComponentSchema {
  const category = deduceCategory(def.name, def.ports);
  const domain = deduceDomain(category);
  const form = readDefinitionForm(def);

  const ports: PscadPortSchema[] = def.ports.map((p) => {
    let side: "left" | "right" | "top" | "bottom" = "right";
    if (Math.abs(p.x) >= Math.abs(p.y)) {
      side = p.x < 0 ? "left" : "right";
    } else {
      side = p.y < 0 ? "top" : "bottom";
    }
    const isSig = p.mode === 1 || p.mode === 2 || (p.electype === 0 && p.mode !== 3);
    return {
      name: p.name,
      kind: isSig ? ("signal" as const) : ("electrical" as const),
      side,
      offsetX: p.x,
      offsetY: p.y,
    };
  });

  const parameters: PscadParameterSchema[] = [];
  if (form) {
    for (const cat of form.categories) {
      for (const p of cat.parameters) {
        let tab: PscadParameterSchema["tab"] = "General";
        const catLower = cat.name.toLowerCase();
        if (catLower.includes("rating")) tab = "Ratings";
        else if (catLower.includes("impedance") || catLower.includes("param")) tab = "Impedances";
        else if (catLower.includes("control")) tab = "Control";
        else if (catLower.includes("geom")) tab = "Geometry";
        else if (catLower.includes("protect")) tab = "Protection";

        let kind: PscadParameterSchema["kind"] = "string";
        if (p.type === "Boolean") kind = "boolean";
        else if (p.type === "Real" || p.type === "Integer") kind = "number";

        parameters.push({
          key: p.name,
          label: p.label,
          tab,
          group: cat.name,
          kind,
          unit: p.unit || undefined,
          defaultValue: kind === "number" ? Number(p.defaultValue) || 0 : p.defaultValue,
          min: p.min,
          max: p.max,
          description: p.help || p.label,
        });
      }
    }
  }

  const label = def.name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const description = def.flyBy?.summary || `PSCAD Master Library component: ${def.name}`;

  return {
    className: `master:${def.name}`,
    aliases: [def.name, `master:${def.name}`],
    label,
    category,
    domain,
    description,
    defaultWidth: 60,
    defaultHeight: 60,
    ports,
    parameters,
  };
}

/**
 * Looks up a Master Library schema by definition name (e.g. `"master:sync_machine"` or `"sync_machine"`).
 */
export function getMasterComponentSchema(definitionName: string): PscadComponentSchema | undefined {
  const norm = definitionName.trim().toLowerCase();
  const short = norm.includes(":") ? norm.split(":").pop()! : norm;

  // 1. If dynamic master.pslx is loaded, prioritize its authentic XML definitions
  if (DYNAMIC_MASTER_SCHEMAS.has(short)) {
    return DYNAMIC_MASTER_SCHEMAS.get(short);
  }

  const masterProj = getRegisteredMasterProject();
  if (masterProj) {
    const def =
      masterProj.definitions.get(short) ??
      [...masterProj.definitions.values()].find((d) => d.name.toLowerCase() === short);
    if (def) {
      const synthesized = synthesizeMasterSchema(def);
      DYNAMIC_MASTER_SCHEMAS.set(short, synthesized);
      DYNAMIC_MASTER_SCHEMAS.set(`master:${short}`, synthesized);
      return synthesized;
    }
  }

  // 2. Fall back to static standalone schemas only if master.pslx is absent
  const hardcoded = getPscadSchemasFromLibraries().find(
    (s) =>
      s.className.toLowerCase() === norm ||
      s.className.toLowerCase().endsWith(`:${short}`) ||
      s.aliases.some((a) => a.toLowerCase() === norm || a.toLowerCase() === short),
  );
  if (hardcoded) return hardcoded;

  return undefined;
}

export function getAllMasterComponentSchemas(): PscadComponentSchema[] {
  const masterProj = getRegisteredMasterProject();
  if (masterProj) {
    for (const def of masterProj.definitions.values()) {
      const short = def.name.toLowerCase();
      if (!DYNAMIC_MASTER_SCHEMAS.has(short)) {
        const syn = synthesizeMasterSchema(def);
        DYNAMIC_MASTER_SCHEMAS.set(short, syn);
        DYNAMIC_MASTER_SCHEMAS.set(`master:${short}`, syn);
      }
    }
    // When master.pslx is registered, dynamic schemas are the source of truth
    return Array.from(DYNAMIC_MASTER_SCHEMAS.values());
  }
  return getPscadSchemasFromLibraries();
}

/**
 * Builds the 6-category palette for the VS Code / Web IDE Diagram Editor.
 */
export function getPscadPaletteCategories() {
  const categoryOrder: PscadComponentSchema["category"][] = [
    "Sources & Rotating Machines",
    "Transformers, Lines & Cables",
    "Power Electronics, HVDC & FACTS",
    "Switchgear & Protection",
    "CSMF Control Blocks",
    "Meters, Probes & Buses",
  ];

  return categoryOrder.map((catName) => ({
    name: catName,
    items: getAllMasterComponentSchemas()
      .filter((s) => s.category === catName)
      .map((s) => ({
        label: s.label,
        className: s.className,
        description: s.description,
      })),
  }));
}

/**
 * Synthesizes a well-formed PSCAD `<User classid="UserCmp" ...>` or `<Bus ...>` XML snippet
 * when a component is dragged from the palette onto the schematic canvas (`addComponent`).
 */
export function buildComponentXmlSnippet(
  className: string,
  instanceId: string,
  x: number,
  y: number,
  customParams?: Record<string, string | number>,
  indent = "        ",
): string {
  const schema = getMasterComponentSchema(className);
  const rx = Math.round(x);
  const ry = Math.round(y);

  if (className === "Bus" || schema?.domain === "bus") {
    const vbase = customParams?.["BaseKV"] ?? customParams?.["vbase"] ?? 230.0;
    return [
      `${indent}<Bus classid="Bus" id="${instanceId}" name="${instanceId}" x="${rx}" y="${ry}" length="80" vbase="${vbase}">`,
      `${indent}  <paramlist>`,
      `${indent}    <param name="Name" value="${instanceId}"/>`,
      `${indent}    <param name="BaseKV" value="${vbase}"/>`,
      `${indent}  </paramlist>`,
      `${indent}</Bus>`,
    ].join("\n");
  }

  const defn = schema?.className ?? (className.includes(":") ? className : `master:${className}`);
  const paramLines: string[] = [];

  if (schema) {
    for (const p of schema.parameters) {
      const val =
        customParams?.[p.key] !== undefined ? customParams[p.key] : p.key === "Name" ? instanceId : p.defaultValue;
      paramLines.push(`${indent}    <param name="${p.key}" value="${val}"/>`);
    }
  } else {
    paramLines.push(`${indent}    <param name="Name" value="${instanceId}"/>`);
    if (customParams) {
      for (const [k, v] of Object.entries(customParams)) {
        if (k !== "Name") {
          paramLines.push(`${indent}    <param name="${k}" value="${v}"/>`);
        }
      }
    }
  }

  return [
    `${indent}<User classid="UserCmp" name="${defn}" id="${instanceId}" x="${rx}" y="${ry}" orient="0">`,
    `${indent}  <paramlist>`,
    ...paramLines,
    `${indent}  </paramlist>`,
    `${indent}</User>`,
  ].join("\n");
}

/**
 * Context-aware LSP Completion items for `.pscx` / `.pslx` XML editing.
 */
export function getPscadCompletions(text: string, offset: number) {
  const prefix = text.slice(Math.max(0, offset - 300), offset);
  const currentLineStart = text.lastIndexOf("\n", offset - 1) + 1;
  const linePrefix = text.slice(currentLineStart, offset);

  // 1. Inside `<User ... name="` or `defn="`: suggest all Master Library component definitions
  if (/<User\b[^>]*?\b(?:name|defn)\s*=\s*["'][^"']*$/i.test(linePrefix)) {
    return getPscadSchemasFromLibraries()
      .filter((s) => s.domain !== "bus")
      .map((s) => ({
        label: s.className,
        kind: 7, // CompletionItemKind.Class
        detail: `${s.label} (${s.category})`,
        documentation: s.description,
      }));
  }

  // Find enclosing `<User ... name="master:...">` block before `offset`
  const beforeText = text.slice(0, offset);
  const lastUserOpen = beforeText.lastIndexOf("<User");
  const lastUserClose = beforeText.lastIndexOf("</User>");
  let enclosingSchema: PscadComponentSchema | undefined;
  if (lastUserOpen > lastUserClose) {
    const userHeader = beforeText.slice(lastUserOpen, Math.min(text.length, lastUserOpen + 250));
    const defMatch = /\b(?:name|defn)\s*=\s*["']([^"']+)["']/i.exec(userHeader);
    if (defMatch?.[1]) {
      enclosingSchema = getMasterComponentSchema(defMatch[1]);
    }
  }

  // 2. Inside `<param name="key" value="...`: suggest enum options if parameter has options
  const valMatch = /<param\s+name\s*=\s*["']([^"']+)["']\s+value\s*=\s*["'][^"']*$/i.exec(linePrefix);
  if (valMatch && enclosingSchema) {
    const paramKey = valMatch[1]!;
    const pSchema = enclosingSchema.parameters.find(
      (p) =>
        p.key.toLowerCase() === paramKey.toLowerCase() ||
        p.aliases?.some((a) => a.toLowerCase() === paramKey.toLowerCase()),
    );
    if (pSchema?.options) {
      return pSchema.options.map((opt) => ({
        label: opt.value,
        kind: 13, // CompletionItemKind.EnumMember
        detail: opt.label,
        documentation: `${pSchema.label}: ${opt.label}`,
      }));
    }
  }

  // 3. Inside `<param name="...`: suggest parameter names for the enclosing component (or project settings)
  if (
    /<param\s+name\s*=\s*["'][^"']*$/i.test(linePrefix) ||
    (prefix.includes("<paramlist") && !linePrefix.includes("<param"))
  ) {
    if (enclosingSchema) {
      return enclosingSchema.parameters.map((p) => ({
        label: p.key,
        kind: 10, // CompletionItemKind.Property
        detail: `${p.label}${p.unit ? ` [${p.unit}]` : ""} (default: ${p.defaultValue})`,
        documentation: p.description,
      }));
    }
    // Project-level settings
    return [
      {
        label: "time_step",
        kind: 10,
        detail: "Simulation Time Step [µs] (default: 50.0)",
        documentation: "Fixed EMT companion integration step Δt in microseconds.",
      },
      {
        label: "time_duration",
        kind: 10,
        detail: "Simulation Duration [s] (default: 1.0)",
        documentation: "Total simulation duration in seconds.",
      },
      {
        label: "f_base",
        kind: 10,
        detail: "Nominal System Frequency [Hz] (default: 60.0)",
        documentation: "Base fundamental AC frequency (50 or 60 Hz).",
      },
    ];
  }

  // 4. Default top-level XML/PSCAD completions
  return getPscadSchemasFromLibraries().map((s) => ({
    label: s.className,
    kind: 7,
    detail: `${s.label} — ${s.category}`,
    documentation: s.description,
  }));
}

/**
 * Generates a rich Markdown Hover card with computed electrical impedances & topology for `.pscx` elements.
 */
export function getPscadHover(text: string, offset: number): { contents: string; line?: number | undefined } | null {
  try {
    const project = parsePscx(text);
    const netlist = extractEmtNetlist(project);
    const before = text.slice(0, offset);
    const cursorLine = before.split(/\r?\n/).length;

    const allComponents = [
      ...project.rootModule.components,
      ...Array.from(project.subModules.values()).flatMap((m) => m.components),
    ];
    const allBuses = [...project.rootModule.buses, ...Array.from(project.subModules.values()).flatMap((m) => m.buses)];

    // Check if cursor is on or inside a `<Bus>`
    const bus = allBuses.find(
      (b) =>
        b.line === cursorLine ||
        (b.line && Math.abs(b.line - cursorLine) <= 2 && text.split(/\r?\n/)[cursorLine - 1]?.includes(b.name)),
    );
    if (bus) {
      const netBus = netlist.buses.get(bus.name) ?? netlist.buses.get(bus.id);
      const connected = netBus?.connectedBranchIds.join(", ") || "None";
      return {
        line: bus.line,
        contents: [
          `### ⚡ 3-Phase Electrical Busbar \`${bus.name}\``,
          `- **Nominal Voltage ($V_{\\text{LL,RMS}}$):** \`${bus.voltageBaseKv ?? 230} kV\``,
          `- **Phase Nodes:** \`${bus.phaseCount}-phase (A, B, C)\``,
          `- **Connected Apparatus / Branches:** \`${connected}\``,
        ].join("\n"),
      };
    }

    // Check if cursor is on or inside a `<User>` component block
    for (const cmp of allComponents) {
      if (!cmp.line) continue;
      const lines = text.split(/\r?\n/);
      let endLine = cmp.line;
      if (!/\/>\s*$/.test(lines[cmp.line - 1] ?? "")) {
        while (endLine < lines.length && !/<\/(?:User|Component)>/i.test(lines[endLine - 1] ?? "")) {
          endLine++;
        }
      }
      if (cursorLine >= cmp.line && cursorLine <= endLine) {
        const defName = cmp.definitionName.includes(":") ? cmp.definitionName.split(":").pop()! : cmp.definitionName;
        const def = project.definitions?.get(defName) ?? project.definitions?.get(cmp.definitionName);
        const schema = getMasterComponentSchema(cmp.definitionName);
        const title = schema
          ? `${schema.label} (\`${cmp.definitionName}\`)`
          : `PSCAD Component \`${cmp.definitionName}\``;
        const descriptionText =
          def?.flyBy?.summary || schema?.description || def?.description || "PSCAD schematic component instance.";
        const md: string[] = [
          `### 🔌 ${title}`,
          `**Instance:** \`${cmp.instanceName || cmp.id}\` ${schema ? `| **Category:** *${schema.category}*` : ""}`,
          "",
          descriptionText,
          "",
        ];

        if (def?.flyBy?.ports && Object.keys(def.flyBy.ports).length > 0) {
          md.push("**Terminals & Signals:**");
          for (const [pName, pDoc] of Object.entries(def.flyBy.ports)) {
            md.push(`- **\`${pName}\`**: ${pDoc.replace(/\r?\n/g, " ")}`);
          }
          md.push("");
        }

        // Compute derived engineering values (unit-aware for PSCAD strings like "280.0 [MVA]")
        const parseNumericParam = (raw: unknown): number => {
          if (raw === undefined || raw === null) return 0;
          const cleaned = String(raw)
            .replace(/\s*\[[^\]]*\]\s*/g, "")
            .trim();
          const n = Number.parseFloat(cleaned);
          return Number.isFinite(n) ? n : 0;
        };

        const p = cmp.parameters;
        const mva = parseNumericParam(p["MVA"] ?? p["Tmva"] ?? p["mva"] ?? p["rated_mva"] ?? p["Sbase"]);
        let vKv = parseNumericParam(
          p["V"] ?? p["Vm"] ?? p["V1"] ?? p["Vbase"] ?? p["v"] ?? p["rated_kv"] ?? p["BaseKV"],
        );
        if (vKv <= 0 && cmp.instanceName) {
          const kvMatch = /(\d+(?:\.\d+)?)p?(\d*)\s*kV/i.exec(cmp.instanceName);
          if (kvMatch) {
            vKv = Number.parseFloat(kvMatch[2] ? `${kvMatch[1]}.${kvMatch[2]}` : kvMatch[1]!);
          }
        }
        const f0Param = parseNumericParam(p["F0"] ?? p["f"] ?? p["Freq"]);
        const freq = f0Param > 0 ? f0Param : project.settings.frequencyHz || 60;
        const omega = 2 * Math.PI * freq;

        if (mva > 0 && vKv > 0) {
          const zBase = (vKv * vKv) / mva;
          const iBase = (mva * 1e3) / (Math.sqrt(3) * vKv);
          md.push(`**Derived Base Quantities (${mva} MVA, ${vKv} kV, ${freq} Hz):**`);
          md.push(
            `- $Z_{\\text{base}} = \\frac{V^2}{S} = \\mathbf{${zBase.toFixed(3)}\\,\\Omega}$ | $I_{\\text{rated}} = \\mathbf{${iBase.toFixed(1)}\\,\\text{A}}_{\\text{RMS}}$`,
          );
          const xPu = parseNumericParam(p["X"] ?? p["Xl"] ?? p["x"] ?? p["X12"]);
          if (xPu > 0) {
            const xOhm = xPu * zBase;
            const lMh = (xOhm / omega) * 1e3;
            md.push(
              `- Leakage Impedance: $X_l = ${xOhm.toFixed(3)}\\,\\Omega$ ($L_l = ${lMh.toFixed(2)}\\,\\text{mH}$)`,
            );
          }
          if (p["Xd_sub"] !== undefined || p["Xd"] !== undefined || p["Xd_pp"] !== undefined) {
            const xdSub = parseNumericParam(p["Xd_sub"] ?? p["Xd_pp"] ?? 0.2) || 0.2;
            const lSubMh = ((xdSub * zBase) / omega) * 1e3;
            md.push(
              `- Subtransient Inductance: $L_d'' = ${lSubMh.toFixed(2)}\\,\\text{mH}$ ($X_d'' = ${xdSub}\\,\\text{pu}$)`,
            );
          }
          md.push("");
        } else if (mva > 0) {
          md.push(`**Apparatus Rating:** ${mva} MVA (${freq} Hz)`);
          md.push("");
        }

        const lMhVal = parseNumericParam(p["L"] ?? p["l"]);
        const cUfVal = parseNumericParam(p["C"] ?? p["c"]);
        if (lMhVal > 0 && cUfVal > 0) {
          const fRes = 1 / (2 * Math.PI * Math.sqrt(lMhVal * 1e-3 * cUfVal * 1e-6));
          const zChar = Math.sqrt((lMhVal * 1e-3) / (cUfVal * 1e-6));
          md.push(`**Harmonic LC Filter Characteristics:**`);
          md.push(
            `- LC Resonant Frequency: $f_{\\text{res}} = \\frac{1}{2\\pi\\sqrt{LC}} = \\mathbf{${fRes.toFixed(1)}\\,\\text{Hz}}$ | $Z_0 = \\mathbf{${zChar.toFixed(2)}\\,\\Omega}$`,
          );
          md.push("");
        }

        const hVirtVal = parseNumericParam(p["H_virt"] ?? p["H"]);
        if (hVirtVal > 0) {
          const sBaseMva = mva > 0 ? mva : 250;
          md.push(`**Grid-Forming Virtual Inertia:**`);
          md.push(
            `- Stored Kinetic Energy Equivalent: $E_k = H \\cdot S_{\\text{base}} = \\mathbf{${(hVirtVal * sBaseMva).toFixed(1)}\\,\\text{MW}\\cdot\\text{s}}$`,
          );
          md.push("");
        }

        const lineMatch = netlist.transmissionLines.find((l) => l.id === cmp.id || l.id === cmp.instanceName);
        if (lineMatch) {
          const zc = Math.sqrt(lineMatch.lPerKm / Math.max(1e-12, lineMatch.cPerKm));
          const tauUs = lineMatch.lengthKm * Math.sqrt(lineMatch.lPerKm * lineMatch.cPerKm) * 1e6;
          md.push(`**Traveling-Wave Line Parameters (${lineMatch.lengthKm} km, \`${lineMatch.modelType}\`):**`);
          md.push(`- Surge Impedance: $Z_c = \\sqrt{L/C} = \\mathbf{${zc.toFixed(1)}\\,\\Omega}$`);
          md.push(
            `- Wave Propagation Delay: $\\tau = \\mathbf{${tauUs.toFixed(1)}\\,\\mu\\text{s}}$ (Project $\\Delta t = ${project.settings.timeStepUs}\\,\\mu\\text{s}$)`,
          );
          md.push("");
        }

        const paramEntries = Object.entries(cmp.parameters);
        if (paramEntries.length > 0) {
          md.push("| Parameter | Value | Unit | Description |");
          md.push("| :--- | :--- | :--- | :--- |");
          for (const [k, v] of paramEntries) {
            const pSchema = schema?.parameters.find(
              (ps) =>
                ps.key.toLowerCase() === k.toLowerCase() ||
                ps.aliases?.some((a) => a.toLowerCase() === k.toLowerCase()),
            );
            md.push(
              `| \`${k}\` | \`${v}\` | ${pSchema?.unit ?? "—"} | ${pSchema?.description ?? "Component parameter"} |`,
            );
          }
        }

        return {
          line: cmp.line,
          contents: md.join("\n"),
        };
      }
    }

    // Check if cursor is on or inside a <Definition> element (e.g. inside a library file like master.pslx)
    if (project.definitions) {
      const xmlDoc = parseXml(text);
      const mapper = createXmlOffsetMapper(text);
      const targetDefEl = xmlDoc.root ? findAncestorAtOffset(xmlDoc.root, offset, "definition") : undefined;
      const targetDefName = findAttrCI(targetDefEl, "name")?.value;
      if (targetDefEl && targetDefName) {
        const def = project.definitions.get(targetDefName);
        if (def) {
          const defStartLine = mapper.toLineCol(targetDefEl.start).line + 1;
          const md: string[] = [`### 📦 PSCAD Component Definition \`${targetDefName}\``, ""];
          if (def.flyBy?.summary) {
            md.push(def.flyBy.summary);
            md.push("");
          } else if (def.description) {
            md.push(def.description);
            md.push("");
          }

          if (def.flyBy?.ports && Object.keys(def.flyBy.ports).length > 0) {
            md.push("**Terminals & Signals:**");
            for (const [pName, pDoc] of Object.entries(def.flyBy.ports)) {
              md.push(`- **\`${pName}\`**: ${pDoc.replace(/\r?\n/g, " ")}`);
            }
            md.push("");
          }

          if (def.checks && def.checks.length > 0) {
            md.push(`**Parameter Validation Rules (${def.checks.length} assertions):**`);
            for (const rule of def.checks.slice(0, 5)) {
              md.push(
                `- *${rule.severity.toUpperCase()}*: ${rule.message}${rule.condition ? ` (\`${rule.condition}\`)` : ""}`,
              );
            }
            if (def.checks.length > 5) {
              md.push(`- *...and ${def.checks.length - 5} more rules*`);
            }
            md.push("");
          }

          return {
            line: defStartLine,
            contents: md.join("\n"),
          };
        }
      }
    }
  } catch {
    // Ignore parse errors during hover
  }
  return null;
}

function createXmlOffsetMapper(text: string) {
  const lineStarts: number[] = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) lineStarts.push(i + 1);
  }
  const toLineCol = (offset: number): { line: number; character: number } => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (lineStarts[mid]! <= offset) lo = mid + 1;
      else hi = mid - 1;
    }
    const line = Math.max(0, hi);
    return { line, character: Math.max(0, offset - lineStarts[line]!) };
  };
  const toRange = (start: number, end: number) => ({
    start: toLineCol(start),
    end: toLineCol(end),
  });
  return { toLineCol, toRange };
}

function findAttrCI(el: XmlElement | undefined, name: string) {
  if (!el) return undefined;
  const target = name.toLowerCase();
  return el.attributes.find((a) => a.name === name || a.name.toLowerCase() === target);
}

function findElementAtOffset(root: XmlElement, offset: number): XmlElement | undefined {
  if (offset < root.start || offset > root.end) return undefined;
  for (const child of root.children) {
    const nested = findElementAtOffset(child, offset);
    if (nested) return nested;
  }
  return root;
}

function findAncestorAtOffset(root: XmlElement, offset: number, tagName: string): XmlElement | undefined {
  let cur = findElementAtOffset(root, offset);
  const target = tagName.toLowerCase();
  while (cur) {
    if (cur.name.toLowerCase() === target) return cur;
    cur = cur.parent ?? undefined;
  }
  return undefined;
}

function walkXmlElements(el: XmlElement, visitor: (node: XmlElement) => unknown): boolean {
  if (visitor(el) === true) return true;
  for (const child of el.children) {
    if (walkXmlElements(child, visitor)) return true;
  }
  return false;
}

/**
 * Resolves Go-to-Definition for sub-module `<User name="SubModule">`, library `<User name="my_lib:CustomCmp">`,
 * `<call name="Main">`, wireless net labels (`datalabel`/`xnode`), and `<Bus>` declarations across `.pscx`/`.pslx` files.
 */
export function getPscadDefinitionLocation(
  text: string,
  offset: number,
  uri: string,
  workspaceDocs?: Iterable<{ uri: string; text: string }>,
): {
  uri: string;
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
} | null {
  const xmlDoc = parseXml(text);
  if (!xmlDoc.root) return null;
  const elAtCursor = findElementAtOffset(xmlDoc.root, offset);
  if (!elAtCursor) return null;

  // 1. Check if cursor is on <param name="Name" value="NetOrInstanceName"/>
  if (elAtCursor.name.toLowerCase() === "param" && findAttrCI(elAtCursor, "name")?.value.toLowerCase() === "name") {
    const valAttrAtCursor = findAttrCI(elAtCursor, "value");
    const netName = valAttrAtCursor?.value;
    if (netName) {
      const mapper = createXmlOffsetMapper(text);
      let hit: {
        uri: string;
        range: { start: { line: number; character: number }; end: { line: number; character: number } };
      } | null = null;
      walkXmlElements(xmlDoc.root, (node) => {
        if (node.name.toLowerCase() !== "param") return;
        const nAttr = findAttrCI(node, "name");
        const vAttr = findAttrCI(node, "value");
        if (nAttr?.value.toLowerCase() === "name" && vAttr?.value === netName) {
          hit = { uri, range: mapper.toRange(vAttr.valueStart, vAttr.valueEnd) };
          return true;
        }
        return false;
      });
      if (hit) return hit;
    }
  }

  const targetAttr = findAttrCI(elAtCursor, "defn") ?? findAttrCI(elAtCursor, "name");
  if (!targetAttr?.value) return null;

  const rawTarget = targetAttr.value.includes(":") ? targetAttr.value.split(":").pop()! : targetAttr.value;
  if (!rawTarget) return null;
  const targetLower = rawTarget.toLowerCase();

  const searchInDocument = (docText: string, docUri: string) => {
    const doc = parseXml(docText);
    if (!doc.root) return null;
    const mapper = createXmlOffsetMapper(docText);
    let found: {
      uri: string;
      range: { start: { line: number; character: number }; end: { line: number; character: number } };
    } | null = null;
    walkXmlElements(doc.root, (node) => {
      if (node.name.toLowerCase() !== "definition") return;
      const nameAttr = findAttrCI(node, "name");
      if (!nameAttr) return;
      const valLower = nameAttr.value.toLowerCase();
      if (valLower === targetLower || valLower.endsWith(`:${targetLower}`)) {
        const spanEnd = nameAttr.valueEnd;
        const spanStart = Math.max(nameAttr.valueStart, spanEnd - rawTarget.length);
        found = { uri: docUri, range: mapper.toRange(spanStart, spanEnd) };
        return true;
      }
      return false;
    });
    return found;
  };

  // Search current file first, then linked workspace .pslx / .pscx files
  const localHit = searchInDocument(text, uri);
  if (localHit) return localHit;

  if (workspaceDocs) {
    for (const doc of workspaceDocs) {
      if (doc.uri === uri) continue;
      const hit = searchInDocument(doc.text, doc.uri);
      if (hit) return hit;
    }
  }

  return null;
}

/**
 * Finds all references to a PSCAD `<Definition>`, `<User>` component type, wireless net (`datalabel`/`xnode`),
 * or `<Bus>` across the current document and workspace `.pscx`/`.pslx` files.
 */
export function getPscadReferences(
  text: string,
  offset: number,
  uri: string,
  workspaceDocs?: Iterable<{ uri: string; text: string }>,
): {
  uri: string;
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
}[] {
  const curDoc = parseXml(text);
  if (!curDoc.root) return [];
  const elAtCursor = findElementAtOffset(curDoc.root, offset);
  if (!elAtCursor) return [];

  const targetAttrKeys = new Set(["defn", "name", "value", "id"]);
  const quotedAtCursor = elAtCursor.attributes.find(
    (a) => targetAttrKeys.has(a.name.toLowerCase()) && offset >= a.start && offset <= a.end,
  )?.value;

  const isParamNameTag =
    elAtCursor.name.toLowerCase() === "param" && findAttrCI(elAtCursor, "name")?.value.toLowerCase() === "name";
  const paramNameVal = isParamNameTag ? findAttrCI(elAtCursor, "value")?.value : undefined;
  const defnOrNameVal = (findAttrCI(elAtCursor, "defn") ?? findAttrCI(elAtCursor, "name"))?.value;
  const idVal = findAttrCI(elAtCursor, "id")?.value;
  const targetRaw = quotedAtCursor ?? paramNameVal ?? defnOrNameVal ?? idVal;
  if (!targetRaw) return [];

  const cleanSymbol = targetRaw.includes(":") ? targetRaw.split(":").pop()! : targetRaw;
  if (!cleanSymbol) return [];
  const cleanLower = cleanSymbol.toLowerCase();

  const results: {
    uri: string;
    range: { start: { line: number; character: number }; end: { line: number; character: number } };
  }[] = [];

  const allDocs: { uri: string; text: string }[] = [{ uri, text }];
  if (workspaceDocs) {
    for (const d of workspaceDocs) {
      if (d.uri !== uri) allDocs.push(d);
    }
  }

  for (const doc of allDocs) {
    const parsed = doc.uri === uri ? curDoc : parseXml(doc.text);
    if (!parsed.root) continue;
    const mapper = createXmlOffsetMapper(doc.text);
    walkXmlElements(parsed.root, (node) => {
      for (const attr of node.attributes) {
        const valLower = attr.value.toLowerCase();
        if (valLower === cleanLower || valLower.endsWith(`:${cleanLower}`)) {
          const spanEnd = attr.valueEnd;
          const spanStart = Math.max(attr.valueStart, spanEnd - cleanSymbol.length);
          results.push({
            uri: doc.uri,
            range: mapper.toRange(spanStart, spanEnd),
          });
        }
      }
    });
  }

  return results;
}

/**
 * Computes workspace-wide rename edits for a PSCAD `<Definition>`, wireless net (`datalabel`/`xnode`),
 * `<Bus>`, or component instance name.
 */
export function getPscadRenameEdits(
  text: string,
  offset: number,
  newName: string,
  uri: string,
  workspaceDocs?: Iterable<{ uri: string; text: string }>,
): Record<
  string,
  { range: { start: { line: number; character: number }; end: { line: number; character: number } }; newText: string }[]
> | null {
  const refs = getPscadReferences(text, offset, uri, workspaceDocs);
  if (refs.length === 0) return null;
  const changes: Record<
    string,
    {
      range: { start: { line: number; character: number }; end: { line: number; character: number } };
      newText: string;
    }[]
  > = {};
  for (const r of refs) {
    const list = changes[r.uri] ?? (changes[r.uri] = []);
    list.push({ range: r.range, newText: newName });
  }
  return changes;
}

/**
 * Computes engineering Inlay Hints for `.pscx` files:
 * - Per-unit (`[pu]`) reactance/resistance to ohmic ($\Omega$) and inductance ($\text{mH}$) conversions
 * - Traveling-wave transmission line propagation delay $\tau$ and step ratio $\tau / \Delta t$
 * - LC harmonic filter resonant frequency $f_{\text{res}}$
 */
export function getPscadInlayHints(
  text: string,
  range?: { start: { line: number; character: number }; end: { line: number; character: number } },
): {
  position: { line: number; character: number };
  label: string;
  kind?: "type" | "parameter";
  paddingLeft?: boolean;
}[] {
  const hints: {
    position: { line: number; character: number };
    label: string;
    kind?: "type" | "parameter";
    paddingLeft?: boolean;
  }[] = [];

  try {
    const project = parsePscx(text);
    const lines = text.split(/\r?\n/);
    const freq = project.settings.frequencyHz || 60;
    const dtUs = project.settings.timeStepUs || 50;
    const omega = 2 * Math.PI * freq;

    const parseNum = (v: unknown): number => {
      if (v === undefined || v === null) return 0;
      const n = Number.parseFloat(
        String(v)
          .replace(/\s*\[[^\]]*\]\s*/g, "")
          .trim(),
      );
      return Number.isFinite(n) ? n : 0;
    };

    const allComponents = [
      ...project.rootModule.components,
      ...Array.from(project.subModules.values()).flatMap((m) => m.components),
    ];

    for (const cmp of allComponents) {
      if (!cmp.line) continue;
      const p = cmp.parameters;
      const mva = parseNum(p["MVA"] ?? p["Tmva"] ?? p["mva"] ?? p["rated_mva"]);
      let vKv = parseNum(p["V"] ?? p["Vm"] ?? p["V1"] ?? p["Vbase"] ?? p["rated_kv"]);
      if (vKv <= 0 && cmp.instanceName) {
        const kvMatch = /(\d+(?:\.\d+)?)p?(\d*)\s*kV/i.exec(cmp.instanceName);
        if (kvMatch) {
          vKv = Number.parseFloat(kvMatch[2] ? `${kvMatch[1]}.${kvMatch[2]}` : kvMatch[1]!);
        }
      }
      const zBase = mva > 0 && vKv > 0 ? (vKv * vKv) / mva : 0;

      // Scan the component's XML lines for <param> tags
      for (let i = cmp.line - 1; i < Math.min(lines.length, cmp.line + 18); i++) {
        if (range && (i < range.start.line || i > range.end.line)) continue;
        const l = lines[i]!;
        if (i >= cmp.line && /<\/(?:User|Component)>/i.test(l)) break;

        if (zBase > 0 && /<param\b[^>]*\bname\s*=\s*["'](?:Xl|X|Xd_sub|Xd_pp)["']/i.test(l)) {
          const xPu = parseNum(p["Xl"] ?? p["X"] ?? p["Xd_sub"] ?? p["Xd_pp"]);
          if (xPu > 0) {
            const xOhm = xPu * zBase;
            const lMh = (xOhm / omega) * 1e3;
            hints.push({
              position: { line: i, character: l.length },
              label: `→ ${xOhm.toFixed(2)} Ω (${lMh.toFixed(1)} mH @ ${vKv} kV)`,
              kind: "type",
              paddingLeft: true,
            });
          }
        } else if (/<param\b[^>]*\bname\s*=\s*["']Length["']/i.test(l)) {
          const lenKm = parseNum(p["Length"] ?? p["length"]);
          if (lenKm > 0) {
            const tauUs = lenKm * 3.4; // ~3.4 us/km overhead traveling wave delay
            hints.push({
              position: { line: i, character: l.length },
              label: `→ τ ≈ ${tauUs.toFixed(1)} μs (${(tauUs / dtUs).toFixed(1)}×Δt)`,
              kind: "type",
              paddingLeft: true,
            });
          }
        } else if (/<param\b[^>]*\bname\s*=\s*["']C["']/i.test(l)) {
          const lMh = parseNum(p["L"] ?? p["l"]);
          const cUf = parseNum(p["C"] ?? p["c"]);
          if (lMh > 0 && cUf > 0) {
            const fRes = 1 / (2 * Math.PI * Math.sqrt(lMh * 1e-3 * cUf * 1e-6));
            hints.push({
              position: { line: i, character: l.length },
              label: `→ f_res = ${fRes.toFixed(1)} Hz`,
              kind: "type",
              paddingLeft: true,
            });
          }
        }
      }
    }
  } catch {
    // Ignore parse errors
  }

  return hints;
}

export interface PscadDocSymbol {
  name: string;
  detail: string;
  kind: number;
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
  selectionRange: { start: { line: number; character: number }; end: { line: number; character: number } };
  children?: PscadDocSymbol[] | undefined;
}

/**
 * Builds hierarchical LSP `DocumentSymbol[]` for the VS Code Outline & Breadcrumbs bar.
 */
export function getPscadDocumentSymbols(text: string): PscadDocSymbol[] {
  const project = parsePscx(text);
  const lines = text.split(/\r?\n/);
  const totalLines = Math.max(0, lines.length - 1);

  const makeRange = (line1Based?: number) => {
    const l = Math.max(0, Math.min(totalLines, (line1Based ?? 1) - 1));
    const len = lines[l]?.length ?? 1;
    return {
      start: { line: l, character: 0 },
      end: { line: l, character: len },
    };
  };

  const buildModuleChildren = (mod: typeof project.rootModule): PscadDocSymbol[] => {
    const children: PscadDocSymbol[] = [];
    for (const bus of mod.buses) {
      const r = makeRange(bus.line);
      children.push({
        name: `${bus.name} (${bus.voltageBaseKv ?? 230} kV Bus)`,
        detail: `${bus.phaseCount}-Phase Bus`,
        kind: 8, // SymbolKind.Field
        range: r,
        selectionRange: r,
      });
    }
    for (const cmp of mod.components) {
      const r = makeRange(cmp.line);
      const schema = getMasterComponentSchema(cmp.definitionName);
      children.push({
        name: cmp.instanceName || cmp.id,
        detail: schema ? `${schema.label} (${cmp.definitionName})` : cmp.definitionName,
        kind: schema?.domain === "control" ? 12 : 5, // Function for control, Class for apparatus
        range: r,
        selectionRange: r,
      });
    }
    return children;
  };

  const moduleSymbols: PscadDocSymbol[] = [
    {
      name: project.rootModule.name || "Main",
      detail: "Root Schematic Module",
      kind: 2, // SymbolKind.Module
      range: { start: { line: 0, character: 0 }, end: { line: totalLines, character: 0 } },
      selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: lines[0]?.length ?? 1 } },
      children: buildModuleChildren(project.rootModule),
    },
  ];

  for (const [subName, subMod] of project.subModules.entries()) {
    const defLineIdx = lines.findIndex((l) => /<Definition\b/i.test(l) && l.includes(`"${subName}"`));
    const r = makeRange(defLineIdx >= 0 ? defLineIdx + 1 : 1);
    moduleSymbols.push({
      name: subName,
      detail: "Sub-Module Definition",
      kind: 2,
      range: r,
      selectionRange: r,
      children: buildModuleChildren(subMod),
    });
  }

  return [
    {
      name: project.name,
      detail: `PSCAD Project (${project.settings.frequencyHz} Hz, Δt=${project.settings.timeStepUs} µs)`,
      kind: 4, // SymbolKind.Package
      range: { start: { line: 0, character: 0 }, end: { line: totalLines, character: 0 } },
      selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: lines[0]?.length ?? 1 } },
      children: moduleSymbols,
    },
  ];
}

/**
 * Generates 1-click Quick-Fix Code Actions for PSCAD pre-flight lints (`M6001`–`M6017`).
 */
export function getPscadQuickFixes(text: string, uri: string) {
  const project = parsePscx(text);
  const lints = lintPscx(project);
  const lines = text.split(/\r?\n/);
  const actions: {
    title: string;
    code: string;
    edit: {
      changes: Record<
        string,
        {
          range: { start: { line: number; character: number }; end: { line: number; character: number } };
          newText: string;
        }[]
      >;
    };
  }[] = [];

  for (const d of lints) {
    const lineIdx = Math.max(0, (d.line ?? 1) - 1);
    const lineText = lines[lineIdx] ?? "";

    if (d.code === "M6001") {
      // Floating electrical node -> add a ground reference component or disable isolated probe
      const cmp = project.rootModule.components.find((c) => c.id === d.componentId);
      const gx = cmp ? cmp.position.x + 18 : 180;
      const gy = cmp ? cmp.position.y : 180;
      const gndSnippet = `\n        <User id="gnd_${d.componentId || "ref"}" name="master:ground" x="${gx}" y="${gy}"/>`;
      actions.push({
        title: `Fix M6001: Attach ground reference ('master:ground') at (${gx}, ${gy})`,
        code: d.code,
        edit: {
          changes: {
            [uri]: [
              {
                range: {
                  start: { line: lineIdx, character: lineText.length },
                  end: { line: lineIdx, character: lineText.length },
                },
                newText: gndSnippet,
              },
            ],
          },
        },
      });
    } else if (d.code === "M6002") {
      // Transformer winding voltage mismatch -> align V1/V2 with bus voltage
      const busKvMatch = /bus .*?\(([0-9.]+)\s*kV\)/i.exec(d.message);
      const targetKv = busKvMatch?.[1] ?? "230.0";
      for (let i = lineIdx; i < Math.min(lines.length, lineIdx + 12); i++) {
        if (/name\s*=\s*["'](?:V1|V2|Tmva)["']/i.test(lines[i]!) && /name\s*=\s*["'](?:V1|V2)["']/i.test(lines[i]!)) {
          const oldL = lines[i]!;
          const newL = oldL.replace(/(value\s*=\s*["'])[^"']*(["'])/i, `$1${targetKv}$2`);
          actions.push({
            title: `Fix M6002: Align transformer winding nominal voltage to ${targetKv} kV`,
            code: d.code,
            edit: {
              changes: {
                [uri]: [
                  {
                    range: { start: { line: i, character: 0 }, end: { line: i, character: oldL.length } },
                    newText: newL,
                  },
                ],
              },
            },
          });
          break;
        }
      }
    } else if (d.code === "M6003") {
      // Negative/zero R, L, C, or MVA -> replace with positive magnitude
      const valMatch = /(value\s*=\s*["'])(-?[0-9.eE+-]+)(["'])/i.exec(lineText);
      if (valMatch) {
        const num = parseFloat(valMatch[2]!);
        const fixedVal = Math.abs(num) > 0 ? String(Math.abs(num)) : "1.0";
        const newLine = lineText.replace(valMatch[0], `${valMatch[1]}${fixedVal}${valMatch[3]}`);
        actions.push({
          title: `Fix M6003: Set parameter value to positive '${fixedVal}'`,
          code: d.code,
          edit: {
            changes: {
              [uri]: [
                {
                  range: { start: { line: lineIdx, character: 0 }, end: { line: lineIdx, character: lineText.length } },
                  newText: newLine,
                },
              ],
            },
          },
        });
      }
    } else if (d.code === "M6004") {
      // Weak POI grid SCR < 3.0 -> switch IBR control_mode to grid_forming
      for (let i = lineIdx; i < Math.min(lines.length, lineIdx + 14); i++) {
        if (/name\s*=\s*["'](?:control_mode|controlMode)["']/i.test(lines[i]!)) {
          const oldL = lines[i]!;
          const newL = oldL.replace(/(value\s*=\s*["'])[^"']*(["'])/i, `$1grid_forming$2`);
          actions.push({
            title: `Fix M6004: Switch IBR control_mode to 'grid_forming' for weak-grid (SCR < 3.0) stability`,
            code: d.code,
            edit: {
              changes: {
                [uri]: [
                  {
                    range: { start: { line: i, character: 0 }, end: { line: i, character: oldL.length } },
                    newText: newL,
                  },
                ],
              },
            },
          });
          break;
        }
      }
    } else if (d.code === "M6005") {
      // Unconnected CSMF control input -> insert constant source block
      const cmp = project.rootModule.components.find((c) => c.id === d.componentId);
      const cx = cmp ? cmp.position.x - 54 : 108;
      const cy = cmp ? cmp.position.y : 180;
      const constSnippet = `\n        <User id="const_${d.componentId || "in"}" name="master:const" x="${cx}" y="${cy}"><param name="Value" value="0.0"/></User>`;
      actions.push({
        title: `Fix M6005: Connect 'master:const' (0.0) to open CSMF control input`,
        code: d.code,
        edit: {
          changes: {
            [uri]: [
              {
                range: {
                  start: { line: lineIdx, character: lineText.length },
                  end: { line: lineIdx, character: lineText.length },
                },
                newText: constSnippet,
              },
            ],
          },
        },
      });
    } else if (d.code === "M6006") {
      // Line travel time tau < dt -> switch line model_type to 'pi'
      for (let i = lineIdx; i < Math.min(lines.length, lineIdx + 12); i++) {
        if (/name\s*=\s*["'](?:model_type|model)["']/i.test(lines[i]!)) {
          const oldL = lines[i]!;
          const newL = oldL.replace(/(value\s*=\s*["'])[^"']*(["'])/i, `$1pi$2`);
          actions.push({
            title: `Fix M6006: Switch short line model_type to 'pi' (Nominal Pi-Section)`,
            code: d.code,
            edit: {
              changes: {
                [uri]: [
                  {
                    range: { start: { line: i, character: 0 }, end: { line: i, character: oldL.length } },
                    newText: newL,
                  },
                ],
              },
            },
          });
          break;
        }
      }
    } else if (d.code === "M6007") {
      // Invalid subtransient reactance hierarchy Xd'' > Xd' -> set Xd_sub / Xd_pp = 0.20 pu
      for (let i = lineIdx; i < Math.min(lines.length, lineIdx + 15); i++) {
        if (/name\s*=\s*["'](?:Xd_pp|Xd_sub|Xd'')["']/i.test(lines[i]!)) {
          const oldL = lines[i]!;
          const newL = oldL.replace(/(value\s*=\s*["'])[^"']*(["'])/i, `$10.20$2`);
          actions.push({
            title: `Fix M6007: Set subtransient reactance Xd'' to valid 0.20 pu (< Xd')`,
            code: d.code,
            edit: {
              changes: {
                [uri]: [
                  {
                    range: { start: { line: i, character: 0 }, end: { line: i, character: oldL.length } },
                    newText: newL,
                  },
                ],
              },
            },
          });
          break;
        }
      }
    } else if (d.code === "M6008") {
      // Under-rated MOV arrester Vref < Vbase -> raise Vref to 1.15 * Vbase
      const vbaseMatch = /bus voltage ([0-9.]+) kV/i.exec(d.message);
      const targetVref = vbaseMatch ? (parseFloat(vbaseMatch[1]!) * 1.15).toFixed(1) : "265.0";
      for (let i = lineIdx; i < Math.min(lines.length, lineIdx + 10); i++) {
        if (/name\s*=\s*["'](?:Vref|protection_level_kv|V)["']/i.test(lines[i]!)) {
          const oldL = lines[i]!;
          const newL = oldL.replace(/(value\s*=\s*["'])[^"']*(["'])/i, `$1${targetVref}$2`);
          actions.push({
            title: `Fix M6008: Upgrade MOV Vref to ${targetVref} kV (1.15 pu of bus BaseKV)`,
            code: d.code,
            edit: {
              changes: {
                [uri]: [
                  {
                    range: { start: { line: i, character: 0 }, end: { line: i, character: oldL.length } },
                    newText: newL,
                  },
                ],
              },
            },
          });
          break;
        }
      }
    } else if (d.code === "M6009") {
      // Duplicate component or bus ID -> rename id="..." to unique suffix
      const dupId = d.componentId || d.busId;
      if (dupId && /\bid\s*=\s*["'][^"']*["']/i.test(lineText)) {
        const uniqueId = `${dupId}_2`;
        const newLine = lineText.replace(/\bid\s*=\s*(["'])[^"']*\1/i, `id=$1${uniqueId}$1`);
        actions.push({
          title: `Fix M6009: Rename duplicate ID '${dupId}' to '${uniqueId}'`,
          code: d.code,
          edit: {
            changes: {
              [uri]: [
                {
                  range: { start: { line: lineIdx, character: 0 }, end: { line: lineIdx, character: lineText.length } },
                  newText: newLine,
                },
              ],
            },
          },
        });
      }
    } else if (d.code === "M6010") {
      // Bus voltage conflict -> align secondary bus vbase with primary bus voltage
      const kvMatch = /\(([0-9.]+) kV\) directly to/i.exec(d.message);
      const targetKv = kvMatch?.[1] ?? "230";
      if (/\bv_?base\s*=\s*["'][^"']*["']/i.test(lineText)) {
        const newLine = lineText.replace(/\bv_?base\s*=\s*(["'])[^"']*\1/i, `vbase=$1${targetKv}$1`);
        actions.push({
          title: `Fix M6010: Align connected bus vbase to ${targetKv} kV`,
          code: d.code,
          edit: {
            changes: {
              [uri]: [
                {
                  range: { start: { line: lineIdx, character: 0 }, end: { line: lineIdx, character: lineText.length } },
                  newText: newLine,
                },
              ],
            },
          },
        });
      }
    } else if (d.code === "M6012") {
      // CSMF algebraic loop -> insert unit-delay lag block (realpole)
      actions.push({
        title: `Fix M6012: Insert 1-step feedback lag ('master:realpole', T = Δt) to break algebraic loop`,
        code: d.code,
        edit: {
          changes: {
            [uri]: [
              {
                range: {
                  start: { line: lineIdx, character: lineText.length },
                  end: { line: lineIdx, character: lineText.length },
                },
                newText: `\n        <User id="loop_delay_${d.componentId || "1"}" name="master:realpole" x="216" y="252"><param name="G" value="1.0"/><param name="T" value="0.00005"/></User>`,
              },
            ],
          },
        },
      });
    } else if (d.code === "M6013" || d.code === "M6014") {
      // Parallel ideal voltage or inductive sources -> add 0.005 ohm damping resistance
      actions.push({
        title: `Fix ${d.code}: Add series damping resistance R = 0.005 Ω to regularize nodal conductance matrix`,
        code: d.code,
        edit: {
          changes: {
            [uri]: [
              {
                range: {
                  start: { line: lineIdx, character: lineText.length },
                  end: { line: lineIdx, character: lineText.length },
                },
                newText: `\n          <param name="R" value="0.005 [ohm]"/>`,
              },
            ],
          },
        },
      });
    } else if (d.code === "M6015") {
      // Saturated limiter -> widen Max/Min limits
      for (let i = lineIdx; i < Math.min(lines.length, lineIdx + 10); i++) {
        if (/name\s*=\s*["'](?:Max|Min|UL|LL)["']/i.test(lines[i]!)) {
          const oldL = lines[i]!;
          const isMax = /Max|UL/i.test(oldL);
          const newL = oldL.replace(/(value\s*=\s*["'])[^"']*(["'])/i, `$1${isMax ? "10.0" : "-10.0"}$2`);
          actions.push({
            title: `Fix M6015: Widen limiter ${isMax ? "upper" : "lower"} bound to ${isMax ? "10.0" : "-10.0"} pu`,
            code: d.code,
            edit: {
              changes: {
                [uri]: [
                  {
                    range: { start: { line: i, character: 0 }, end: { line: i, character: oldL.length } },
                    newText: newL,
                  },
                ],
              },
            },
          });
          break;
        }
      }
    }
  }

  return actions;
}

/**
 * Computes LSP `FoldingRange[]` for `.pscx` / `.pslx` XML elements (`<Definition>`, `<schematic>`,
 * `<User>`, `<Component>`, `<Bus>`, `<Wire>`, `<paramlist>`, `<Sticky>`).
 */
export function getPscadFoldingRanges(
  text: string,
): { startLine: number; endLine: number; kind?: string | undefined }[] {
  const ranges: { startLine: number; endLine: number; kind?: string | undefined }[] = [];
  const { toLineCol } = createXmlOffsetMapper(text);
  const offsetToLine = (offset: number) => toLineCol(offset).line;

  // Multi-line XML comments via direct index scan
  let cPos = 0;
  while (cPos < text.length) {
    const start = text.indexOf("<!--", cPos);
    if (start === -1) break;
    const end = text.indexOf("-->", start + 4);
    if (end === -1) break;
    const startLine = offsetToLine(start);
    const endLine = offsetToLine(end + 2);
    if (endLine > startLine) {
      ranges.push({ startLine, endLine, kind: "comment" });
    }
    cPos = end + 3;
  }

  const foldableTags = new Set([
    "definition",
    "schematic",
    "user",
    "component",
    "bus",
    "wire",
    "paramlist",
    "sticky",
    "hierarchy",
    "definitions",
  ]);

  const doc = parseXml(text);
  const walk = (el: XmlElement) => {
    if (foldableTags.has(el.name.toLowerCase())) {
      const startLine = offsetToLine(el.start);
      const endOffset = el.end > el.start ? el.end - 1 : el.end;
      const endLine = offsetToLine(endOffset);
      if (endLine > startLine) {
        ranges.push({ startLine, endLine });
      }
    }
    for (const child of el.children) walk(child);
  };
  if (doc.root) walk(doc.root);

  return ranges;
}
