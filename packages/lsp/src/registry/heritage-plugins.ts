// SPDX-License-Identifier: AGPL-3.0-or-later

import { acslLanguage, getAcslDocumentSymbols, getAcslHover, validateAcsl } from "@modelscript/acsl";
import { apdlLanguage, getApdlDocumentSymbols, getApdlHover, validateApdl } from "@modelscript/apdl";
import { aptLanguage, getAptDocumentSymbols, getAptHover, validateApt } from "@modelscript/apt";
import {
  arinc429Language,
  getArinc429DocumentSymbols,
  getArinc429Hover,
  validateArinc429,
} from "@modelscript/arinc429";
import { asn1Language, getAsn1DocumentSymbols, getAsn1Hover, validateAsn1 } from "@modelscript/asn1";
import { bufrLanguage, getBufrDocumentSymbols, getBufrHover, validateBufr } from "@modelscript/bufr";
import { ceaLanguage, getCeaDocumentSymbols, getCeaHover, validateCea } from "@modelscript/cea";
import { chemkinLanguage, getChemkinDocumentSymbols, getChemkinHover, validateChemkin } from "@modelscript/chemkin";
import { cifLanguage, getCifDocumentSymbols, getCifHover, validateCif } from "@modelscript/cif";
import {
  cplexLpLanguage,
  getCplexLpDocumentSymbols,
  getCplexLpHover,
  parseCplexLp,
  solveCplexLp,
  validateCplexLp,
} from "@modelscript/cplex-lp";
import { csmpLanguage, getCsmpDocumentSymbols, getCsmpHover, validateCsmp } from "@modelscript/csmp";
import { datcomLanguage, getDatcomDocumentSymbols, getDatcomHover, validateDatcom } from "@modelscript/datcom";
import { doe2Language, getDoe2DocumentSymbols, getDoe2Hover, validateDoe2 } from "@modelscript/doe2";
import { dxfLanguage, getDxfDocumentSymbols, getDxfHover, validateDxf } from "@modelscript/dxf";
import { dynamoLanguage, getDynamoDocumentSymbols, getDynamoHover, validateDynamo } from "@modelscript/dynamo";
import { edifLanguage, getEdifDocumentSymbols, getEdifHover, validateEdif } from "@modelscript/edif";
import { endf6Language, getEndf6DocumentSymbols, getEndf6Hover, validateEndf6 } from "@modelscript/endf6";
import { eslLanguage, getEslDocumentSymbols, getEslHover, validateEsl } from "@modelscript/esl";
import { esterelLanguage, getEsterelDocumentSymbols, getEsterelHover, validateEsterel } from "@modelscript/esterel";
import { fitsLanguage, getFitsDocumentSymbols, getFitsHover, validateFits } from "@modelscript/fits";
import { gamsLanguage, getGamsDocumentSymbols, getGamsHover, solveGams, validateGams } from "@modelscript/gams";
import {
  gaussianLanguage,
  getGaussianDocumentSymbols,
  getGaussianHover,
  validateGaussian,
} from "@modelscript/gaussian";
import { gcodeLanguage, getGCodeDocumentSymbols, getGCodeHover, validateGCode } from "@modelscript/gcode";
import { gdsiiLanguage, getGdsiiDocumentSymbols, getGdsiiHover, validateGdsii } from "@modelscript/gdsii";
import { gerberLanguage, getGerberDocumentSymbols, getGerberHover, validateGerber } from "@modelscript/gerber";
import { getGpssDocumentSymbols, getGpssHover, gpssLanguage, validateGpss } from "@modelscript/gpss";
import { getGribDocumentSymbols, getGribHover, gribLanguage, validateGrib } from "@modelscript/grib";
import { getHdf4DocumentSymbols, getHdf4Hover, hdf4Language, validateHdf4 } from "@modelscript/hdf4";
import {
  getDocumentSymbols as getHec1DocumentSymbols,
  getHover as getHec1Hover,
  hec1Language,
  validateHec1,
} from "@modelscript/hec1";
import { getHec2Diagnostics, getHec2DocumentSymbols, getHec2Hover, hec2Language } from "@modelscript/hec2";
import { getIeeeCdfDocumentSymbols, getIeeeCdfHover, ieeeCdfLanguage, validateIeeeCdf } from "@modelscript/ieee-cdf";
import { getIgesDocumentSymbols, getIgesHover, igesLanguage, validateIges } from "@modelscript/iges";
import { getIhexDocumentSymbols, getIhexHover, ihexLanguage, validateIhex } from "@modelscript/ihex";
import { getIrig106DocumentSymbols, getIrig106Hover, irig106Language, validateIrig106 } from "@modelscript/irig106";
import { getIucrCifDocumentSymbols, getIucrCifHover, iucrCifLanguage, validateIucrCif } from "@modelscript/iucr-cif";
import { getJcampDxDocumentSymbols, getJcampDxHover, jcampDxLanguage, validateJcampDx } from "@modelscript/jcamp-dx";
import { getJedecDocumentSymbols, getJedecHover, jedecLanguage, validateJedec } from "@modelscript/jedec";
import { getLsDynaDocumentSymbols, getLsDynaHover, lsdynaLanguage, validateLsDyna } from "@modelscript/lsdyna";
import { getLustreDocumentSymbols, getLustreHover, lustreLanguage, validateLustre } from "@modelscript/lustre";
import { getMcnpDocumentSymbols, getMcnpHover, mcnpLanguage, validateMcnp } from "@modelscript/mcnp";
import { getMelcorDocumentSymbols, getMelcorHover, melcorLanguage, validateMelcor } from "@modelscript/melcor";
import { getMolfileDocumentSymbols, getMolfileHover, molfileLanguage, validateMolfile } from "@modelscript/molfile";
import { getMpsDocumentSymbols, getMpsHover, mpsLanguage, validateMps } from "@modelscript/mps";
import { getNasaCdfDocumentSymbols, getNasaCdfHover, nasaCdfLanguage, validateNasaCdf } from "@modelscript/nasa-cdf";
import { getNec2DocumentSymbols, getNec2Hover, nec2Language, validateNec2 } from "@modelscript/nec2";
import { getNetcdfDocumentSymbols, getNetcdfHover, netcdfLanguage, validateNetcdf } from "@modelscript/netcdf";
import {
  getNmea0183DocumentSymbols,
  getNmea0183Hover,
  nmea0183Language,
  validateNmea0183,
} from "@modelscript/nmea0183";
import { getObjDocumentSymbols, getObjHover, objLanguage, validateObj } from "@modelscript/obj";
import { getPlot3dDocumentSymbols, getPlot3dHover, plot3dLanguage, validatePlot3d } from "@modelscript/plot3d";
import { getRinexDocumentSymbols, getRinexHover, rinexLanguage, validateRinex } from "@modelscript/rinex";
import { getScaleDocumentSymbols, getScaleHover, scaleLanguage, validateScale } from "@modelscript/scale";
import { getSdlDocumentSymbols, getSdlHover, sdlLanguage, validateSdl } from "@modelscript/sdl";
import { getSegyDocumentSymbols, getSegyHover, segyLanguage, validateSegy } from "@modelscript/segy";
import {
  getSimscriptDocumentSymbols,
  getSimscriptHover,
  simscriptLanguage,
  validateSimscript,
} from "@modelscript/simscript";
import { getSindaDocumentSymbols, getSindaHover, sindaLanguage, validateSinda } from "@modelscript/sinda";
import { getSlamDocumentSymbols, getSlamHover, slamLanguage, validateSlam } from "@modelscript/slam";
import { getSrecDocumentSymbols, getSrecHover, srecLanguage, validateSrec } from "@modelscript/srec";
import { getStlDocumentSymbols, getStlHover, stlLanguage, validateStl } from "@modelscript/stl";
import { getTrasysDocumentSymbols, getTrasysHover, trasysLanguage, validateTrasys } from "@modelscript/trasys";
import { getTrnsysDocumentSymbols, getTrnsysHover, trnsysLanguage, validateTrnsys } from "@modelscript/trnsys";
import { getUsgsDemDocumentSymbols, getUsgsDemHover, usgsDemLanguage, validateUsgsDem } from "@modelscript/usgs-dem";
import { getVerilogDocumentSymbols, getVerilogHover, validateVerilog, verilogLanguage } from "@modelscript/verilog";
import { getVhdlDocumentSymbols, getVhdlHover, validateVhdl, vhdlLanguage } from "@modelscript/vhdl";
import type { WorkspaceManager } from "../services/workspace-manager.js";
import type { LanguageDefLike } from "./LanguageRegistry.js";
import { registerStandardPlugin } from "./standard-plugin.js";

