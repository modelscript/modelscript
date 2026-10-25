// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/olga — Sour Gas (H2S) Corrosion & NACE MR0175 / ISO 15156 Compliance.
 *
 * Implements:
 * 1. NACE MR0175 / ISO 15156 Environmental Severity Regions:
 *    - Region 0: Non-sour service (p_H2S < 0.003 bar)
 *    - Region 1: Low SSC severity (transition zone / high pH)
 *    - Region 2: Moderate SSC severity (requires TM0284 HIC-resistant steel)
 *    - Region 3: High SSC severity (requires CRA cladding or specialized metallurgy)
 * 2. Sulfide Stress Cracking (SSC) & Hydrogen-Induced Cracking (HIC) susceptibility matrix
 * 3. Sun & Nesic sour corrosion kinetics with iron sulfide (FeS, mackinawite) film formation
 * 4. Linepipe metallurgy compliance screening (API 5L standard vs X65MS vs Inconel 625 CRA cladding)
 */

export type NaceSourRegion = "Region 0" | "Region 1" | "Region 2" | "Region 3";

export type SscRiskLevel = "NEGLIGIBLE" | "LOW" | "MODERATE" | "SEVERE" | "CRITICAL";

export interface SourCorrosionInput {
  operatingPressurePa: number;
  operatingTemperatureK: number;
  h2sMoleFraction: number; // e.g. 0.005 for 0.5 mol% H2S
  co2MoleFraction?: number | undefined; // e.g. 0.03 for 3 mol% CO2
  pH?: number | undefined; // water phase in-situ pH (default estimated from CO2/H2S buffer)
  mixtureVelocity: number; // m/s
  pipeDiameterM: number;
  nominalWallThicknessMm: number;
  corrosionAllowanceMm: number;
  metallurgy?: string | undefined; // e.g. "API_5L_X65", "API_5L_X65MS", "INCONEL_625", "DUPLEX_2205"
  hasCraCladding?: boolean | undefined;
  hicTested?: boolean | undefined; // NACE TM0284 certified
  hardnessHrc?: number | undefined; // Rockwell C hardness (max 22 HRC per NACE MR0175)
  designLifeYears?: number | undefined;
}

export interface SourCorrosionResult {
  /** Partial pressure of hydrogen sulfide [bar]. */
  h2sPartialPressureBar: number;
  /** Partial pressure of carbon dioxide [bar]. */
  co2PartialPressureBar: number;
  /** In-situ water phase pH. */
  inSituPh: number;
  /** NACE MR0175 / ISO 15156 environmental severity region. */
  naceRegion: NaceSourRegion;
  /** Sulfide Stress Cracking (SSC) risk classification. */
  sscRisk: SscRiskLevel;
  /** Hydrogen-Induced Cracking (HIC) susceptibility. */
  isHicSusceptible: boolean;
  /** Baseline unmitigated sour corrosion rate [mm/year]. */
  corrosionRateMmPerYear: number;
  /** Protective mackinawite (FeS) scale barrier factor [0.1 - 1.0]. */
  protectiveScaleFactor: number;
  /** Whether the specified metallurgy complies with NACE MR0175 for this operating environment. */
  isMetallurgyCompliant: boolean;
  /** Specific non-compliance reasons (if any). */
  complianceViolations: string[];
  /** Recommended metallurgical upgrade or chemical scavenging mitigation. */
  mitigationRecommendation: string;
}

/**
 * Evaluates the in-situ water pH based on CO2 and H2S partial pressures and bicarbonate buffer.
 */
export function estimateInSituWaterPh(
  pressurePa: number,
  tempK: number,
  h2sMoleFraction: number,
  co2MoleFraction = 0.02,
): number {
  const pTotalBar = Math.max(1.0, pressurePa / 1e5);
  const pCo2 = Math.max(0.0001, pTotalBar * co2MoleFraction);
  const pH2s = Math.max(0.00001, pTotalBar * h2sMoleFraction);
  const tC = Math.max(0.0, tempK - 273.15);

  // De Waard & Lotz water chemistry pH correlation:
  // pH ~ 3.71 - 0.5 * log10(p_CO2) + 0.002 * T + 0.15 * log10(HCO3-)
  // Assuming typical condensed/formation water with 100 ppm bicarbonate
  let ph = 3.82 - 0.48 * Math.log10(pCo2) + 0.0025 * tC;

  // H2S dissociation (H2S <-> H+ + HS-) contributes additional acidity in sour regimes
  if (pH2s > 0.01) {
    ph -= 0.15 * Math.log10(Math.min(10.0, pH2s / 0.01));
  }

  return Math.max(3.2, Math.min(7.0, ph));
}

/**
 * Classifies the operating condition into NACE MR0175 / ISO 15156 Sour Severity Regions.
 */
export function classifyNaceSourRegion(pH2sBar: number, inSituPh: number): NaceSourRegion {
  // Region 0: p_H2S < 0.003 bar (0.05 psi)
  if (pH2sBar < 0.003) {
    return "Region 0";
  }

  // NACE MR0175 Figure B.1 boundaries:
  // Boundary 1 (Region 1 / Region 2): pH ~ 5.5 - 0.5 * log10(p_H2S / 0.01)
  // Boundary 2 (Region 2 / Region 3): pH ~ 4.5 - 0.6 * log10(p_H2S / 0.1)

  if (inSituPh >= 5.5) {
    // High pH buffer suppresses SSC
    return pH2sBar > 0.1 ? "Region 2" : "Region 1";
  }

  if (inSituPh >= 4.5) {
    if (pH2sBar <= 0.01) return "Region 1";
    if (pH2sBar <= 0.1) return "Region 2";
    return "Region 3";
  }

  // Low pH (< 4.5)
  if (pH2sBar <= 0.005) return "Region 1";
  if (pH2sBar <= 0.03) return "Region 2";
  return "Region 3";
}

