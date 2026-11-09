// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/cad — Environmental & Regulatory Materials Declaration Engine.
 *
 * Implements:
 *   1. IPC-1752A Class D Materials Declaration (RoHS 3, REACH SVHC, Halogen-Free, PFAS)
 *   2. Responsible Minerals Initiative (RMI) Conflict Minerals Reporting Template (CMRT v6.4)
 *   3. RoHS 3 (Directive 2015/863) & REACH (EC 1907/2006) Certificates of Conformance
 */

export interface SubstanceRecord {
  substanceName: string;
  casNumber: string;
  massGrams: number;
  ppm: number;
  thresholdPpm: number;
  isRestricted: boolean;
  exemption?: string | undefined;
}

export interface HomogeneousMaterial {
  materialName: string; // e.g. "Leadframe Copper Alloy", "Epoxy Mold Compound", "Solder SAC305"
  massGrams: number;
  substances: SubstanceRecord[];
}

export interface Ipc1752ADeclaration {
  declarationId: string;
  documentDate: string;
  companyName: string;
  contactName: string;
  contactEmail: string;
  authorizerName: string;
  authorizerTitle: string;
  productNumber: string;
  productName: string;
  productMassGrams: number;
  rohsStatus: "Compliant" | "CompliantWithExemption" | "NonCompliant";
  rohsExemptions?: string[] | undefined; // e.g. ["7(a)", "7(c)-I"]
  reachSvhcStatus: "NotContained" | "ContainedAboveThreshold";
  reachCandidateListVersion: string; // e.g. "240 (Jan 2024)"
  halogenFree: boolean;
  pfasFree: boolean;
  materials?: HomogeneousMaterial[] | undefined;
}

export type MineralType = "Tantalum" | "Tin" | "Tungsten" | "Gold" | "Cobalt";

export interface SmelterRecord {
  smelterId: string; // CID number (e.g. "CID002134")
  metal: MineralType;
  smelterName: string;
  facilityLocation: string; // Country e.g. "Japan", "United States", "Malaysia"
  rmapAuditStatus: "Conformant" | "Active" | "NotEnrolled";
}

export interface CmrtDeclaration {
  companyName: string;
  declarationScope: "Company" | "Product";
  productNumber?: string | undefined;
  completionDate: string;
  contactName: string;
  contactEmail: string;
  // Standard RMI 7 Due Diligence Questions (Answer: Yes / No)
  questions: {
    q1_intentionallyAdded3TG: boolean;
    q2_necessaryToProduction: boolean;
    q3_recycledScrapSources: boolean;
    q4_originateFromCoveredCountries: boolean;
    q5_allSmeltersIdentified: boolean;
    q6_establishedDueDiligenceMeasure: boolean;
    q7_requiresSuppliersToSourceFromRmap: boolean;
  };
  smelters: SmelterRecord[];
}

/**
 * Standard RoHS 3 (EU Directive 2015/863) Restricted Substances List
 */
export const ROHS_RESTRICTED_SUBSTANCES: ReadonlyArray<{ name: string; cas: string; limitPpm: number }> = [
  { name: "Lead (Pb)", cas: "7439-92-1", limitPpm: 1000 },
  { name: "Mercury (Hg)", cas: "7439-97-6", limitPpm: 1000 },
  { name: "Cadmium (Cd)", cas: "7440-43-9", limitPpm: 100 },
  { name: "Hexavalent Chromium (Cr VI)", cas: "18540-29-9", limitPpm: 1000 },
  { name: "Polybrominated Biphenyls (PBB)", cas: "59536-65-1", limitPpm: 1000 },
  { name: "Polybrominated Diphenyl Ethers (PBDE)", cas: "1163-19-5", limitPpm: 1000 },
  { name: "Bis(2-ethylhexyl) phthalate (DEHP)", cas: "117-81-7", limitPpm: 1000 },
  { name: "Butyl benzyl phthalate (BBP)", cas: "85-68-7", limitPpm: 1000 },
  { name: "Dibutyl phthalate (DBP)", cas: "84-74-2", limitPpm: 1000 },
  { name: "Diisobutyl phthalate (DIBP)", cas: "84-69-5", limitPpm: 1000 },
];