export interface HeritagePluginSpec {
  id: string;
  name: string;
  extensions: string[];
  languageDef: unknown;
  symbols?: (text: string) => unknown;
  hoverPos?: (text: string, pos: { line: number; character: number }) => unknown;
  hoverOffset?: (text: string, offset: number) => unknown;
  validate?: (text: string) => unknown;
  actionHandlers?: Record<
    string,
    (ctx: { documentText?: string }, params?: Record<string, unknown>) => Promise<unknown>
  >;
}

/**
 * Registers all 63 heritage 1960s–1980s Beta engineering language and data-format plugins with the LSP server.
 */
export function registerHeritageLanguagePlugins(
  register: (spec: HeritagePluginSpec) => void = registerStandardPlugin,
  workspaceManager?: WorkspaceManager,
): void {
  const plugins: HeritagePluginSpec[] = [
    {
      id: "acsl",
      name: "ACSL",
      extensions: [".csl", ".acsl"],
      languageDef: acslLanguage,
      symbols: getAcslDocumentSymbols,
      hoverPos: getAcslHover,
      validate: validateAcsl,
    },
    {
      id: "csmp",
      name: "CSMP",
      extensions: [".csmp", ".cssl"],
      languageDef: csmpLanguage,
      symbols: getCsmpDocumentSymbols,
      hoverPos: getCsmpHover,
      validate: validateCsmp,
    },
    {
      id: "dynamo",
      name: "DYNAMO",
      extensions: [".dyn", ".dy"],
      languageDef: dynamoLanguage,
      symbols: getDynamoDocumentSymbols,
      hoverPos: getDynamoHover,
      validate: validateDynamo,
    },
    {
      id: "esl",
      name: "ESL",
      extensions: [".esl"],
      languageDef: eslLanguage,
      symbols: getEslDocumentSymbols,
      hoverPos: getEslHover,
      validate: validateEsl,
    },
    {
      id: "gpss",
      name: "GPSS",
      extensions: [".gps", ".gpss"],
      languageDef: gpssLanguage,
      symbols: getGpssDocumentSymbols,
      hoverPos: getGpssHover,
      validate: validateGpss,
    },
    {
      id: "simscript",
      name: "SIMSCRIPT",
      extensions: [".sim", ".simscript"],
      languageDef: simscriptLanguage,
      symbols: getSimscriptDocumentSymbols,
      hoverPos: getSimscriptHover,
      validate: validateSimscript,
    },
    {
      id: "slam",
      name: "SLAM II",
      extensions: [".slam", ".slm"],
      languageDef: slamLanguage,
      symbols: getSlamDocumentSymbols,
      hoverPos: getSlamHover,
      validate: validateSlam,
    },
    {
      id: "vhdl",
      name: "VHDL",
      extensions: [".vhd", ".vhdl"],
      languageDef: vhdlLanguage,
      symbols: getVhdlDocumentSymbols,
      hoverPos: getVhdlHover,
      validate: validateVhdl,
    },
    {
      id: "verilog",
      name: "Verilog",
      extensions: [".v", ".vh"],
      languageDef: verilogLanguage,
      symbols: getVerilogDocumentSymbols,
      hoverPos: getVerilogHover,
      validate: validateVerilog,
    },
    {
      id: "lustre",
      name: "Lustre",
      extensions: [".lus", ".ec"],
      languageDef: lustreLanguage,
      symbols: getLustreDocumentSymbols,
      hoverPos: getLustreHover,
      validate: validateLustre,
    },
    {
      id: "esterel",
      name: "Esterel",
      extensions: [".strl"],
      languageDef: esterelLanguage,
      symbols: getEsterelDocumentSymbols,
      hoverPos: getEsterelHover,
      validate: validateEsterel,
    },
    {
      id: "sdl",
      name: "SDL-88",
      extensions: [".sdl", ".pr"],
      languageDef: sdlLanguage,
      symbols: getSdlDocumentSymbols,
      hoverPos: getSdlHover,
      validate: validateSdl,
    },
    {
      id: "edif",
      name: "EDIF",
      extensions: [".edf", ".edif", ".edn"],
      languageDef: edifLanguage,
      symbols: getEdifDocumentSymbols,
      hoverPos: getEdifHover,
      validate: validateEdif,
    },
    {
      id: "gdsii",
      name: "GDSII",
      extensions: [".gds", ".gdsii", ".gdt"],
      languageDef: gdsiiLanguage,
      symbols: getGdsiiDocumentSymbols,
      hoverPos: getGdsiiHover,
      validate: validateGdsii,
    },
    {
      id: "cif",
      name: "CIF",
      extensions: [".cif"],
      languageDef: cifLanguage,
      symbols: getCifDocumentSymbols,
      hoverPos: getCifHover,
      validate: validateCif,
    },
    {
      id: "gerber",
      name: "Gerber",
      extensions: [".gbr", ".ger", ".gtl", ".gbl"],
      languageDef: gerberLanguage,
      symbols: getGerberDocumentSymbols,
      hoverPos: getGerberHover,
      validate: validateGerber,
    },
    {
      id: "mcnp",
      name: "MCNP",
      extensions: [".mcnp", ".i"],
      languageDef: mcnpLanguage,
      symbols: getMcnpDocumentSymbols,
      hoverPos: getMcnpHover,
      validate: validateMcnp,
    },
    {
      id: "melcor",
      name: "MELCOR",
      extensions: [".mel", ".melcor"],
      languageDef: melcorLanguage,
      symbols: getMelcorDocumentSymbols,
      hoverPos: getMelcorHover,
      validate: validateMelcor,
    },
    {
      id: "scale",
      name: "SCALE",
      extensions: [".scale"],
      languageDef: scaleLanguage,
      symbols: getScaleDocumentSymbols,
      hoverPos: getScaleHover,
      validate: validateScale,
    },
    {
      id: "sinda",
      name: "SINDA",
      extensions: [".sin", ".sinda"],
      languageDef: sindaLanguage,
      symbols: getSindaDocumentSymbols,
      hoverPos: getSindaHover,
      validate: validateSinda,
    },
    {
      id: "trasys",
      name: "TRASYS",
      extensions: [".tra", ".trasys"],
      languageDef: trasysLanguage,
      symbols: getTrasysDocumentSymbols,
      hoverPos: getTrasysHover,
      validate: validateTrasys,
    },
    {
      id: "nec2",
      name: "NEC-2",
      extensions: [".nec"],
      languageDef: nec2Language,
      symbols: getNec2DocumentSymbols,
      hoverPos: getNec2Hover,
      validate: validateNec2,
    },
    {
      id: "datcom",
      name: "DATCOM",
      extensions: [".dcm", ".datcom"],
      languageDef: datcomLanguage,
      symbols: getDatcomDocumentSymbols,
      hoverPos: getDatcomHover,
      validate: validateDatcom,
    },
    {
      id: "cea",
      name: "NASA CEA",
      extensions: [".cea"],
      languageDef: ceaLanguage,
      symbols: getCeaDocumentSymbols,
      hoverPos: getCeaHover,
      validate: validateCea,
    },
    {
      id: "gams",
      name: "GAMS",
      extensions: [".gms"],
      languageDef: gamsLanguage,
      symbols: getGamsDocumentSymbols,
      hoverPos: getGamsHover,
      validate: validateGams,
      actionHandlers: {
        gams_solve: async (ctx, params) => {
          const text = (params?.["documentText"] as string | undefined) ?? ctx.documentText;
          if (!text) return null;
          const opts = (params?.["options"] as { maxIterations?: number; maxNodes?: number } | undefined) ?? {};
          const t0 = Date.now();
          const res = solveGams(text, opts);
          return {
            status: res.status,
            objectiveValue: res.objectiveValue,
            iterations: res.iterations,
            nodesExplored: res.nodesExplored,
            solveTimeMs: Date.now() - t0,
            variables: res.variableValues,
            duals: res.duals,
            solverUsed: `gams-${res.solverType}`,
          };
        },
      },
    },
    {
      id: "mps",
      name: "IBM MPS",
      extensions: [".mps", ".qps"],
      languageDef: mpsLanguage,
      symbols: getMpsDocumentSymbols,
      hoverPos: getMpsHover,
      validate: validateMps,
    },
    {
      id: "cplex-lp",
      name: "CPLEX LP",
      extensions: [".lp", ".ltx"],
      languageDef: cplexLpLanguage,
      symbols: getCplexLpDocumentSymbols,
      hoverPos: getCplexLpHover,
      validate: validateCplexLp,
      actionHandlers: {
        cplex_lp_solve: async (ctx, params) => {
          const text = (params?.["documentText"] as string | undefined) ?? ctx.documentText;
          if (!text) return null;
          const opts = (params?.["options"] as { maxIterations?: number; maxNodes?: number } | undefined) ?? {};
          const t0 = Date.now();
          const parsed = parseCplexLp(text);
          const res = solveCplexLp(parsed, opts);
          return {
            status: res.status,
            objectiveValue: res.objectiveValue,
            iterations: res.iterations,
            nodesExplored: res.nodesExplored,
            gap: res.gap,
            solveTimeMs: Date.now() - t0,
            variables: res.values,
            solverUsed: "cplex-lp-pure-js",
          };
        },
      },
    },
    {
      id: "iges",
      name: "IGES",
      extensions: [".igs", ".iges"],
      languageDef: igesLanguage,
      symbols: getIgesDocumentSymbols,
      hoverPos: getIgesHover,
      validate: validateIges,
    },
    {
      id: "dxf",
      name: "DXF",
      extensions: [".dxf"],
      languageDef: dxfLanguage,
      symbols: getDxfDocumentSymbols,
      hoverPos: getDxfHover,
      validate: validateDxf,
    },
    {
      id: "gcode",
      name: "G-code",
      extensions: [".gcode", ".nc", ".ngc", ".tap"],
      languageDef: gcodeLanguage,
      symbols: getGCodeDocumentSymbols,
      hoverPos: getGCodeHover,
      validate: validateGCode,
    },
    {
      id: "apt",
      name: "APT",
      extensions: [".apt", ".aptsource", ".cls"],
      languageDef: aptLanguage,
      symbols: getAptDocumentSymbols,
      hoverPos: getAptHover,
      validate: validateApt,
    },
    {
      id: "lsdyna",
      name: "LS-DYNA",
      extensions: [".k", ".key"],
      languageDef: lsdynaLanguage,
      symbols: getLsDynaDocumentSymbols,
      hoverPos: getLsDynaHover,
      validate: validateLsDyna,
    },
    {
      id: "apdl",
      name: "ANSYS APDL",
      extensions: [".apdl", ".mac", ".ans"],
      languageDef: apdlLanguage,
      symbols: getApdlDocumentSymbols,
      hoverPos: getApdlHover,
      validate: validateApdl,
    },
    {
      id: "plot3d",
      name: "PLOT3D",
      extensions: [".xyz", ".p3d", ".q"],
      languageDef: plot3dLanguage,
      symbols: getPlot3dDocumentSymbols,
      hoverPos: getPlot3dHover,
      validate: validatePlot3d,
    },
    {
      id: "trnsys",
      name: "TRNSYS",
      extensions: [".dck", ".trd"],
      languageDef: trnsysLanguage,
      symbols: getTrnsysDocumentSymbols,
      hoverPos: getTrnsysHover,
      validate: validateTrnsys,
    },
    {
      id: "doe2",
      name: "DOE-2 BDL",
      extensions: [".bdl"],
      languageDef: doe2Language,
      symbols: getDoe2DocumentSymbols,
      hoverOffset: getDoe2Hover,
      validate: validateDoe2,
    },
    {
      id: "chemkin",
      name: "CHEMKIN",
      extensions: [".ck", ".therm"],
      languageDef: chemkinLanguage,
      symbols: getChemkinDocumentSymbols,
      hoverPos: getChemkinHover,
      validate: validateChemkin,
    },
    {
      id: "molfile",
      name: "MDL Molfile",
      extensions: [".mol", ".sdf"],
      languageDef: molfileLanguage,
      symbols: getMolfileDocumentSymbols,
      hoverPos: getMolfileHover,
      validate: validateMolfile,
    },
    {
      id: "gaussian",
      name: "Gaussian",
      extensions: [".gjf", ".com"],
      languageDef: gaussianLanguage,
      symbols: getGaussianDocumentSymbols,
      hoverPos: getGaussianHover,
      validate: validateGaussian,
    },
    {
      id: "ieee-cdf",
      name: "IEEE CDF",
      extensions: [".cdf", ".ipf"],
      languageDef: ieeeCdfLanguage,
      symbols: getIeeeCdfDocumentSymbols,
      hoverPos: getIeeeCdfHover,
      validate: validateIeeeCdf,
    },
    {
      id: "hec1",
      name: "HEC-1",
      extensions: [".hc1", ".hec1"],
      languageDef: hec1Language,
      symbols: getHec1DocumentSymbols,
      hoverPos: getHec1Hover,
      validate: validateHec1,
    },
    {
      id: "hec2",
      name: "HEC-2",
      extensions: [".hc2", ".hec2"],
      languageDef: hec2Language,
      symbols: getHec2DocumentSymbols,
      hoverPos: getHec2Hover,
      validate: getHec2Diagnostics,
    },
    {
      id: "segy",
      name: "SEG-Y",
      extensions: [".sgy", ".segy"],
      languageDef: segyLanguage,
      symbols: getSegyDocumentSymbols,
      hoverPos: getSegyHover,
      validate: validateSegy,
    },
    {
      id: "fits",
      name: "FITS",
      extensions: [".fits", ".fit", ".fts"],
      languageDef: fitsLanguage,
      symbols: getFitsDocumentSymbols,
      hoverPos: getFitsHover,
      validate: validateFits,
    },
    {
      id: "netcdf",
      name: "NetCDF",
      extensions: [".cdl", ".nc"],
      languageDef: netcdfLanguage,
      symbols: getNetcdfDocumentSymbols,
      hoverPos: getNetcdfHover,
      validate: validateNetcdf,
    },
    {
      id: "nasa-cdf",
      name: "NASA CDF",
      extensions: [".skt"],
      languageDef: nasaCdfLanguage,
      symbols: getNasaCdfDocumentSymbols,
      hoverPos: getNasaCdfHover,
      validate: validateNasaCdf,
    },
    {
      id: "grib",
      name: "WMO GRIB",
      extensions: [".grb", ".grib", ".grib1"],
      languageDef: gribLanguage,
      symbols: getGribDocumentSymbols,
      hoverPos: getGribHover,
      validate: validateGrib,
    },
    {
      id: "bufr",
      name: "WMO BUFR",
      extensions: [".bufr", ".bfr"],
      languageDef: bufrLanguage,
      symbols: getBufrDocumentSymbols,
      hoverPos: (t, p) => getBufrHover(t, p.line, p.character),
      validate: validateBufr,
    },
    {
      id: "usgs-dem",
      name: "USGS DEM",
      extensions: [".dem"],
      languageDef: usgsDemLanguage,
      symbols: getUsgsDemDocumentSymbols,
      hoverPos: getUsgsDemHover,
      validate: validateUsgsDem,
    },
    {
      id: "hdf4",
      name: "NCSA HDF4",
      extensions: [".hdf", ".h4", ".hdf4", ".eos"],
      languageDef: hdf4Language,
      symbols: getHdf4DocumentSymbols,
      hoverPos: getHdf4Hover,
      validate: validateHdf4,
    },
    {
      id: "arinc429",
      name: "ARINC 429",
      extensions: [".a429", ".arinc429"],
      languageDef: arinc429Language,
      symbols: getArinc429DocumentSymbols,
      hoverPos: getArinc429Hover,
      validate: validateArinc429,
    },
    {
      id: "nmea0183",
      name: "NMEA 0183",
      extensions: [".nmea", ".nma"],
      languageDef: nmea0183Language,
      symbols: getNmea0183DocumentSymbols,
      hoverPos: getNmea0183Hover,
      validate: validateNmea0183,
    },
    {
      id: "rinex",
      name: "RINEX v2",
      extensions: [".obs", ".nav", ".rnx"],
      languageDef: rinexLanguage,
      symbols: getRinexDocumentSymbols,
      hoverPos: getRinexHover,
      validate: validateRinex,
    },
    {
      id: "irig106",
      name: "IRIG 106",
      extensions: [".tmats", ".tmt", ".irig106"],
      languageDef: irig106Language,
      symbols: getIrig106DocumentSymbols,
      hoverPos: (t, p) => getIrig106Hover(t, p.line, p.character),
      validate: validateIrig106,
    },
    {
      id: "endf6",
      name: "ENDF-6",
      extensions: [".endf", ".endf6", ".pendf"],
      languageDef: endf6Language,
      symbols: getEndf6DocumentSymbols,
      hoverPos: getEndf6Hover,
      validate: validateEndf6,
    },
    {
      id: "jcamp-dx",
      name: "JCAMP-DX",
      extensions: [".jdx", ".dx", ".jcm"],
      languageDef: jcampDxLanguage,
      symbols: getJcampDxDocumentSymbols,
      hoverPos: getJcampDxHover,
      validate: validateJcampDx,
    },
    {
      id: "iucr-cif",
      name: "IUCr CIF",
      extensions: [".mcif", ".icif", ".star"],
      languageDef: iucrCifLanguage,
      symbols: getIucrCifDocumentSymbols,
      hoverPos: getIucrCifHover,
      validate: validateIucrCif,
    },
    {
      id: "stl",
      name: "STL",
      extensions: [".stl"],
      languageDef: stlLanguage,
      symbols: getStlDocumentSymbols,
      hoverPos: getStlHover,
      validate: validateStl,
    },
    {
      id: "obj",
      name: "Wavefront OBJ",
      extensions: [".obj", ".mtl"],
      languageDef: objLanguage,
      symbols: getObjDocumentSymbols,
      hoverPos: getObjHover,
      validate: validateObj,
    },
    {
      id: "ihex",
      name: "Intel HEX",
      extensions: [".hex", ".ihx", ".ihex"],
      languageDef: ihexLanguage,
      symbols: getIhexDocumentSymbols,
      hoverPos: getIhexHover,
      validate: validateIhex,
    },
    {
      id: "srec",
      name: "Motorola SREC",
      extensions: [".srec", ".s19", ".s28", ".s37"],
      languageDef: srecLanguage,
      symbols: getSrecDocumentSymbols,
      hoverPos: getSrecHover,
      validate: validateSrec,
    },
    {
      id: "jedec",
      name: "JEDEC JESD3",
      extensions: [".jed", ".jedec"],
      languageDef: jedecLanguage,
      symbols: getJedecDocumentSymbols,
      hoverPos: getJedecHover,
      validate: validateJedec,
    },
    {
      id: "asn1",
      name: "ASN.1",
      extensions: [".asn", ".asn1"],
      languageDef: asn1Language,
      symbols: getAsn1DocumentSymbols,
      hoverPos: getAsn1Hover,
      validate: validateAsn1,
    },
  ];

  const registerLanguageDef =
    workspaceManager?.unifiedWorkspace && typeof workspaceManager.unifiedWorkspace.registerLanguageDef === "function"
      ? workspaceManager.unifiedWorkspace.registerLanguageDef.bind(workspaceManager.unifiedWorkspace)
      : undefined;

  for (const plugin of plugins) {
    register(plugin);
    if (registerLanguageDef && plugin.languageDef) {
      registerLanguageDef(plugin.id, plugin.languageDef as LanguageDefLike);
    }
  }
}
