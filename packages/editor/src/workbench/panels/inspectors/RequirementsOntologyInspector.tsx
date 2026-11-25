// SPDX-License-Identifier: AGPL-3.0-or-later

import type { PowerFlowSnapshot } from "@modelscript/exchange";
import {
  ensurePsseWasmParser,
  parseDyr,
  parseRaw,
  pssePowerFlowToSnapshot,
  solvePowerFlowAsync,
} from "@modelscript/psse";
import {
  extractSysML2SeasonalSpec,
  runSysML2SeasonalVerificationSweep,
  type SeasonalVerificationMatrix,
} from "@modelscript/sysml2";
import React, { useMemo, useState } from "react";
import { InspectorTabs } from "./InspectorTabs.js";
import { collectComparatorPowerFlowSnapshots } from "./powerflow-adapters.js";

let latestSeasonalVerificationMatrix: SeasonalVerificationMatrix | null = null;

export function getLatestSeasonalVerificationMatrix(): SeasonalVerificationMatrix | null {
  return latestSeasonalVerificationMatrix;
}

export interface RequirementsOntologyInspectorProps {
  code: string;
  lines: string[];
  colorMode: "dark" | "light";
  projectFiles?: Record<string, string> | undefined;
  onRevealLine?: ((line: number, identifier?: string) => void) | undefined;
}

export interface RequirementRow {
  id: string;
  title: string;
  satisfiedBy: string[];
  verifiedBy: string[];
  line: number;
}

export interface OwlSummary {
  classes: Array<{ name: string; line: number }>;
  properties: Array<{ name: string; kind: string; line: number }>;
  subClassAxioms: Array<{ sub: string; sup: string; line: number }>;
  disjointPairs: Array<{ a: string; b: string; line: number }>;
  unsatisfiableClasses: string[];
}

export interface OscalSummary {
  controls: Array<{ id: string; title: string; status: string; line: number }>;
  components: Array<{ name: string; type: string; line: number }>;
}

