// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  CpuIcon,
  FileCodeIcon,
  FlameIcon,
  GearIcon,
  PackageIcon,
  PulseIcon,
  SlidersIcon,
  StackIcon,
  WorkflowIcon,
} from "@primer/octicons-react";
import React from "react";

export interface PostData {
  id: string;
  [key: string]: unknown;
}

export interface TopicData {
  id?: string | undefined;
  name: string;
  tag?: string | undefined;
  concept?: string | undefined;
  display_name?: string | undefined;
  postsCount?: number | undefined;
  [key: string]: unknown;
}

export interface PackageData {
  name: string;
  version?: string | undefined;
  description?: string | undefined;
  [key: string]: unknown;
}

export interface RepoData {
  id?: string | undefined;
  provider?: string | undefined;
  namespace: string;
  project: string;
  description?: string | undefined;
  avatar_url?: string | undefined;
  [key: string]: unknown;
}

export interface PersonData {
  id?: string | undefined;
  username?: string | undefined;
  name?: string | undefined;
  avatar?: string | undefined;
  [key: string]: unknown;
}

export interface StarterTemplate {
  id: string;
  title: string;
  category: "CAD" | "Simulation" | "MBSE" | "AI" | "Optimization" | "Polyglot";
  description: string;
  badge: string;
  icon: string;
}

export const CURATED_ENGINEERING_DOMAINS = [
  { tag: "Aerodynamics", name: "Aerodynamics", icon: PulseIcon, desc: "NACA airfoils, compressible flow & CFD" },
  {
    tag: "Thermodynamics",
    name: "Thermodynamics",
    icon: FlameIcon,
    desc: "Heat transfer, cooling cycles & thermal grids",
  },
  { tag: "Robotics", name: "Robotics", icon: CpuIcon, desc: "Kinematics, inverse dynamics & bipedal control" },
  { tag: "AdditiveMfg", name: "AdditiveMfg", icon: GearIcon, desc: "Toolpaths, slicing & 5-axis CNC G-Code" },
  { tag: "DigitalTwin", name: "DigitalTwin", icon: StackIcon, desc: "AAS Asset Administration Shells & telemetry" },
  {
    tag: "ControlSystems",
    name: "ControlSystems",
    icon: SlidersIcon,
    desc: "State-space, PID & closed-loop stability",
  },
  {
    tag: "Multibody",
    name: "Multibody",
    icon: WorkflowIcon,
    desc: "Rigid body mechanics, joints & articulated assemblies",
  },
  { tag: "CAD", name: "CAD 3D", icon: PackageIcon, desc: "STEP, OpenCASCADE & procedural CSG geometry" },
];

export const STARTER_TEMPLATES: StarterTemplate[] = [
  {
    id: "drone-chassis",
    title: "Drone Chassis Thread",
    category: "Polyglot",
    badge: "CAD + FEA + CFD",
    description:
      "Quadcopter assembly linking procedural Modelica CAD geometry to aerodynamic simulation and STEP export.",
    icon: "🛸",
  },
  {
    id: "sysml2",
    title: "SysML v2 Vehicle Architecture",
    category: "MBSE",
    badge: "SysML v2",
    description: "Complete vehicle architecture model showcasing KerML parts, ports, state machines, and requirements.",
    icon: "🚗",
  },
  {
    id: "bouncing-ball",
    title: "Bouncing Ball Dynamics",
    category: "Simulation",
    badge: "WASM Solvers",
    description:
      "Classic hybrid continuous/discrete physical modeling with state events, restitution, and zero-crossing detection.",
    icon: "⚽",
  },
  {
    id: "rlc",
    title: "Analogue RLC Circuit",
    category: "Simulation",
    badge: "Analogue EE",
    description:
      "Second-order electrical resonant circuit with frequency response plotting and interactive parameter tuning.",
    icon: "⚡",
  },
  {
    id: "injection-molding-cosim",
    title: "Injection Molding Co-Simulation",
    category: "Polyglot",
    badge: "FMI Co-Sim",
    description:
      "Thermal-hydraulic coupling simulating polymer mold cavity fill, temperature decay, and cooling cycle dynamics.",
    icon: "🏭",
  },
  {
    id: "surrogate",
    title: "AI Surrogate ROMs",
    category: "AI",
    badge: "Neural ROM",
    description: "WebAssembly-accelerated neural surrogate model for ultra-fast reduced-order dynamic simulation.",
    icon: "🧠",
  },
  {
    id: "assembly-to-multibody",
    title: "STEP CAD to Multi-Body",
    category: "CAD",
    badge: "OpenCascade STEP",
    description: "Automatic conversion from 3D STEP mechanical assemblies to articulated multibody dynamic equations.",
    icon: "📐",
  },
  {
    id: "calibration",
    title: "Parameter Calibration & Fitting",
    category: "Optimization",
    badge: "Optimization",
    description:
      "Non-linear least squares parameter estimation fitting dynamic Modelica models against measured time-series data.",
    icon: "🎯",
  },
];

export const SEARCH_TABS = ["Top", "Latest", "Templates", "People", "Media", "Artifacts", "Repositories"] as const;

export type SearchTab = (typeof SEARCH_TABS)[number];

export const TOPIC_ARTIFACT_TABS: {
  id: string;
  label: string;
  icon?: React.ComponentType<{ size?: number | undefined; style?: React.CSSProperties | undefined }> | undefined;
}[] = [
  { id: "all", label: "All Posts" },
  { id: "cad", label: "CAD 3D", icon: PackageIcon },
  { id: "simulation", label: "FEA / CFD", icon: FlameIcon },
  { id: "plot", label: "Plots & Data", icon: PulseIcon },
  { id: "modelica", label: "Modelica Code", icon: FileCodeIcon },
];

export const BASE_RELATED_TAGS = [
  "Aerodynamics",
  "Thermodynamics",
  "Robotics",
  "AdditiveMfg",
  "DigitalTwin",
  "ControlSystems",
  "Multibody",
  "FluidDynamics",
  "CAD",
  "Modelica",
];

export const CURATED_REPOS: RepoData[] = [];
