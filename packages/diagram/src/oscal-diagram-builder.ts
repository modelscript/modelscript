// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/diagram — NIST OSCAL Authorization Boundary, CPS Security Zones & Control Matrix Diagram Builder.
 *
 * Provides vector visualizations for NIST SP 800-53 / SP 800-82 and Continuous ATO workflows:
 *   1. Authorization Boundary & IEC 62443 / SP 800-82 Cyber-Physical Security Zones & Conduits.
 *   2. NIST SP 800-53 Control Family Coverage & Risk Heatmap.
 */

export interface OscalComponentLike {
  uuid: string;
  title: string;
  type: string;
  status?: string | undefined;
  zone?: "Enterprise" | "DMZ" | "Supervisory" | "Field-OT" | string | undefined;
  implementedControls?: string[] | undefined;
}

export interface OscalImplementedRequirementLike {
  uuid?: string | undefined;
  controlId: string;
  statements?: { statementId?: string | undefined; description?: string | undefined }[] | undefined;
  byComponents?: { componentUuid: string; description?: string | undefined }[] | undefined;
}

export interface OscalFindingLike {
  uuid: string;
  title: string;
  targetControlId?: string | undefined;
  targetComponentUuid?: string | undefined;
  severity: "low" | "moderate" | "high" | "critical";
  status: "open" | "satisfied";
}

export interface OscalPoamItemLike {
  uuid: string;
  title: string;
  targetControlId?: string | undefined;
  relatedFindingUuid?: string | undefined;
  status?: string | undefined;
}