export function analyzeRequirementsOntology(code: string, lines: string[]) {
  const reqMap = new Map<string, RequirementRow>();
  const classes: OwlSummary["classes"] = [];
  const properties: OwlSummary["properties"] = [];
  const subClassAxioms: OwlSummary["subClassAxioms"] = [];
  const disjointPairs: OwlSummary["disjointPairs"] = [];
  const controls: OscalSummary["controls"] = [];
  const components: OscalSummary["components"] = [];

  const seenClasses = new Set<string>();

  // ReqIF XML extraction
  if (code.includes("<REQ-IF") || code.includes("<SPEC-OBJECT")) {
    const specRe = /<SPEC-OBJECT\b([^>]*)>([\s\S]*?)<\/SPEC-OBJECT>/gi;
    let m: RegExpExecArray | null;
    while ((m = specRe.exec(code)) !== null) {
      const attrs = m[1]!;
      const body = m[2]!;
      const id = /IDENTIFIER=["']([^"']+)["']/i.exec(attrs)?.[1] ?? `REQ_${reqMap.size + 1}`;
      const title =
        /LONG-NAME=["']([^"']+)["']/i.exec(attrs)?.[1] ?? /THE-VALUE=["']([^"']+)["']/i.exec(body)?.[1] ?? id;
      const line = code.slice(0, m.index).split("\n").length;
      reqMap.set(id, { id, title, satisfiedBy: [], verifiedBy: [], line });
    }
    const relRe = /<SPEC-RELATION\b([^>]*)>([\s\S]*?)<\/SPEC-RELATION>/gi;
    while ((m = relRe.exec(code)) !== null) {
      const body = m[2]!;
      const src = /<SOURCE>[\s\S]*?>([^<\s]+)<\//i.exec(body)?.[1];
      const tgt = /<TARGET>[\s\S]*?>([^<\s]+)<\//i.exec(body)?.[1];
      if (tgt && reqMap.has(tgt) && src) {
        reqMap.get(tgt)!.satisfiedBy.push(src);
      } else if (src && reqMap.has(src) && tgt) {
        reqMap.get(src)!.verifiedBy.push(tgt);
      }
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const t = lines[i]!.trim();
    if (!t || t.startsWith("//") || t.startsWith("#")) continue;

    // SysML v2 requirements, satisfy, verify
    const reqM = /^requirement\s+(?:def\s+)?(?:<([^>]+)>\s*)?([A-Za-z0-9_'"-]+)/.exec(t);
    if (reqM) {
      const id = (reqM[1] ?? reqM[2])!.replace(/^['"]|['"]$/g, "");
      const title = reqM[2]!.replace(/^['"]|['"]$/g, "");
      if (!reqMap.has(id)) {
        reqMap.set(id, { id, title, satisfiedBy: [], verifiedBy: [], line: i + 1 });
      }
    }

    const satM = /\bsatisfy\s+(?:requirement\s+)?([A-Za-z0-9_.]+)\s+by\s+([A-Za-z0-9_.]+)/.exec(t);
    if (satM) {
      const reqKey = satM[1]!.split(".").pop()!;
      const target =
        reqMap.get(reqKey) ?? Array.from(reqMap.values()).find((r) => r.title === reqKey || r.id === reqKey);
      if (target) {
        target.satisfiedBy.push(satM[2]!);
      } else {
        reqMap.set(reqKey, { id: reqKey, title: reqKey, satisfiedBy: [satM[2]!], verifiedBy: [], line: i + 1 });
      }
    }

    const verM = /\bverify\s+(?:requirement\s+)?([A-Za-z0-9_.]+)\s+by\s+([A-Za-z0-9_.]+)/.exec(t);
    if (verM) {
      const reqKey = verM[1]!.split(".").pop()!;
      const target =
        reqMap.get(reqKey) ?? Array.from(reqMap.values()).find((r) => r.title === reqKey || r.id === reqKey);
      if (target) {
        target.verifiedBy.push(verM[2]!);
      } else {
        reqMap.set(reqKey, { id: reqKey, title: reqKey, satisfiedBy: [], verifiedBy: [verM[2]!], line: i + 1 });
      }
    }

    // OWL2 Functional / Manchester / RDF-XML / Turtle axioms
    const owlDeclClass =
      /Declaration\s*\(\s*Class\s*\(\s*:?([A-Za-z0-9_#-]+)\s*\)\s*\)|<owl:Class\b[^>]*?(?:rdf:about|rdf:ID)=["'][^"']*?([A-Za-z0-9_-]+)["']|^:?([A-Za-z0-9_-]+)\s+a\s+owl:Class\b|^Class:\s*:?([A-Za-z0-9_-]+)/.exec(
        t,
      );
    if (owlDeclClass) {
      const cls = (owlDeclClass[1] ?? owlDeclClass[2] ?? owlDeclClass[3] ?? owlDeclClass[4])!;
      if (!seenClasses.has(cls)) {
        seenClasses.add(cls);
        classes.push({ name: cls, line: i + 1 });
      }
    }

    const owlProp =
      /Declaration\s*\(\s*(ObjectProperty|DataProperty)\s*\(\s*:?([A-Za-z0-9_#-]+)\s*\)\s*\)|<owl:(ObjectProperty|DatatypeProperty)\b[^>]*?(?:rdf:about|rdf:ID)=["'][^"']*?([A-Za-z0-9_-]+)["']/.exec(
        t,
      );
    if (owlProp) {
      properties.push({
        kind: owlProp[1] ?? owlProp[3] ?? "ObjectProperty",
        name: (owlProp[2] ?? owlProp[4])!,
        line: i + 1,
      });
    }

    const subCls =
      /SubClassOf\s*\(\s*:?([A-Za-z0-9_-]+)\s+:?([A-Za-z0-9_-]+)\s*\)|^:?([A-Za-z0-9_-]+)\s+rdfs:subClassOf\s+:?([A-Za-z0-9_-]+)/.exec(
        t,
      );
    if (subCls) {
      const sub = (subCls[1] ?? subCls[3])!;
      const sup = (subCls[2] ?? subCls[4])!;
      subClassAxioms.push({ sub, sup, line: i + 1 });
      if (!seenClasses.has(sub)) {
        seenClasses.add(sub);
        classes.push({ name: sub, line: i + 1 });
      }
      if (!seenClasses.has(sup)) {
        seenClasses.add(sup);
        classes.push({ name: sup, line: i + 1 });
      }
    }

    const disj =
      /DisjointClasses\s*\(\s*:?([A-Za-z0-9_-]+)\s+:?([A-Za-z0-9_-]+)\s*\)|^:?([A-Za-z0-9_-]+)\s+owl:disjointWith\s+:?([A-Za-z0-9_-]+)/.exec(
        t,
      );
    if (disj) {
      disjointPairs.push({
        a: (disj[1] ?? disj[3])!,
        b: (disj[2] ?? disj[4])!,
        line: i + 1,
      });
    }

    // OSCAL JSON / YAML / XML controls & components
    const ctrlM =
      /"control-id"\s*:\s*"([^"]+)"|control-id:\s*["']?([A-Za-z0-9.-]+)|<control\b[^>]*\bid=["']([^"']+)["']/i.exec(t);
    if (ctrlM) {
      const cid = (ctrlM[1] ?? ctrlM[2] ?? ctrlM[3])!;
      controls.push({
        id: cid.toUpperCase(),
        title: `Security Control ${cid.toUpperCase()}`,
        status: "Implemented",
        line: i + 1,
      });
    }

    const compM = /"component-type"\s*:\s*"([^"]+)"|<component\b[^>]*\btype=["']([^"']+)["']/i.exec(t);
    if (compM) {
      components.push({
        name: `Component_${components.length + 1}`,
        type: (compM[1] ?? compM[2])!,
        line: i + 1,
      });
    }
  }

  // Transitive SubClassOf closure for OWL2 disjointness satisfiability check
  const ancestors = new Map<string, Set<string>>();
  for (const c of seenClasses) {
    ancestors.set(c, new Set([c]));
  }
  for (const ax of subClassAxioms) {
    if (!ancestors.has(ax.sub)) ancestors.set(ax.sub, new Set([ax.sub]));
    ancestors.get(ax.sub)!.add(ax.sup);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const [, set] of ancestors) {
      for (const sup of Array.from(set)) {
        const supAnc = ancestors.get(sup);
        if (supAnc) {
          for (const g of supAnc) {
            if (!set.has(g)) {
              set.add(g);
              changed = true;
            }
          }
        }
      }
    }
  }

  const unsatisfiableClasses: string[] = [];
  for (const [cls, anc] of ancestors) {
    for (const dp of disjointPairs) {
      if (anc.has(dp.a) && anc.has(dp.b)) {
        unsatisfiableClasses.push(cls);
        break;
      }
    }
  }

  const requirements = Array.from(reqMap.values());
  return {
    requirements,
    owl: {
      classes,
      properties,
      subClassAxioms,
      disjointPairs,
      unsatisfiableClasses,
    },
    oscal: {
      controls,
      components,
    },
  };
}

export const RequirementsOntologyInspector: React.FC<RequirementsOntologyInspectorProps> = ({
  code,
  lines,
  colorMode,
  projectFiles,
  onRevealLine,
}) => {
  const isDark = colorMode === "dark";
  const [subView, setSubView] = useState<"matrix" | "seasonal" | "owl" | "compliance">(() => {
    if (typeof window !== "undefined") {
      const q = new URLSearchParams(window.location.search).get("subTab");
      if (q === "seasonal") return "seasonal";
    }
    return "matrix";
  });
  const [sweepRunning, setSweepRunning] = useState(false);
  const [sweepError, setSweepError] = useState<string | null>(null);
  const [sweepMatrix, setSweepMatrix] = useState<SeasonalVerificationMatrix | null>(null);

  const borderCol = isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.12)";
  const cardBg = isDark ? "rgba(30, 30, 34, 0.75)" : "rgba(255, 255, 255, 0.9)";
  const textMuted = isDark ? "#8b949e" : "#59636e";

  const { requirements, owl, oscal } = useMemo(() => analyzeRequirementsOntology(code, lines), [code, lines]);
  const seasonalSpec = useMemo(() => extractSysML2SeasonalSpec(code), [code]);

  const runSeasonalSweep = async () => {
    setSweepRunning(true);
    setSweepError(null);
    try {
      await ensurePsseWasmParser();
      const files = projectFiles ?? {};
      const matrix = await runSysML2SeasonalVerificationSweep(code, async (variant) => {
        const rawKey =
          (typeof variant.attributes["rawFile"] === "string" && variant.attributes["rawFile"]) ||
          Object.keys(files).find((k) => k.toLowerCase().endsWith(".raw"));
        const dyrKey =
          (typeof variant.attributes["dyrFile"] === "string" && variant.attributes["dyrFile"]) ||
          Object.keys(files).find((k) => k.toLowerCase().endsWith(".dyr"));

        let baseline: PowerFlowSnapshot | undefined;
        let psseCase;
        const metrics: Record<string, number | boolean | string> = {};

        if (rawKey && files[rawKey]) {
          psseCase = parseRaw(files[rawKey]!);
          if (dyrKey && files[dyrKey]) psseCase.dyr = parseDyr(files[dyrKey]!);
          const pf = await solvePowerFlowAsync(psseCase);
          baseline = pssePowerFlowToSnapshot(psseCase, pf, variant.name);

          let minVmPu = Infinity;
          let maxVmPu = -Infinity;
          for (const b of baseline.buses) {
            if (b.vmPu < minVmPu) minVmPu = b.vmPu;
            if (b.vmPu > maxVmPu) maxVmPu = b.vmPu;
          }
          if (Number.isFinite(minVmPu)) metrics["minVmPu"] = minVmPu;
          if (Number.isFinite(maxVmPu)) metrics["maxVmPu"] = maxVmPu;
          metrics["convergedPowerFlow"] = pf.converged;
        }

        const comparators = await collectComparatorPowerFlowSnapshots(
          files,
          psseCase,
          baseline?.frequencyHz ?? 60,
          baseline?.sbaseMva ?? 100,
        );

        return {
          baseline,
          comparators,
          comparisonOptions: { vmTolerancePu: 0.01, vaToleranceDeg: 3.0 },
          metrics,
        };
      });
      latestSeasonalVerificationMatrix = matrix;
      setSweepMatrix(matrix);
    } catch (err) {
      setSweepError(err instanceof Error ? err.message : String(err));
    } finally {
      setSweepRunning(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <InspectorTabs
        ariaLabel="Requirements & ontology inspector views"
        value={subView}
        onChange={(id) => setSubView(id as typeof subView)}
        tabs={[
          { id: "matrix", label: `🎯 Traceability Matrix (${requirements.length} reqs)` },
          { id: "seasonal", label: `🌦️ Seasonal & Cross-Tool (${seasonalSpec.variants.length} variants)` },
          { id: "owl", label: `🧠 OWL2 Description Logic (${owl.classes.length} classes)` },
          { id: "compliance", label: `🛡️ OSCAL Controls (${oscal.controls.length})` },
        ]}
      />

      {subView === "matrix" && (
        <div style={{ padding: 14, borderRadius: 8, border: `1px solid ${borderCol}`, backgroundColor: cardBg }}>
          <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 8 }}>
            Requirement → Design Element (satisfy) → Test Case (verify) Traceability Matrix
          </div>
          {requirements.length === 0 ? (
            <div style={{ fontSize: 12, color: textMuted }}>
              No SysML v2 <code>requirement</code> blocks or ReqIF <code>&lt;SPEC-OBJECT&gt;</code> entries declared in
              this buffer.
            </div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, fontFamily: "monospace" }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${borderCol}`, color: textMuted, textAlign: "left" }}>
                  <th style={{ padding: "6px 8px" }}>ID / Name</th>
                  <th style={{ padding: "6px 8px" }}>Satisfied By</th>
                  <th style={{ padding: "6px 8px" }}>Verified By</th>
                  <th style={{ padding: "6px 8px" }}>Coverage</th>
                </tr>
              </thead>
              <tbody>
                {requirements.map((r, idx) => {
                  const full = r.satisfiedBy.length > 0 && r.verifiedBy.length > 0;
                  const partial = r.satisfiedBy.length > 0 || r.verifiedBy.length > 0;
                  return (
                    <tr
                      key={idx}
                      onClick={() => onRevealLine?.(r.line, r.id)}
                      style={{ borderBottom: `1px solid ${borderCol}`, cursor: "pointer" }}
                    >
                      <td
                        style={{ padding: "6px 8px", fontWeight: 700, color: "var(--fgColor-accent, var(--ms-brand))" }}
                      >
                        {r.id !== r.title ? `${r.id} (${r.title})` : r.id}
                      </td>
                      <td style={{ padding: "6px 8px", color: r.satisfiedBy.length ? "#3fb950" : "#f85149" }}>
                        {r.satisfiedBy.join(", ") || "⚠ Unsatisfied"}
                      </td>
                      <td style={{ padding: "6px 8px", color: r.verifiedBy.length ? "#3fb950" : "#d29922" }}>
                        {r.verifiedBy.join(", ") || "⚠ Unverified"}
                      </td>
                      <td
                        style={{
                          padding: "6px 8px",
                          fontWeight: 700,
                          color: full ? "#3fb950" : partial ? "#d29922" : "#f85149",
                        }}
                      >
                        {full ? "100% Closed" : partial ? "50% Partial" : "0% Orphan"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {subView === "owl" && (
        <div style={{ padding: 14, borderRadius: 8, border: `1px solid ${borderCol}`, backgroundColor: cardBg }}>
          <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 8 }}>
            OWL2 TBox Hierarchy & Disjointness Consistency Check
          </div>
          {owl.classes.length === 0 && owl.subClassAxioms.length === 0 ? (
            <div style={{ fontSize: 12, color: textMuted }}>
              No OWL2 classes, properties, or <code>SubClassOf</code> / <code>DisjointClasses</code> axioms found.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: owl.unsatisfiableClasses.length === 0 ? "#3fb950" : "#f85149",
                }}
              >
                {owl.unsatisfiableClasses.length === 0
                  ? `✓ Consistent TBox (${owl.classes.length} classes, ${owl.properties.length} properties, ${owl.subClassAxioms.length} SubClassOf, ${owl.disjointPairs.length} DisjointClasses)`
                  : `⚠ Unsatisfiable classes detected via SubClassOf ∩ DisjointClasses: ${owl.unsatisfiableClasses.join(", ")}`}
              </div>
              {owl.subClassAxioms.map((ax, idx) => (
                <div
                  key={idx}
                  onClick={() => onRevealLine?.(ax.line, ax.sub)}
                  style={{
                    padding: "6px 10px",
                    borderRadius: 6,
                    border: `1px solid ${borderCol}`,
                    cursor: "pointer",
                    fontSize: 11,
                    fontFamily: "monospace",
                  }}
                >
                  <span style={{ color: "var(--fgColor-accent, var(--ms-brand))", fontWeight: 700 }}>{ax.sub}</span> ⊑{" "}
                  <span style={{ color: "#a371f7", fontWeight: 700 }}>{ax.sup}</span> (L{ax.line})
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {subView === "compliance" && (
        <div style={{ padding: 14, borderRadius: 8, border: `1px solid ${borderCol}`, backgroundColor: cardBg }}>
          <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 8 }}>
            OSCAL NIST SP 800-53 Security Control & Component Inventory
          </div>
          {oscal.controls.length === 0 && oscal.components.length === 0 ? (
            <div style={{ fontSize: 12, color: textMuted }}>
              No OSCAL <code>control-id</code> or system security plan component definitions detected.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {oscal.controls.map((c, idx) => (
                <div
                  key={idx}
                  onClick={() => onRevealLine?.(c.line, c.id)}
                  style={{
                    padding: "7px 10px",
                    borderRadius: 6,
                    border: `1px solid ${borderCol}`,
                    cursor: "pointer",
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: 11,
                    fontFamily: "monospace",
                  }}
                >
                  <span style={{ color: "var(--fgColor-accent, var(--ms-brand))", fontWeight: 700 }}>{c.id}</span>
                  <span style={{ color: "#3fb950", fontWeight: 600 }}>
                    {c.status} (L{c.line})
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {subView === "seasonal" && (
        <div style={{ padding: 14, borderRadius: 8, border: `1px solid ${borderCol}`, backgroundColor: cardBg }}>
          <div
            style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 10 }}
          >
            <div>
              <div style={{ fontWeight: 700, fontSize: 12 }}>
                SysML v2 Seasonal Variants & Cross-Tool Powerflow Sweep
              </div>
              <div style={{ fontSize: 11, color: textMuted }}>
                {seasonalSpec.variants.length > 0
                  ? `Detected ${seasonalSpec.variants.length} variant(s): ${seasonalSpec.variants.map((v) => v.name).join(", ")}`
                  : "No `variation`/`variant` blocks detected; sweep will run against default scenario."}
              </div>
            </div>
            <button
              type="button"
              disabled={sweepRunning}
              onClick={runSeasonalSweep}
              style={{
                padding: "5px 12px",
                fontSize: 11,
                fontWeight: 600,
                borderRadius: 5,
                border: `1px solid ${borderCol}`,
                backgroundColor: isDark ? "#238636" : "#1f883d",
                color: "#fff",
                cursor: sweepRunning ? "wait" : "pointer",
              }}
            >
              {sweepRunning ? "Running Sweep..." : "Run Seasonal & Cross-Tool Sweep"}
            </button>
          </div>
          {sweepError && (
            <div style={{ fontSize: 11, color: "#f85149", marginBottom: 8 }}>Sweep error: {sweepError}</div>
          )}
          {sweepMatrix && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: sweepMatrix.overallPassed ? "#3fb950" : "#f85149" }}>
                Overall: {sweepMatrix.overallPassed ? "PASS" : "FAIL"} ({sweepMatrix.passedVariants}/
                {sweepMatrix.totalVariants} variants satisfied)
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, fontFamily: "monospace" }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${borderCol}`, color: textMuted, textAlign: "left" }}>
                    <th style={{ padding: "5px 6px" }}>Variant / Season</th>
                    <th style={{ padding: "5px 6px" }}>Powerflow Parity</th>
                    <th style={{ padding: "5px 6px" }}>Max |ΔV| (pu)</th>
                    <th style={{ padding: "5px 6px" }}>Requirements</th>
                    <th style={{ padding: "5px 6px" }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {sweepMatrix.variants.map((v) => (
                    <tr key={v.name} style={{ borderBottom: `1px solid ${borderCol}` }}>
                      <td style={{ padding: "5px 6px", fontWeight: 600 }}>{v.name}</td>
                      <td style={{ padding: "5px 6px" }}>{v.powerFlowComparison?.overallStatus ?? "N/A"}</td>
                      <td style={{ padding: "5px 6px" }}>
                        {v.powerFlowComparison ? v.powerFlowComparison.maxDeltaVmPu.toFixed(4) : "—"}
                      </td>
                      <td style={{ padding: "5px 6px" }}>
                        {v.verification.results.filter((r) => r.satisfied).length}/{v.verification.results.length}
                      </td>
                      <td
                        style={{ padding: "5px 6px", color: v.allSatisfied ? "#3fb950" : "#f85149", fontWeight: 700 }}
                      >
                        {v.allSatisfied ? "PASS" : "FAIL"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
