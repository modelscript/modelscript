// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cleanroom Master Library Catalog & Icon Generator.
 *
 * Extracts ONLY public interface specifications (component names, parameter keys/types/units/bounds/choices,
 * port coordinates/kinds, and external subroutine call names) from a local `master.pslx` file.
 * Strictly strips all vendor FlyBy prose, `<graphics>`/`<Gfx>` XML, and `<script>` source bodies.
 *
 * Usage:
 *   npx tsx languages/pscad/scripts/generate-cleanroom-catalog.ts [/path/to/master.pslx]
 */

import type { DiagramComponentSpec, LibrarySymbolStub } from "@modelscript/runtime";
import fs from "node:fs";
import path from "node:path";
import { generateCleanroomSvgIcon, type CleanroomPortSpec } from "../assets/pscad-master-lib/src/icons/primitives.js";
import { EXTRA_MASTER_PORT_LAYOUTS } from "../src/catalog/master-port-layouts.js";
import { readDefinitionForm } from "../src/model/definition-form.js";
import { attr, buildProjectModel, type ModelDefinition } from "../src/model/pscad-model.js";

const pscadDir = path.resolve(new URL("..", import.meta.url).pathname);
const masterLibSrc = path.join(pscadDir, "assets", "pscad-master-lib", "src");
const pslxPath = process.argv[2] ?? process.env["PSCAD_MASTER_LIB_PATH"] ?? "/home/omar/Downloads/master.pslx";

if (!fs.existsSync(pslxPath)) {
  console.error(`master.pslx not found at ${pslxPath}`);
  process.exit(1);
}

type Category =
  | "Sources & Rotating Machines"
  | "Transformers, Lines & Cables"
  | "Power Electronics, HVDC & FACTS"
  | "Switchgear & Protection"
  | "CSMF Control Blocks"
  | "Meters, Probes & Buses";