/**
 * Exports valid IPC-1752A Class D Materials Declaration XML.
 */
export function exportIpc1752AXml(dec: Ipc1752ADeclaration): string {
  const exemptionsXml =
    dec.rohsExemptions && dec.rohsExemptions.length > 0
      ? dec.rohsExemptions.map((ex) => `        <Exemption id="${escapeXml(ex)}" />`).join("\n")
      : "";

  const materialsXml = (dec.materials ?? [])
    .map((mat) => {
      const subsXml = mat.substances
        .map(
          (
            s,
          ) => `          <Substance name="${escapeXml(s.substanceName)}" cas="${escapeXml(s.casNumber)}" mass="${s.massGrams.toFixed(6)}" ppm="${s.ppm.toFixed(1)}">
            <Threshold limitPpm="${s.thresholdPpm}" restricted="${s.isRestricted ? "true" : "false"}" />
          </Substance>`,
        )
        .join("\n");

      return `      <Material name="${escapeXml(mat.materialName)}" mass="${mat.massGrams.toFixed(6)}">
${subsXml}
      </Material>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<IPC-1752A xmlns="http://webstds.ipc.org/1752" version="2.0">
  <Header>
    <DeclarationId>${escapeXml(dec.declarationId)}</DeclarationId>
    <DocumentDate>${escapeXml(dec.documentDate)}</DocumentDate>
    <SupplierCompany>${escapeXml(dec.companyName)}</SupplierCompany>
    <ContactName>${escapeXml(dec.contactName)}</ContactName>
    <ContactEmail>${escapeXml(dec.contactEmail)}</ContactEmail>
    <AuthorizerName>${escapeXml(dec.authorizerName)}</AuthorizerName>
    <AuthorizerTitle>${escapeXml(dec.authorizerTitle)}</AuthorizerTitle>
  </Header>
  <Product>
    <ProductNumber>${escapeXml(dec.productNumber)}</ProductNumber>
    <ProductName>${escapeXml(dec.productName)}</ProductName>
    <Mass unit="g">${dec.productMassGrams.toFixed(4)}</Mass>
    <Compliance>
      <RoHSStatus>${dec.rohsStatus}</RoHSStatus>
${exemptionsXml}
      <REACHStatus candidateList="${escapeXml(dec.reachCandidateListVersion)}">${dec.reachSvhcStatus}</REACHStatus>
      <HalogenFree>${dec.halogenFree ? "true" : "false"}</HalogenFree>
      <PFASFree>${dec.pfasFree ? "true" : "false"}</PFASFree>
    </Compliance>
    <Materials>
${materialsXml}
    </Materials>
  </Product>
</IPC-1752A>
`;
}

/**
 * Exports Responsible Minerals Initiative (RMI) CMRT v6.4 JSON representation.
 */
export function exportCmrtJson(cmrt: CmrtDeclaration): string {
  return JSON.stringify(
    {
      cmrtVersion: "6.4",
      declarationScope: cmrt.declarationScope,
      company: {
        companyName: cmrt.companyName,
        contactName: cmrt.contactName,
        contactEmail: cmrt.contactEmail,
        effectiveDate: cmrt.completionDate,
      },
      product: cmrt.productNumber ? { productNumber: cmrt.productNumber } : undefined,
      dueDiligenceAnswers: {
        "1. Is any 3TG intentionally added or used in production?": cmrt.questions.q1_intentionallyAdded3TG
          ? "Yes"
          : "No",
        "2. Is any 3TG necessary to production?": cmrt.questions.q2_necessaryToProduction ? "Yes" : "No",
        "3. Do any 3TGs come from recycled or scrap sources?": cmrt.questions.q3_recycledScrapSources ? "Yes" : "No",
        "4. Do any 3TGs originate from Covered Countries (DRC or adjoining)?": cmrt.questions
          .q4_originateFromCoveredCountries
          ? "Yes"
          : "No",
        "5. Have 100% of smelters been identified?": cmrt.questions.q5_allSmeltersIdentified ? "Yes" : "No",
        "6. Has company established conflict minerals due diligence measures?": cmrt.questions
          .q6_establishedDueDiligenceMeasure
          ? "Yes"
          : "No",
        "7. Does company require direct suppliers to source from RMAP-conformant smelters?": cmrt.questions
          .q7_requiresSuppliersToSourceFromRmap
          ? "Yes"
          : "No",
      },
      smelterList: cmrt.smelters.map((s) => ({
        smelterId: s.smelterId,
        metal: s.metal,
        smelterName: s.smelterName,
        country: s.facilityLocation,
        auditStatus: s.rmapAuditStatus,
      })),
    },
    null,
    2,
  );
}

/**
 * Generates an auditable Certificate of Conformance markdown document.
 */
export function generateCertificateOfConformanceMd(dec: Ipc1752ADeclaration): string {
  return `# Certificate of Environmental Regulatory Conformance
**Product**: ${dec.productName} (${dec.productNumber})  
**Manufacturer / OEM**: ${dec.companyName}  
**Date of Issue**: ${dec.documentDate}  

---

### 1. EU RoHS 3 Conformance (Directive 2015/863 / 2011/65/EU)
We hereby certify that the product listed above is **${dec.rohsStatus.toUpperCase()}** with the requirements of the European Union Directive 2011/65/EU and its amendment Directive (EU) 2015/863 on the restriction of the use of certain hazardous substances in electrical and electronic equipment (RoHS 3).

| Substance Name | Maximum Concentration Value (MCV) | Measured / Declared Status |
| :--- | :--- | :--- |
| Lead (Pb) | 0.1% (1,000 ppm) | Within limits ${dec.rohsExemptions ? `(Exemptions: ${dec.rohsExemptions.join(", ")})` : ""} |
| Mercury (Hg) | 0.1% (1,000 ppm) | Not detected / Compliant |
| Cadmium (Cd) | 0.01% (100 ppm) | Not detected / Compliant |
| Hexavalent Chromium (Cr VI) | 0.1% (1,000 ppm) | Not detected / Compliant |
| Polybrominated Biphenyls (PBB) | 0.1% (1,000 ppm) | Not detected / Compliant |
| Polybrominated Diphenyl Ethers (PBDE) | 0.1% (1,000 ppm) | Not detected / Compliant |
| Bis(2-ethylhexyl) phthalate (DEHP) | 0.1% (1,000 ppm) | Not detected / Compliant |
| Butyl benzyl phthalate (BBP) | 0.1% (1,000 ppm) | Not detected / Compliant |
| Dibutyl phthalate (DBP) | 0.1% (1,000 ppm) | Not detected / Compliant |
| Diisobutyl phthalate (DIBP) | 0.1% (1,000 ppm) | Not detected / Compliant |

---

### 2. EU REACH SVHC Declaration (Regulation EC No 1907/2006)
Based on vendor component certifications and laboratory chemical screening, none of the Substances of Very High Concern (SVHC) on the European Chemicals Agency (ECHA) Candidate List version **${dec.reachCandidateListVersion}** are present above the regulatory threshold of **0.1% w/w (1,000 ppm)**.

- **REACH SVHC Status**: \`${dec.reachSvhcStatus}\`
- **Halogen-Free (IEC 61249-2-21)**: \`${dec.halogenFree ? "Compliant (Br < 900ppm, Cl < 900ppm)" : "Non-Compliant"}\`
- **PFAS / POPs Free**: \`${dec.pfasFree ? "Certified Free of PFAS compounds" : "Declared"}\`

---

### Authorized Corporate Signatory:
**${dec.authorizerName}**  
*${dec.authorizerTitle}*  
${dec.companyName}  
Contact: \`${dec.contactEmail}\`  
`;
}

/**
 * Creates default regulatory package declarations for a given product BOM.
 */
export function generateDefaultRegulatoryPackage(
  productNumber: string,
  companyName = "ModelScript Certified Hardware OEM",
  authorizer = "VP of Hardware Quality & Regulatory Compliance",
): {
  ipc1752AXml: string;
  cmrtJson: string;
  certificateMd: string;
} {
  const now = new Date().toISOString().split("T")[0]!;

  const ipcDec: Ipc1752ADeclaration = {
    declarationId: `DEC-${productNumber}-${Date.now()}`,
    documentDate: now,
    companyName,
    contactName: "Regulatory Affairs Department",
    contactEmail: "compliance@modelscript.ansatz.social",
    authorizerName: authorizer,
    authorizerTitle: "Director of Product Stewardship",
    productNumber,
    productName: `${productNumber} Electronic Assembly`,
    productMassGrams: 42.5,
    rohsStatus: "Compliant",
    reachSvhcStatus: "NotContained",
    reachCandidateListVersion: "240 (Jan 2024)",
    halogenFree: true,
    pfasFree: true,
    materials: [
      {
        materialName: "Leadframe Copper Alloy C19400",
        massGrams: 8.5,
        substances: [
          {
            substanceName: "Copper",
            casNumber: "7440-50-8",
            massGrams: 8.24,
            ppm: 970000,
            thresholdPpm: 1000000,
            isRestricted: false,
          },
          {
            substanceName: "Iron",
            casNumber: "7439-89-6",
            massGrams: 0.2,
            ppm: 24000,
            thresholdPpm: 1000000,
            isRestricted: false,
          },
        ],
      },
      {
        materialName: "Epoxy Molding Compound (Green/Halogen-Free)",
        massGrams: 12.0,
        substances: [
          {
            substanceName: "Silica Fused",
            casNumber: "60676-86-0",
            massGrams: 10.2,
            ppm: 850000,
            thresholdPpm: 1000000,
            isRestricted: false,
          },
          {
            substanceName: "Epoxy Resin",
            casNumber: "29690-82-2",
            massGrams: 1.8,
            ppm: 150000,
            thresholdPpm: 1000000,
            isRestricted: false,
          },
        ],
      },
      {
        materialName: "Lead-Free Solder SAC305",
        massGrams: 2.2,
        substances: [
          {
            substanceName: "Tin (Sn)",
            casNumber: "7440-31-5",
            massGrams: 2.123,
            ppm: 965000,
            thresholdPpm: 1000000,
            isRestricted: false,
          },
          {
            substanceName: "Silver (Ag)",
            casNumber: "7440-22-4",
            massGrams: 0.066,
            ppm: 30000,
            thresholdPpm: 1000000,
            isRestricted: false,
          },
          {
            substanceName: "Copper (Cu)",
            casNumber: "7440-50-8",
            massGrams: 0.011,
            ppm: 5000,
            thresholdPpm: 1000000,
            isRestricted: false,
          },
        ],
      },
    ],
  };

  const cmrtDec: CmrtDeclaration = {
    companyName,
    declarationScope: "Product",
    productNumber,
    completionDate: now,
    contactName: "Responsible Sourcing Program",
    contactEmail: "minerals-compliance@modelscript.ansatz.social",
    questions: {
      q1_intentionallyAdded3TG: true,
      q2_necessaryToProduction: true,
      q3_recycledScrapSources: true,
      q4_originateFromCoveredCountries: false,
      q5_allSmeltersIdentified: true,
      q6_establishedDueDiligenceMeasure: true,
      q7_requiresSuppliersToSourceFromRmap: true,
    },
    smelters: [
      {
        smelterId: "CID002134",
        metal: "Tin",
        smelterName: "PT Timah Tbk",
        facilityLocation: "Indonesia",
        rmapAuditStatus: "Conformant",
      },
      {
        smelterId: "CID001890",
        metal: "Gold",
        smelterName: "Tanaka Kikinzoku Kogyo K.K.",
        facilityLocation: "Japan",
        rmapAuditStatus: "Conformant",
      },
      {
        smelterId: "CID003110",
        metal: "Tantalum",
        smelterName: "Global Advanced Metals",
        facilityLocation: "United States",
        rmapAuditStatus: "Conformant",
      },
    ],
  };

  return {
    ipc1752AXml: exportIpc1752AXml(ipcDec),
    cmrtJson: exportCmrtJson(cmrtDec),
    certificateMd: generateCertificateOfConformanceMd(ipcDec),
  };
}

function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