/**
 * Evaluates Sour Gas (H2S) Corrosion, NACE MR0175/ISO 15156 regions, and metallurgy compliance.
 */
export function evaluateSourCorrosionIntegrity(input: SourCorrosionInput): SourCorrosionResult {
  const pTotalBar = Math.max(1.0, input.operatingPressurePa / 1e5);
  const pH2sBar = Math.max(0.0, pTotalBar * input.h2sMoleFraction);
  const pCo2Bar = Math.max(0.0001, pTotalBar * (input.co2MoleFraction ?? 0.02));

  const ph =
    input.pH ??
    estimateInSituWaterPh(
      input.operatingPressurePa,
      input.operatingTemperatureK,
      input.h2sMoleFraction,
      input.co2MoleFraction ?? 0.02,
    );

  const naceRegion = classifyNaceSourRegion(pH2sBar, ph);

  // 1. SSC & HIC Risk Assessment
  let sscRisk: SscRiskLevel = "NEGLIGIBLE";
  let isHicSusceptible = false;

  switch (naceRegion) {
    case "Region 0":
      sscRisk = "NEGLIGIBLE";
      isHicSusceptible = false;
      break;
    case "Region 1":
      sscRisk = "LOW";
      isHicSusceptible = false;
      break;
    case "Region 2":
      sscRisk = "MODERATE";
      isHicSusceptible = true;
      break;
    case "Region 3":
      sscRisk = "SEVERE";
      isHicSusceptible = true;
      break;
  }

  // 2. Sun & Nesic Sour Iron Sulfide (FeS / Mackinawite) Corrosion Kinetics
  // Base uniform reaction: log10(V_0) = 5.2 - 1500 / T + 0.4 * log10(p_H2S)
  const tK = Math.max(273.15, input.operatingTemperatureK);
  let baseRate = 0.0;
  let protectiveScaleFactor = 1.0;

  if (pH2sBar > 0.0001) {
    const logRate = 5.2 - 1500.0 / tK + 0.45 * Math.log10(pH2sBar);
    baseRate = Math.max(0.01, Math.min(15.0, Math.pow(10.0, logRate)));

    // Mackinawite film precipitates and reduces general corrosion at temperatures above 60 C
    if (tK > 333.15) {
      protectiveScaleFactor = Math.max(0.15, 1.0 - 0.015 * (tK - 333.15));
    }
  }

  const generalCorrosionRate = baseRate * protectiveScaleFactor;

  // 3. Metallurgy Compliance per NACE MR0175 / ISO 15156
  const metallurgy = (input.metallurgy || "API_5L_X65").toUpperCase();
  const hasCra =
    input.hasCraCladding ||
    metallurgy.includes("INCONEL") ||
    metallurgy.includes("625") ||
    metallurgy.includes("DUPLEX");
  const hardness = input.hardnessHrc ?? 20.0;
  const isHicCertified = input.hicTested || metallurgy.endsWith("MS") || metallurgy.endsWith("MO");

  const complianceViolations: string[] = [];

  if (hardness > 22.0) {
    complianceViolations.push(`Linepipe hardness (${hardness} HRC) exceeds NACE MR0175 threshold of 22 HRC (250 HV).`);
  }

  if (naceRegion === "Region 2") {
    if (!hasCra && !isHicCertified) {
      complianceViolations.push(
        `Operating in NACE Region 2 requires TM0284 HIC-certified steel (e.g. API 5L X65MS), but standard grade '${metallurgy}' was detected.`,
      );
    }
  } else if (naceRegion === "Region 3") {
    if (!hasCra) {
      complianceViolations.push(
        `Operating in severe NACE Region 3 requires CRA metallurgical cladding (e.g. Inconel 625) or specialized sour-certified CRA linepipe.`,
      );
    }
  }

  const isMetallurgyCompliant = complianceViolations.length === 0;

  // 4. Actionable Mitigation Recommendation
  let mitigation = "Environment conforms to material specification; normal operation.";
  if (!isMetallurgyCompliant) {
    if (naceRegion === "Region 3") {
      mitigation =
        "Upgrade linepipe with internal Inconel 625 metallurgical cladding (>= 3.0mm) or continuous subsea H2S scavenger dosing to depress p(H2S) into Region 1.";
    } else if (naceRegion === "Region 2") {
      mitigation =
        "Specify NACE TM0284 certified sour-service steel (API 5L X65MS with max hardness <= 22 HRC) and maintain pH >= 5.5.";
    } else {
      mitigation = "Control weld heat treatment to maintain hardness <= 22 HRC per NACE MR0175.";
    }
  }

  return {
    h2sPartialPressureBar: pH2sBar,
    co2PartialPressureBar: pCo2Bar,
    inSituPh: ph,
    naceRegion,
    sscRisk,
    isHicSusceptible,
    corrosionRateMmPerYear: generalCorrosionRate,
    protectiveScaleFactor,
    isMetallurgyCompliant,
    complianceViolations,
    mitigationRecommendation: mitigation,
  };
}