function deduceCategory(name: string, group: string): Category {
  const n = name.toLowerCase();
  const g = group.toLowerCase();
  if (
    g.includes("source") ||
    g.includes("machine") ||
    n.includes("machine") ||
    n.includes("motor") ||
    n.includes("source") ||
    n.includes("vsrc") ||
    n.includes("wound_rotor") ||
    n.includes("sqc") ||
    n.includes("spim") ||
    n.includes("wind_") ||
    n.includes("th_gov") ||
    n.includes("th_tur")
  ) {
    return "Sources & Rotating Machines";
  }
  if (
    g.includes("transformer") ||
    g.includes("transmission") ||
    g.includes("cable") ||
    g.includes("pi section") ||
    g.includes("passive") ||
    n.includes("tline") ||
    n.includes("cable") ||
    n.includes("xfmr") ||
    n.includes("umec") ||
    n.includes("transformer") ||
    n.includes("inductor") ||
    n.includes("capacitor") ||
    n.includes("resistor") ||
    n.includes("rlc") ||
    n.includes("newpi")
  ) {
    return "Transformers, Lines & Cables";
  }
  if (
    g.includes("hvdc") ||
    g.includes("facts") ||
    g.includes("mmc") ||
    n.includes("vsc") ||
    n.includes("pwm") ||
    n.includes("lcc") ||
    n.includes("thyristor") ||
    n.includes("inverter") ||
    n.includes("converter") ||
    n.includes("peswitch") ||
    n.includes("diode") ||
    n.includes("igbt") ||
    n.includes("gto") ||
    n.includes("battery") ||
    n.includes("mmc") ||
    n.includes("svc") ||
    n.includes("svm")
  ) {
    return "Power Electronics, HVDC & FACTS";
  }
  if (
    g.includes("breaker") ||
    g.includes("fault") ||
    g.includes("protection") ||
    n.includes("breaker") ||
    n.includes("switch") ||
    n.includes("fault") ||
    n.includes("tpflt") ||
    n.includes("arrester") ||
    n.includes("mov") ||
    n.includes("relay") ||
    n.includes("polygon") ||
    n.includes("trv")
  ) {
    return "Switchgear & Protection";
  }
  if (
    g.includes("meter") ||
    g.includes("i/o") ||
    g.includes("recorder") ||
    g.includes("import") ||
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

function deduceDomain(cat: Category): "electrical" | "control" | "meter" | "bus" {
  if (cat === "Meters, Probes & Buses") return "meter";
  if (cat === "CSMF Control Blocks") return "control";
  return "electrical";
}

function toHumanLabel(name: string): string {
  return name
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

function deduceTab(catName: string): "General" | "Ratings" | "Impedances" | "Control" | "Geometry" | "Protection" {
  const c = catName.toLowerCase();
  if (c.includes("rating") || c.includes("base") || c.includes("nominal")) return "Ratings";
  if (c.includes("impedance") || c.includes("winding") || c.includes("saturation") || c.includes("data"))
    return "Impedances";
  if (c.includes("control") || c.includes("limit") || c.includes("gain") || c.includes("initial")) return "Control";
  if (c.includes("geom") || c.includes("tower") || c.includes("conductor") || c.includes("dimension"))
    return "Geometry";
  if (c.includes("protect") || c.includes("trip") || c.includes("fault") || c.includes("breaker")) return "Protection";
  return "General";
}

function buildPorts(def: ModelDefinition): CleanroomPortSpec[] {
  const extra = EXTRA_MASTER_PORT_LAYOUTS[def.name] ?? EXTRA_MASTER_PORT_LAYOUTS[def.name.toLowerCase()];
  if (extra && extra.length > 0) {
    return extra.map((p) => ({
      name: p.name,
      kind: p.kind === "electrical" ? "electrical" : "signal",
      side: Math.abs(p.x) >= Math.abs(p.y) ? (p.x < 0 ? "left" : "right") : p.y < 0 ? "top" : "bottom",
      dx: p.x,
      dy: p.y,
    }));
  }
  if (def.ports.length > 0) {
    return def.ports.map((p) => {
      const side: "left" | "right" | "top" | "bottom" =
        Math.abs(p.x) >= Math.abs(p.y) ? (p.x < 0 ? "left" : "right") : p.y < 0 ? "top" : "bottom";
      const isSig = p.mode === 1 || p.mode === 2 || (p.electype === 0 && p.mode !== 3);
      return {
        name: p.name,
        kind: isSig ? "signal" : "electrical",
        side,
        dx: p.x,
        dy: p.y,
      };
    });
  }
  return [];
}

console.log(`Reading ${pslxPath}...`);
const xml = fs.readFileSync(pslxPath, "utf-8");
const project = buildProjectModel(xml);
console.log(`Parsed ${project.definitions.size} definitions from master.pslx`);

// Load existing curated symbols/diagrams to preserve hand-authored aliases & descriptions
const existingSymbolsPath = path.join(masterLibSrc, "symbols.json");
const existingDiagramsPath = path.join(masterLibSrc, "diagrams.json");
const existingSymbols: LibrarySymbolStub[] = fs.existsSync(existingSymbolsPath)
  ? (JSON.parse(fs.readFileSync(existingSymbolsPath, "utf-8")) as LibrarySymbolStub[])
  : [];
const existingDiagrams: DiagramComponentSpec[] = fs.existsSync(existingDiagramsPath)
  ? (JSON.parse(fs.readFileSync(existingDiagramsPath, "utf-8")) as DiagramComponentSpec[])
  : [];

const curatedSymByName = new Map<string, LibrarySymbolStub>();
for (const s of existingSymbols) {
  curatedSymByName.set(s.name.toLowerCase(), s);
}
const curatedDiagByName = new Map<string, DiagramComponentSpec>();
for (const d of existingDiagrams) {
  const short = (d.namePath.includes(":") ? d.namePath.split(":").pop()! : d.namePath).toLowerCase();
  curatedDiagByName.set(short, d);
}

const outSymbols: LibrarySymbolStub[] = [];
const outDiagrams: DiagramComponentSpec[] = [];
const emittedNames = new Set<string>();

// Extract subroutine/function interface manifest (names + domain only, zero source)
const subroutineMap = new Map<
  string,
  { name: string; kind: "call" | "function" | "subroutine"; group: string; callers: string[] }
>();

for (const def of project.definitions.values()) {
  const shortLower = def.name.toLowerCase();
  const groupAttr = attr(def.element, "group") ?? "";
  const classid = attr(def.element, "classid") ?? "UserCmpDefn";
  const isModule = def.instances.length > 0 || def.wires.length > 0;
  const category = deduceCategory(def.name, groupAttr);
  const domain = deduceDomain(category);
  const namePath = `master:${def.name}`;

  // Collect external subroutine calls & #FUNCTION/#SUBROUTINE names
  if (def.scripts) {
    for (const seg of def.scripts.values()) {
      const content = seg.content;
      for (const m of content.matchAll(/\bCALL\s+([A-Za-z0-9_]+)/gi)) {
        const sub = m[1]!.toUpperCase();
        const rec = subroutineMap.get(sub) ?? {
          name: sub,
          kind: "call" as const,
          group: groupAttr || category,
          callers: [],
        };
        if (!rec.callers.includes(def.name)) rec.callers.push(def.name);
        subroutineMap.set(sub, rec);
      }
      for (const m of content.matchAll(/\b(EMTC?_[A-Za-z0-9_]+)\b/gi)) {
        const sub = m[1]!.toUpperCase();
        const rec = subroutineMap.get(sub) ?? {
          name: sub,
          kind: "call" as const,
          group: groupAttr || category,
          callers: [],
        };
        if (!rec.callers.includes(def.name)) rec.callers.push(def.name);
        subroutineMap.set(sub, rec);
      }
      for (const m of content.matchAll(/#FUNCTION\s+[A-Za-z0-9_]+\s+([A-Za-z0-9_]+)/gi)) {
        const fn = m[1]!.toUpperCase();
        const rec = subroutineMap.get(fn) ?? {
          name: fn,
          kind: "function" as const,
          group: groupAttr || category,
          callers: [],
        };
        rec.kind = "function";
        if (!rec.callers.includes(def.name)) rec.callers.push(def.name);
        subroutineMap.set(fn, rec);
      }
      for (const m of content.matchAll(/#SUBROUTINE\s+([A-Za-z0-9_]+)/gi)) {
        const sub = m[1]!.toUpperCase();
        const rec = subroutineMap.get(sub) ?? {
          name: sub,
          kind: "subroutine" as const,
          group: groupAttr || category,
          callers: [],
        };
        if (rec.kind === "call") rec.kind = "subroutine";
        if (!rec.callers.includes(def.name)) rec.callers.push(def.name);
        subroutineMap.set(sub, rec);
      }
    }
  }

  emittedNames.add(shortLower);
  const curatedSym = curatedSymByName.get(shortLower);
  const curatedDiag = curatedDiagByName.get(shortLower);

  // Build cleanroom parameter list from <form> (strictly stripping vendor FlyBy/help prose)
  const form = readDefinitionForm(def);
  const formParams: Array<Record<string, unknown>> = [];
  const seenKeys = new Set<string>();

  if (curatedSym) {
    const curatedParams = (curatedSym.metadata?.["parameters"] as Array<Record<string, unknown>>) ?? [];
    for (const cp of curatedParams) {
      const k = String(cp["key"]);
      seenKeys.add(k.toLowerCase());
      formParams.push(cp);
    }
  }

  if (form) {
    for (const cat of form.categories) {
      const tab = deduceTab(cat.name);
      for (const p of cat.parameters) {
        if (seenKeys.has(p.name.toLowerCase())) continue;
        seenKeys.add(p.name.toLowerCase());
        let kind: "number" | "string" | "boolean" | "select" = "string";
        if (p.type === "Boolean") kind = "boolean";
        else if (p.type === "Real" || p.type === "Integer") kind = "number";
        else if (p.type === "Choice" && p.choices && p.choices.length > 0) kind = "select";

        const defaultVal =
          kind === "number"
            ? Number.isFinite(Number(p.defaultValue))
              ? Number(p.defaultValue)
              : 0
            : kind === "boolean"
              ? p.defaultValue === "1" || p.defaultValue.toLowerCase() === "true"
              : p.defaultValue;

        const cleanLabel = toHumanLabel(p.name);
        const unitSuffix = p.unit ? ` (${p.unit})` : "";
        const entry: Record<string, unknown> = {
          key: p.name,
          label: cleanLabel,
          tab,
          group: cat.name || "General",
          kind,
          ...(p.unit ? { unit: p.unit } : {}),
          defaultValue: defaultVal,
          ...(p.min !== undefined ? { min: p.min } : {}),
          ...(p.max !== undefined ? { max: p.max } : {}),
          ...(kind === "select" && p.choices
            ? {
                options: p.choices.map((c) => ({
                  value: c.value,
                  label: c.label,
                })),
              }
            : {}),
          description: `Cleanroom parameter ${p.name}${unitSuffix} for ${def.name}`,
        };
        formParams.push(entry);
      }
    }
  }

  // Include any remaining default paramlist keys not already in form
  for (const [k, v] of def.params.entries()) {
    if (seenKeys.has(k.toLowerCase())) continue;
    seenKeys.add(k.toLowerCase());
    const num = Number(v);
    const isNum = v.trim() !== "" && Number.isFinite(num);
    formParams.push({
      key: k,
      label: toHumanLabel(k),
      tab: "General",
      group: "Parameters",
      kind: isNum ? "number" : "string",
      defaultValue: isNum ? num : v,
      description: `Cleanroom parameter ${k} for ${def.name}`,
    });
  }

  const label = (curatedSym?.metadata?.["label"] as string) ?? toHumanLabel(def.name);
  const aliases = Array.from(new Set([def.name, namePath, ...((curatedSym?.metadata?.["aliases"] as string[]) ?? [])]));
  const cleanDescription =
    (curatedSym?.metadata?.["description"] as string) ??
    `Cleanroom ${category} component (${def.name})${isModule ? " [hierarchical module]" : ""}.`;

  outSymbols.push({
    name: def.name,
    kind: "pscad_component",
    ruleName: classid,
    namePath,
    exports: formParams.map((p) => String(p["key"])),
    inherits: [],
    metadata: {
      label,
      category: (curatedSym?.metadata?.["category"] as string) ?? category,
      domain: (curatedSym?.metadata?.["domain"] as string) ?? domain,
      description: cleanDescription,
      aliases,
      group: groupAttr || undefined,
      isModule,
      parameters: formParams,
    },
  });

  const ports: CleanroomPortSpec[] =
    curatedDiag?.ports && curatedDiag.ports.length > 0
      ? curatedDiag.ports.map((p) => ({
          name: p.name,
          kind: p.kind === "signal" ? "signal" : "electrical",
          side: p.side,
          dx: p.dx,
          dy: p.dy,
        }))
      : buildPorts(def);

  const width = curatedDiag?.width ?? Math.max(60, ...ports.map((p) => Math.abs(p.dx) * 2));
  const height = curatedDiag?.height ?? Math.max(48, ...ports.map((p) => Math.abs(p.dy) * 2));

  const svg = generateCleanroomSvgIcon({
    name: def.name,
    label,
    category: (curatedSym?.metadata?.["category"] as string) ?? category,
    domain: ((curatedSym?.metadata?.["domain"] as string) ?? domain) as "electrical" | "control" | "meter" | "bus",
    group: groupAttr,
    isModule,
    width,
    height,
    ports,
  });

  outDiagrams.push({
    namePath,
    aliases,
    label,
    category: (curatedSym?.metadata?.["category"] as string) ?? category,
    domain: (curatedSym?.metadata?.["domain"] as string) ?? domain,
    width,
    height,
    ports,
    svg,
  });
}

// Preserve any curated standalone components not present verbatim in master.pslx (e.g. fmu_ibr, vsc_pwm, lcc_6pulse, mmc_thevenin, tline, cable)
for (const sym of existingSymbols) {
  if (emittedNames.has(sym.name.toLowerCase())) continue;
  outSymbols.push(sym);
  const diag = curatedDiagByName.get(sym.name.toLowerCase());
  if (diag) {
    const ports: CleanroomPortSpec[] = diag.ports.map((p) => ({
      name: p.name,
      kind: p.kind === "signal" ? "signal" : "electrical",
      side: p.side,
      dx: p.dx,
      dy: p.dy,
    }));
    outDiagrams.push({
      ...diag,
      svg:
        diag.svg ??
        generateCleanroomSvgIcon({
          name: sym.name,
          label: diag.label,
          category: diag.category ?? "CSMF Control Blocks",
          domain: (diag.domain as "electrical" | "control" | "meter" | "bus") ?? "electrical",
          width: diag.width,
          height: diag.height,
          ports,
        }),
    });
  }
}

fs.writeFileSync(path.join(masterLibSrc, "symbols.json"), JSON.stringify(outSymbols, null, 2) + "\n", "utf-8");
fs.writeFileSync(path.join(masterLibSrc, "diagrams.json"), JSON.stringify(outDiagrams, null, 2) + "\n", "utf-8");

const runtimeDir = path.join(masterLibSrc, "runtime");
fs.mkdirSync(runtimeDir, { recursive: true });
const sortedSubs = Array.from(subroutineMap.values()).sort((a, b) => a.name.localeCompare(b.name));
fs.writeFileSync(
  path.join(runtimeDir, "subroutine-manifest.json"),
  JSON.stringify(sortedSubs, null, 2) + "\n",
  "utf-8",
);

console.log(`Wrote ${outSymbols.length} cleanroom symbols to src/symbols.json`);
console.log(`Wrote ${outDiagrams.length} cleanroom SVG diagrams to src/diagrams.json`);
console.log(`Wrote ${sortedSubs.length} unique subroutine/function signatures to src/runtime/subroutine-manifest.json`);
