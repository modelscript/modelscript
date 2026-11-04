<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { LANGUAGE_COUNT, TIER_COUNTS, isModelScriptLangVisible } from "../data/languages";
import lintRules from "../data/lint-rules.generated.json";
import NavMegaMenu, { type MegaMenuColumn, type MegaMenuFeature, type MegaMenuFooterLink } from "./NavMegaMenu.vue";

const props = defineProps<{ screenMenu?: boolean }>();

const totalRules = lintRules.totalRules.toLocaleString();

const systemsItems = [
  ...(isModelScriptLangVisible
    ? [
        {
          name: "ModelScript (.msx)",
          tagline: "Native systems modeling, cross-domain bindings & queries · Stable",
          href: "/languages/modelscript",
          icon: "sparkles",
          accent: "#22d3ee",
        },
      ]
    : []),
  {
    name: "Modelica (.mo)",
    tagline: "Acausal multi-domain physical systems & MSL 4.x · Stable",
    href: "/languages/modelica",
    icon: "activity",
    accent: "#818cf8",
  },
  {
    name: "SysML v2, ReqIF & OSCAL",
    tagline: "Systems architecture, KerML, requirements & NIST OSCAL security",
    href: "/languages/sysml2",
    icon: "workflow",
    accent: "#38bdf8",
  },
  {
    name: "Simulink & SSP / FMI",
    tagline: "Block diagrams, state machines & FMU system packaging",
    href: "/languages/simulink",
    icon: "box",
    accent: "#34d399",
  },
  {
    name: "Life Sciences & Medical CAS",
    tagline: "SBML, SBOL3, CellML, DICOM-RT, TOPAS, NIfTI & OpenIGTLink",
    href: "/reference/radiology-and-surgery",
    icon: "dna",
    accent: "#10b981",
  },
];

const columns: MegaMenuColumn[] = [
  {
    id: "systems-physics",
    label: "Systems, Physics & Bio/Med",
    items: systemsItems,
  },
  {
    id: "geometry-cae",
    label: "Geometry, Multibody & Process",
    items: [
      {
        name: "STEP CAD, QIF & OpenSCAD",
        tagline: "ISO 10303 AP242 B-Rep, ISO 23952 QIF metrology & CSG",
        href: "/languages/step",
        icon: "cube",
        accent: "#2dd4bf",
      },
      {
        name: "CFD & FEA Continuum",
        tagline: "SU2 / OpenFOAM fluid meshes & CalculiX / Abaqus / FEBio",
        href: "/languages/cfd",
        icon: "layers",
        accent: "#fbbf24",
      },
      {
        name: "Robotics & Multibody",
        tagline: "URDF, AutomationML, SIMPACK, MSC Adams, OpenSim & GENSYS",
        href: "/languages/urdf",
        icon: "bot",
        accent: "#a78bfa",
      },
      {
        name: "Process, Chemistry & Flow",
        tagline: "OLGA, Aspen, gPROMS, Cantera, PHREEQC, SMILES & RELAP5",
        href: "/languages/olga",
        icon: "flame",
        accent: "#fb7185",
      },
    ],
  },
  {
    id: "grid-electronics",
    label: "Grid, Electronics & Code",
    items: [
      {
        name: "Power Systems & EMT",
        tagline: "PSCAD EMT, Siemens PSS/E & OpenDSS distribution grids",
        href: "/languages/pscad",
        icon: "zap",
        accent: "#facc15",
      },
      {
        name: "Electronics & RF",
        tagline: "SPICE netlists, Verilog-A compact models, IBIS & Touchstone",
        href: "/languages/spice",
        icon: "cpu",
        accent: "#818cf8",
      },
      {
        name: "Embedded & Controls",
        tagline: "AUTOSAR ARXML, PLCopen IEC 61131-3, ANSI C & Fortran",
        href: "/languages/autosar",
        icon: "code",
        accent: "#22d3ee",
      },
      {
        name: "Ontologies & Data",
        tagline: "OWL2 description logic, LPS, CSV trajectories & OpenDRIVE",
        href: "/languages/owl2",
        icon: "database",
        accent: "#34d399",
      },
    ],
  },
];

const feature: MegaMenuFeature = {
  eyebrow: `Polyglot Compiler Matrix (${TIER_COUNTS.stable} Stable · ${TIER_COUNTS.beta} Beta · ${TIER_COUNTS.preview} Preview)`,
  title: `${LANGUAGE_COUNT} formats, one shared DAE & SMT core`,
  body: `Every format compiles into the same zero-allocation WebAssembly CST and DAE arena with ${totalRules} static lint rules.`,
  code: "msx verify BrakingController brake.mo --format sarif",
  ctaLabel: `Browse all ${LANGUAGE_COUNT} languages`,
  ctaHref: "/languages/overview",
};

const footerLinks: MegaMenuFooterLink[] = [
  { label: `All ${LANGUAGE_COUNT} languages & capability matrix`, href: "/languages/overview", icon: "grid" },
  { label: "Radiology, Oncology & Surgical CAS", href: "/reference/radiology-and-surgery", icon: "activity" },
  { label: "Standards & Export Formats (FMI 3.0, STEP, SARIF)", href: "/reference/export-formats", icon: "upload" },
  { label: `${totalRules} Compiler Linter Rules`, href: "/reference/linter-rules", icon: "check" },
];
</script>

<template>
  <NavMegaMenu
    menu-id="languages"
    label="Languages"
    :active-prefixes="['/languages/']"
    :columns="columns"
    :feature="feature"
    :footer-links="footerLinks"
    :mobile-all-link="{ label: `All ${LANGUAGE_COUNT} languages & formats →`, href: '/languages/overview' }"
    :screen-menu="props.screenMenu"
  />
</template>
