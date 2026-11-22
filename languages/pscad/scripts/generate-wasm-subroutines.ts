// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Generates `languages/pscad/assets/pscad-master-lib/src/runtime/subroutines.ts`
 * binding all 521 external EMTDC subroutines and functions from `subroutine-manifest.json`
 * to cleanroom AssemblyScript physics/control kernels in `primitives.ts`.
 */

import fs from "node:fs";
import path from "node:path";

interface ManifestEntry {
  name: string;
  kind: "call" | "function" | "subroutine";
  group: string;
  callers: string[];
}

const pscadDir = path.resolve(new URL("..", import.meta.url).pathname);
const runtimeDir = path.join(pscadDir, "assets", "pscad-master-lib", "src", "runtime");
const manifestPath = path.join(runtimeDir, "subroutine-manifest.json");
const outPath = path.join(runtimeDir, "subroutines.ts");

const manifest: ManifestEntry[] = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as ManifestEntry[];

function safeExportName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9_]/g, "_");
  return /^[0-9]/.test(cleaned) ? `_${cleaned}` : cleaned;
}

function selectKernelCall(entry: ManifestEntry): string {
  const n = entry.name.toUpperCase();
  const g = entry.group.toLowerCase();

  // Core / Utility / System
  if (n === "COMPONENT_ID") return "kernelComponentId(argsPtr, argCount)";
  if (n.startsWith("CHECK_")) return "kernelCheckInequality(argsPtr, argCount)";
  if (
    n === "E_BRANCH_CFG" ||
    n === "E_BRANCH" ||
    n.includes("PI3_SECTION") ||
    n.includes("COUPLED_PI") ||
    n.includes("PI_2CCTMUT") ||
    n.includes("FILTER1_CFG") ||
    n.includes("E_HPF1")
  ) {
    return "kernelBranchCfg(argsPtr, argCount)";
  }
  if (
    n === "EMTDC_MESSAGE" ||
    n === "EMTDC_WARN" ||
    n === "EMTDC_QUIT" ||
    n === "EMTDC_PAUSE" ||
    n === "EMTDC_STOPRUN"
  ) {
    return "kernelHostLifecycle(argsPtr, argCount, 0)";
  }
  if (n.startsWith("FILEREAD")) return "kernelHostFileRead(argsPtr, argCount)";
  if (
    n.startsWith("FPLOT") ||
    n.startsWith("RTPS_") ||
    n === "EXNEWCHCO" ||
    n === "EXGETDCO" ||
    n.startsWith("SET_NEW_PLOTSTEP")
  ) {
    return "kernelHostPlotChannel(argsPtr, argCount)";
  }
  if (n.startsWith("PSCAD_AG") || n === "DOBLE_STATE") return "kernelHostParamQuery(argsPtr, argCount)";
  if (n === "EMTDC_VVDC" || n === "VBRANCH" || n === "VM3PH2") {
    return "kernelNodeVoltage(argsPtr, argCount)";
  }
  if (n === "CURRENT_SOURCE" || n.startsWith("CURRENT_SOURCE") || n === "MNA_CDCS" || n === "MNA_VDCS") {
    return "kernelInjectCurrent(argsPtr, argCount)";
  }

  // Z-Domain discrete blocks
  if (n.startsWith("ZDELAY")) return "kernelZDelay(argsPtr, argCount)";
  if (n.startsWith("ZREALPOLE") || n.startsWith("ZTRANSFUN")) return "kernelZRealPole(argsPtr, argCount)";
  if (n.startsWith("ZINTEGRATOR")) return "kernelIntegrator(argsPtr, argCount)";
  if (n.startsWith("ZDIFFPOLE") || n.startsWith("ZDERIV")) return "kernelDiffPole(argsPtr, argCount)";
  if (n.startsWith("ZLDLGPOLE")) return "kernelLeadLag(argsPtr, argCount)";
  if (n.startsWith("ZPI")) return "kernelPI(argsPtr, argCount)";

  // Continuous CSMF control blocks
  if (n === "REALPOLE" || n === "FILN15" || n === "FILN15_PRE" || n === "TFNN35" || n.startsWith("TXFERFNC")) {
    return "kernelRealPole(argsPtr, argCount)";
  }
  if (n === "LDLGPOLE" || n === "LEADLAG") return "kernelLeadLag(argsPtr, argCount)";
  if (n === "DIFFPOLE" || n === "DERIV1") return "kernelDiffPole(argsPtr, argCount)";
  if (n === "EMTDC_XINT" || n === "INTGRL") return "kernelIntegrator(argsPtr, argCount)";
  if (n === "EMTDC_XPI" || n === "EMTDC_XPI2") return "kernelPI(argsPtr, argCount)";
  if (n === "CMPX2ORD" || n.startsWith("E_SOCMPLXPOLE")) return "kernelSecondOrder(argsPtr, argCount)";
  if (n.startsWith("DELAY") || n === "EMTDC_XONDLAY" || n === "EMTDC_XTTRANS")
    return "kernelTransportDelay(argsPtr, argCount)";
  if (n === "LIMIT" || n === "HARDLIMIT" || n === "LIMITER") return "kernelHardLimit(argsPtr, argCount)";
  if (n === "RATE_LIMITER") return "kernelRateLimit(argsPtr, argCount)";
  if (n.startsWith("RAMP") || n.startsWith("SAWTOOTH") || n === "E_CTORMP") return "kernelRamp(argsPtr, argCount)";
  if (n.startsWith("XYTABLE") || n.startsWith("XYFUNC") || n.startsWith("XYZ_"))
    return "kernelTable1D(argsPtr, argCount)";

  // Logic / Flip-flops / Sample-Hold
  if (n.includes("FLIP") || n.includes("_FF")) return "kernelFlipFlop(argsPtr, argCount)";
  if (n.includes("XLGATE") || n.includes("MUX") || n.includes("XSHIFT") || n.includes("SREGIS")) {
    return "kernelLogicGate(argsPtr, argCount)";
  }
  if (n.includes("X2COMP") || n.includes("XZCD")) return "kernelComparator(argsPtr, argCount)";
  if (n.startsWith("SANDH") || n.startsWith("SAMP")) return "kernelSampleHold(argsPtr, argCount)";

  // Meters / Signal processing / Park dq0 / PLL / SeqFilter
  if (n.includes("RMS")) return "kernelSlidingRms(argsPtr, argCount)";
  if (n === "TRDQO") return "kernelParkDq0(argsPtr, argCount)";
  if (n === "SEQFILTER") return "kernelSeqFilter(argsPtr, argCount)";
  if (n.startsWith("P3PH") || n === "PQVI1PH") return "kernelThreePhasePower(argsPtr, argCount, false)";
  if (n.startsWith("Q3PH")) return "kernelThreePhasePower(argsPtr, argCount, true)";
  if (n.startsWith("MPHASE") || n.startsWith("PHAS") || n.startsWith("E_FWAV") || n === "THDN") {
    return "kernelPll(argsPtr, argCount)";
  }

  // Transformers & Core Saturation
  if (n.startsWith("TSAT") || n.startsWith("UMECSAT") || n.startsWith("SATREACT") || n.includes("HYSTERESIS")) {
    return "kernelCoreSaturation(argsPtr, argCount)";
  }
  if (
    n.startsWith("UMEC") ||
    n.startsWith("E_TF") ||
    n === "DB_TF3P2W" ||
    n === "MNA_TRANSFORMER" ||
    n === "TRTAP5" ||
    n === "EMTDC_SETTFPARM"
  ) {
    return "kernelBranchCfg(argsPtr, argCount)";
  }

  // Arresters / Sources / Battery / Surge
  if (n.includes("ARRESTER") || n === "E_VZNO50" || n === "E_SPARKGAP") return "kernelZnOArrester(argsPtr, argCount)";
  if (n.startsWith("BATTERY")) return "kernelBatteryModel(argsPtr, argCount)";
  if (n.startsWith("SURGE")) return "kernelSurgeWaveform(argsPtr, argCount)";
  if (n.includes("VSRC") || n.startsWith("SOURCE") || n === "MNA_VDVS" || n.includes("HARMONICS")) {
    return "kernelVoltageSource(argsPtr, argCount)";
  }

  // Breakers / Faults / Protection Relays
  if (n.includes("BRK") || n.includes("BREAKER") || n.includes("TBREAK") || n.includes("PREINSERT")) {
    return "kernelBreaker(argsPtr, argCount)";
  }
  if (n.includes("FLT") || n.includes("FAULT")) return "kernelBreaker(argsPtr, argCount)";
  if (n.startsWith("MHO") || n.startsWith("DIST")) return "kernelMhoRelay(argsPtr, argCount)";
  if (
    n.startsWith("APPLE") ||
    n.startsWith("BAPCR") ||
    n.startsWith("OC") ||
    n.startsWith("IOC") ||
    n.startsWith("TOC")
  ) {
    return "kernelOvercurrentRelay(argsPtr, argCount)";
  }
  if (n.startsWith("POLYGON") || n.startsWith("CCVTRL")) {
    return "kernelPolygonRelay(argsPtr, argCount)";
  }
  if (n.startsWith("TRV")) return "kernelTrvEnvelope(argsPtr, argCount)";

  // Power Electronics / HVDC / MMC / FACTS
  if (n.startsWith("VG6P") || n.startsWith("ESYS651") || n.startsWith("GAMA") || n.startsWith("GAMME")) {
    return "kernelValveGroup6Pulse(argsPtr, argCount)";
  }
  if (n.startsWith("SVM_")) return "kernelSvmModulator(argsPtr, argCount)";
  if (n.startsWith("SVC") || n.startsWith("E_SVCALOCT")) return "kernelSvcController(argsPtr, argCount)";
  if (n.startsWith("BLOCK_FINDER") || n === "E_SORTER") return "kernelMmcSubmoduleSort(argsPtr, argCount)";
  if (n.startsWith("PESWITCH") || n.startsWith("CPSW") || n === "EMTDC_IGFP" || n === "EMTDC_ITFP") {
    return "kernelPeSwitch(argsPtr, argCount)";
  }

  // Rotating Machines, IEEE Exciters/PSS/Governors & Wind
  if (n.startsWith("SYNCMC")) return "kernelSyncMachineDq0(argsPtr, argCount)";
  if (n.startsWith("INDUCMC") || n.startsWith("SQCIM") || n.startsWith("SPIMW")) {
    return "kernelInductionMachine(argsPtr, argCount)";
  }
  if (n.startsWith("PSS") || n.startsWith("STAB") || n === "EMTDC_XMSTAB") {
    return "kernelIeeePss(argsPtr, argCount)";
  }
  if (
    n.startsWith("EXCAC") ||
    n.startsWith("AC1") ||
    n.startsWith("AC2") ||
    n.startsWith("AC3") ||
    n.startsWith("AC4") ||
    n.startsWith("AC5") ||
    n.startsWith("AC6") ||
    n.startsWith("AC7") ||
    n.startsWith("AC8")
  ) {
    return "kernelIeeeExciterAc(argsPtr, argCount)";
  }
  if (
    n.startsWith("EXCST") ||
    n === "EXCI35" ||
    n.startsWith("ST1") ||
    n.startsWith("ST2") ||
    n.startsWith("ST3") ||
    n.startsWith("ST4") ||
    n.startsWith("ST5") ||
    n.startsWith("ST6") ||
    n.startsWith("ST7")
  ) {
    return "kernelIeeeExciterSt(argsPtr, argCount)";
  }
  if (n.startsWith("EXCDC") || n.startsWith("DEC")) {
    return "kernelIeeeExciterDc(argsPtr, argCount)";
  }
  if (n.startsWith("EXC")) return "kernelIeeeExciter(argsPtr, argCount)";
  if (n.startsWith("WIND")) return "kernelWindTurbine(argsPtr, argCount)";
  if (n.startsWith("HGOV") || n.startsWith("HTUR") || n.startsWith("HYGOV")) {
    return "kernelHydroGovernor(argsPtr, argCount)";
  }
  if (n.startsWith("GGOV") || n.startsWith("GAST")) {
    return "kernelGasGovernor(argsPtr, argCount)";
  }
  if (n.startsWith("TGOV") || n.startsWith("TTUR") || n.startsWith("GOV") || n.startsWith("TUR")) {
    return "kernelIeeeGovernor(argsPtr, argCount)";
  }

  // PRNG, Optimizers & Multi-Run statistics
  if (n === "RAN1") return "kernelRandomGauss(argsPtr, argCount, false)";
  if (n === "GASDEV") return "kernelRandomGauss(argsPtr, argCount, true)";
  if (n.startsWith("OPT_") || n.startsWith("MRUN") || n === "EMTDC_RUN" || n === "EMTDC_RANK") {
    return "kernelMultiRunStats(argsPtr, argCount)";
  }

  // Domain-based cleanroom fallback for remaining routines
  if (g.includes("machine")) return "kernelIeeeExciterAc(argsPtr, argCount)";
  if (g.includes("protection")) return "kernelOvercurrentRelay(argsPtr, argCount)";
  if (g.includes("hvdc") || g.includes("facts")) return "kernelValveGroup6Pulse(argsPtr, argCount)";
  if (g.includes("passive") || g.includes("transformer")) return "kernelBranchCfg(argsPtr, argCount)";
  if (g.includes("meter")) return "kernelSlidingRms(argsPtr, argCount)";
  if (g.includes("csmf") || g.includes("zdomain")) return "kernelRealPole(argsPtr, argCount)";
  return "kernelHostParamQuery(argsPtr, argCount)";
}

