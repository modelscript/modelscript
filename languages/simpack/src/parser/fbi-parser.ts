// SPDX-License-Identifier: AGPL-3.0-or-later

export interface FbiModeShapeEntry {
  nodeId: number | string;
  phi: {
    x: number;
    y: number;
    z: number;
    rx?: number | undefined;
    ry?: number | undefined;
    rz?: number | undefined;
  };
}

export interface FbiModalCoordinate {
  modeIndex: number;
  frequencyHz: number;
  generalizedMass: number;
  generalizedStiffness: number;
  dampingRatio?: number | undefined;
  shapes?: FbiModeShapeEntry[] | undefined;
}

export interface FbiNode {
  id: number | string;
  position: { x: number; y: number; z: number };
}

export interface FbiModel {
  name: string;
  numNodes: number;
  numModes: number;
  nodes?: FbiNode[] | undefined;
  modes: FbiModalCoordinate[];
}

/**
 * Parses SIMPACK Flexible Body Interface files (.fbi).
 * Extracts modal degrees of freedom, natural frequencies, generalized mass/stiffness,
 * and boundary node eigenvector shapes.
 */
export function parseFbiFile(content: string, defaultName: string = "FlexBody"): FbiModel {
  const lines = content.split(/\r?\n/);
  const modes: FbiModalCoordinate[] = [];
  const nodes: FbiNode[] = [];
  let numNodes = 0;
  let numModes = 0;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith("$") || line.startsWith("!")) {
      continue;
    }

    const tokens = line.split(/\s+/);
    const cmd = tokens[0]?.toUpperCase();

    if (cmd === "HEADER" && tokens.length >= 3) {
      numNodes = parseInt(tokens[1] ?? "0", 10);
      numModes = parseInt(tokens[2] ?? "0", 10);
    } else if (cmd === "NODE" && tokens.length >= 5) {
      const id = tokens[1]!;
      const x = parseFloat(tokens[2] ?? "0");
      const y = parseFloat(tokens[3] ?? "0");
      const z = parseFloat(tokens[4] ?? "0");
      nodes.push({ id, position: { x, y, z } });
    } else if (cmd === "MODE" && tokens.length >= 5) {
      const modeIndex = parseInt(tokens[1] ?? "0", 10);
      const frequencyHz = parseFloat(tokens[2] ?? "0");
      const generalizedMass = parseFloat(tokens[3] ?? "1.0");
      const generalizedStiffness = parseFloat(tokens[4] ?? "0");
      const dampingRatio = tokens[5] ? parseFloat(tokens[5]) : 0.02;

      modes.push({
        modeIndex,
        frequencyHz,
        generalizedMass,
        generalizedStiffness:
          generalizedStiffness > 0 ? generalizedStiffness : Math.pow(2 * Math.PI * frequencyHz, 2) * generalizedMass,
        dampingRatio,
        shapes: [],
      });
    } else if (cmd === "SHAPE" && tokens.length >= 5) {
      const modeIdx = parseInt(tokens[1] ?? "0", 10);
      const nodeId = tokens[2]!;
      const phiX = parseFloat(tokens[3] ?? "0");
      const phiY = parseFloat(tokens[4] ?? "0");
      const phiZ = parseFloat(tokens[5] ?? "0");
      const phiRx = tokens[6] ? parseFloat(tokens[6]) : undefined;
      const phiRy = tokens[7] ? parseFloat(tokens[7]) : undefined;
      const phiRz = tokens[8] ? parseFloat(tokens[8]) : undefined;

      const targetMode = modes.find((m) => m.modeIndex === modeIdx);
      if (targetMode) {
        if (!targetMode.shapes) targetMode.shapes = [];
        targetMode.shapes.push({
          nodeId,
          phi: { x: phiX, y: phiY, z: phiZ, rx: phiRx, ry: phiRy, rz: phiRz },
        });
      }
    }
  }

  return {
    name: defaultName,
    numNodes: numNodes > 0 ? numNodes : nodes.length,
    numModes: numModes > 0 ? numModes : modes.length,
    nodes: nodes.length > 0 ? nodes : undefined,
    modes,
  };
}