export interface OscalDocumentLike {
  kind: string;
  uuid: string;
  title?: string | undefined;
  systemName?: string | undefined;
  securitySensitivityLevel?: string | undefined;
  components?: OscalComponentLike[] | undefined;
  implementedRequirements?: OscalImplementedRequirementLike[] | undefined;
  findings?: OscalFindingLike[] | undefined;
  poamItems?: OscalPoamItemLike[] | undefined;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function classifyZone(comp: OscalComponentLike): "Enterprise" | "DMZ" | "Supervisory" | "Field-OT" {
  if (comp.zone === "Enterprise" || comp.zone === "DMZ" || comp.zone === "Supervisory" || comp.zone === "Field-OT") {
    return comp.zone;
  }
  const t = comp.type.toLowerCase();
  const title = comp.title.toLowerCase();
  if (
    t === "plc" ||
    t === "ied" ||
    t === "ot-controller" ||
    title.includes("plc") ||
    title.includes("actuator") ||
    title.includes("sensor")
  ) {
    return "Field-OT";
  }
  if (title.includes("scada") || title.includes("hmi") || title.includes("historian") || t === "hardware") {
    return "Supervisory";
  }
  if (title.includes("firewall") || title.includes("gateway") || title.includes("broker") || t === "interconnection") {
    return "DMZ";
  }
  return "Enterprise";
}

/**
 * Renders the NIST SP 800-53 / SP 800-82 System Authorization Boundary and Security Zone/Conduit Architecture.
 */
export function renderOscalBoundarySvg(doc: OscalDocumentLike): string {
  const width = 920;
  const height = 500;
  const parts: string[] = [];

  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="100%" style="background:#0f172a;font-family:'Inter','Segoe UI',sans-serif;">`,
  );

  // Header
  parts.push(`<rect x="0" y="0" width="${width}" height="40" fill="#1e293b"/>`);
  parts.push(
    `<text x="16" y="25" fill="#f8fafc" font-size="13" font-weight="600">NIST OSCAL Authorization Boundary &amp; SP 800-82 Cyber-Physical Security Zones</text>`,
  );
  parts.push(
    `<text x="${width - 16}" y="25" fill="#38bdf8" font-size="11.5" font-weight="600" text-anchor="end">FIPS-199 Impact: ${escapeXml((doc.securitySensitivityLevel ?? "MODERATE").toUpperCase())}</text>`,
  );

  // Dashed Authorization Boundary Enclosure
  parts.push(
    `<rect x="18" y="52" width="${width - 36}" height="${height - 72}" rx="8" fill="#1e293b" fill-opacity="0.22" stroke="#f43f5e" stroke-width="2" stroke-dasharray="8,5"/>`,
  );
  parts.push(
    `<rect x="34" y="43" width="250" height="18" rx="4" fill="#f43f5e"/><text x="159" y="56" fill="#ffffff" font-size="10.5" font-weight="700" text-anchor="middle">SYSTEM AUTHORIZATION BOUNDARY (ATO)</text>`,
  );

  const zones: {
    id: "Enterprise" | "DMZ" | "Supervisory" | "Field-OT";
    label: string;
    sub: string;
    y: number;
    color: string;
  }[] = [
    {
      id: "Enterprise",
      label: "Level 4: Enterprise & Cloud IT Zone",
      sub: "NIST SP 800-53 Baseline",
      y: 72,
      color: "#3b82f6",
    },
    {
      id: "DMZ",
      label: "Level 3.5: Industrial DMZ & Boundary Protection",
      sub: "SC-7 Boundary / Data Diode",
      y: 172,
      color: "#a855f7",
    },
    {
      id: "Supervisory",
      label: "Level 2/3: Supervisory SCADA / HMI / Historian",
      sub: "AU-2 / SI-4 Monitoring",
      y: 272,
      color: "#eab308",
    },
    {
      id: "Field-OT",
      label: "Level 0/1: Cyber-Physical Field Controllers (PLC / IED / RTU)",
      sub: "NIST SP 800-82 OT Overlay",
      y: 372,
      color: "#10b981",
    },
  ];

  // Map controls and open findings per component
  const controlsByComp = new Map<string, string[]>();
  for (const req of doc.implementedRequirements ?? []) {
    for (const bc of req.byComponents ?? []) {
      const list = controlsByComp.get(bc.componentUuid) ?? [];
      if (!list.includes(req.controlId.toUpperCase())) {
        list.push(req.controlId.toUpperCase());
      }
      controlsByComp.set(bc.componentUuid, list);
    }
  }

  const openFindingsByComp = new Map<string, OscalFindingLike[]>();
  for (const f of doc.findings ?? []) {
    if (f.status === "open" && f.targetComponentUuid) {
      const list = openFindingsByComp.get(f.targetComponentUuid) ?? [];
      list.push(f);
      openFindingsByComp.set(f.targetComponentUuid, list);
    }
  }

  const components = doc.components ?? [];
  const compsByZone = new Map<string, OscalComponentLike[]>();
  for (const z of zones) compsByZone.set(z.id, []);
  for (const c of components) {
    const z = classifyZone(c);
    compsByZone.get(z)?.push(c);
  }

  for (const z of zones) {
    parts.push(
      `<rect x="34" y="${z.y}" width="${width - 68}" height="86" rx="6" fill="#0f172a" fill-opacity="0.75" stroke="${z.color}" stroke-width="1.3"/>`,
    );
    parts.push(`<rect x="34" y="${z.y}" width="230" height="86" rx="6" fill="${z.color}" fill-opacity="0.14"/>`);
    parts.push(
      `<text x="46" y="${z.y + 34}" fill="#f8fafc" font-size="11.5" font-weight="700">${escapeXml(z.label)}</text>`,
    );
    parts.push(
      `<text x="46" y="${z.y + 54}" fill="${z.color}" font-size="10.5" font-weight="600">${escapeXml(z.sub)}</text>`,
    );

    const zComps = compsByZone.get(z.id) ?? [];
    if (zComps.length === 0) {
      parts.push(
        `<text x="310" y="${z.y + 47}" fill="#64748b" font-size="11" font-style="italic">No components allocated to ${z.id} zone</text>`,
      );
    } else {
      zComps.slice(0, 3).forEach((comp, idx) => {
        const cx = 280 + idx * 198;
        const cy = z.y + 11;
        const cw = 186;
        const ch = 64;

        const findings = openFindingsByComp.get(comp.uuid) ?? [];
        const hasHighRisk = findings.some((f) => f.severity === "high" || f.severity === "critical");
        const borderCol = hasHighRisk ? "#ef4444" : findings.length > 0 ? "#f59e0b" : z.color;

        parts.push(
          `<rect x="${cx}" y="${cy}" width="${cw}" height="${ch}" rx="5" fill="#1e293b" stroke="${borderCol}" stroke-width="${hasHighRisk ? 2.2 : 1.5}"/>`,
        );
        parts.push(
          `<text x="${cx + 10}" y="${cy + 19}" fill="#f8fafc" font-size="11" font-weight="600">${escapeXml(comp.title.slice(0, 22))}</text>`,
        );
        parts.push(
          `<text x="${cx + 10}" y="${cy + 34}" fill="#94a3b8" font-size="9.5">Type: ${escapeXml(comp.type.toUpperCase())}</text>`,
        );

        const ctrls = comp.implementedControls ?? controlsByComp.get(comp.uuid) ?? [];
        const badgeText = ctrls.length > 0 ? ctrls.slice(0, 4).join(", ") : "No Controls";
        parts.push(
          `<rect x="${cx + 8}" y="${cy + 41}" width="${cw - 16}" height="17" rx="3" fill="#0f172a" stroke="#334155"/>`,
        );
        parts.push(
          `<text x="${cx + 14}" y="${cy + 53}" fill="#38bdf8" font-size="9.5" font-weight="600">${escapeXml(badgeText)}</text>`,
        );

        if (findings.length > 0) {
          parts.push(
            `<circle cx="${cx + cw - 12}" cy="${cy + 14}" r="7" fill="${borderCol}"/><text x="${cx + cw - 12}" y="${cy + 18}" fill="#fff" font-size="9" font-weight="700" text-anchor="middle">!</text>`,
          );
        }
      });
    }
  }

  parts.push(`</svg>`);
  return parts.join("\n");
}

/**
 * Renders the NIST SP 800-53 Control Family Coverage & Open Finding Heatmap.
 */
export function renderOscalControlMatrixSvg(doc: OscalDocumentLike): string {
  const width = 880;
  const height = 270;
  const families = [
    { id: "AC", name: "Access Control" },
    { id: "AU", name: "Audit" },
    { id: "CM", name: "Config Mgmt" },
    { id: "CP", name: "Contingency" },
    { id: "IA", name: "Ident & Auth" },
    { id: "IR", name: "Incident Resp" },
    { id: "PE", name: "Physical / OT" },
    { id: "RA", name: "Risk Assess" },
    { id: "SC", name: "Sys & Comm" },
    { id: "SI", name: "Sys Integrity" },
    { id: "SR", name: "Supply Chain" },
  ];

  const reqCounts = new Map<string, number>();
  for (const r of doc.implementedRequirements ?? []) {
    const prefix = r.controlId.slice(0, 2).toUpperCase();
    reqCounts.set(prefix, (reqCounts.get(prefix) ?? 0) + 1);
  }

  const findingCounts = new Map<string, number>();
  for (const f of doc.findings ?? []) {
    if (f.status === "open" && f.targetControlId) {
      const prefix = f.targetControlId.slice(0, 2).toUpperCase();
      findingCounts.set(prefix, (findingCounts.get(prefix) ?? 0) + 1);
    }
  }

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="100%" style="background:#0f172a;font-family:'Inter','Segoe UI',sans-serif;">`,
  );
  parts.push(`<rect x="0" y="0" width="${width}" height="36" fill="#1e293b"/>`);
  parts.push(
    `<text x="16" y="23" fill="#f8fafc" font-size="13" font-weight="600">NIST SP 800-53 Rev 5 Control Family Implementation &amp; POA&amp;M Risk Posture</text>`,
  );