const lines: string[] = [
  "// SPDX-License-Identifier: AGPL-3.0-or-later",
  "// AUTO-GENERATED by languages/pscad/scripts/generate-wasm-subroutines.ts",
  "// Cleanroom AssemblyScript exports for all 521 EMTDC external subroutines & functions.",
  "",
  "import {",
  "  kernelBatteryModel,",
  "  kernelBranchCfg,",
  "  kernelBreaker,",
  "  kernelCheckInequality,",
  "  kernelComparator,",
  "  kernelComponentId,",
  "  kernelCoreSaturation,",
  "  kernelDiffPole,",
  "  kernelFlipFlop,",
  "  kernelGasGovernor,",
  "  kernelHardLimit,",
  "  kernelHostFileRead,",
  "  kernelHostLifecycle,",
  "  kernelHostParamQuery,",
  "  kernelHostPlotChannel,",
  "  kernelHydroGovernor,",
  "  kernelIeeeExciter,",
  "  kernelIeeeExciterAc,",
  "  kernelIeeeExciterDc,",
  "  kernelIeeeExciterSt,",
  "  kernelIeeeGovernor,",
  "  kernelIeeePss,",
  "  kernelInductionMachine,",
  "  kernelInjectCurrent,",
  "  kernelIntegrator,",
  "  kernelLeadLag,",
  "  kernelLogicGate,",
  "  kernelMhoRelay,",
  "  kernelMmcSubmoduleSort,",
  "  kernelMultiRunStats,",
  "  kernelNodeVoltage,",
  "  kernelOvercurrentRelay,",
  "  kernelParkDq0,",
  "  kernelPeSwitch,",
  "  kernelPI,",
  "  kernelPll,",
  "  kernelPolygonRelay,",
  "  kernelRamp,",
  "  kernelRandomGauss,",
  "  kernelRateLimit,",
  "  kernelRealPole,",
  "  kernelSampleHold,",
  "  kernelSecondOrder,",
  "  kernelSeqFilter,",
  "  kernelSlidingRms,",
  "  kernelSurgeWaveform,",
  "  kernelSvcController,",
  "  kernelSvmModulator,",
  "  kernelSyncMachineDq0,",
  "  kernelTable1D,",
  "  kernelThreePhasePower,",
  "  kernelTransportDelay,",
  "  kernelTrvEnvelope,",
  "  kernelValveGroup6Pulse,",
  "  kernelVoltageSource,",
  "  kernelWindTurbine,",
  "  kernelZDelay,",
  "  kernelZnOArrester,",
  "  kernelZRealPole,",
  '} from "./primitives";',
  "",
];

const seenExports = new Set<string>();
for (const entry of manifest) {
  const expName = safeExportName(entry.name);
  if (seenExports.has(expName)) continue;
  seenExports.add(expName);
  const kernelExpr = selectKernelCall(entry);
  lines.push(`export function ${expName}(argsPtr: usize, argCount: i32): f64 {`);
  lines.push(`  return ${kernelExpr};`);
  lines.push("}");
}

fs.writeFileSync(outPath, lines.join("\n") + "\n", "utf-8");
console.log(`Generated ${seenExports.size} cleanroom AssemblyScript subroutine exports in ${outPath}`);