  const cellW = 74;
  const startX = 24;
  const startY = 56;

  families.forEach((fam, idx) => {
    const x = startX + idx * (cellW + 3);
    const implCount = reqCounts.get(fam.id) ?? 0;
    const openRisk = findingCounts.get(fam.id) ?? 0;
    const cardColor = openRisk > 0 ? "#ef4444" : implCount > 0 ? "#22c55e" : "#475569";

    parts.push(
      `<rect x="${x}" y="${startY}" width="${cellW}" height="180" rx="5" fill="#1e293b" stroke="${cardColor}" stroke-width="1.6"/>`,
    );
    parts.push(
      `<rect x="${x}" y="${startY}" width="${cellW}" height="32" rx="5" fill="${cardColor}" fill-opacity="0.25"/>`,
    );
    parts.push(
      `<text x="${x + cellW / 2}" y="${startY + 21}" fill="#f8fafc" font-size="13" font-weight="700" text-anchor="middle">${fam.id}</text>`,
    );
    parts.push(
      `<text x="${x + cellW / 2}" y="${startY + 52}" fill="#94a3b8" font-size="9.5" text-anchor="middle">${escapeXml(fam.name)}</text>`,
    );
    parts.push(
      `<text x="${x + cellW / 2}" y="${startY + 98}" fill="#38bdf8" font-size="22" font-weight="700" text-anchor="middle">${implCount}</text>`,
    );
    parts.push(
      `<text x="${x + cellW / 2}" y="${startY + 116}" fill="#64748b" font-size="9.5" text-anchor="middle">Controls</text>`,
    );

    const riskBadgeCol = openRisk > 0 ? "#ef4444" : "#22c55e";
    parts.push(
      `<rect x="${x + 8}" y="${startY + 142}" width="${cellW - 16}" height="22" rx="4" fill="${riskBadgeCol}" fill-opacity="0.2" stroke="${riskBadgeCol}"/>`,
    );
    parts.push(
      `<text x="${x + cellW / 2}" y="${startY + 157}" fill="${riskBadgeCol}" font-size="9.5" font-weight="700" text-anchor="middle">${openRisk > 0 ? `${openRisk} Finding` : "Compliant"}</text>`,
    );
  });

  parts.push(`</svg>`);
  return parts.join("\n");
}
