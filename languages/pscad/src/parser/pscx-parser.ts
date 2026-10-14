// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Fast PSCAD .pscx / .psmx XML Parser.
 *
 * Parses PSCAD project files into typed PscxProject structures,
 * preserving schematic coordinates, component definitions, parameters,
 * and electrical connectivity.
 */

import type { Point2D, PscxModule, PscxPort, PscxProject, PscxProjectSettings } from "../types.js";

/**
 * Parses point string e.g. "[150, 240]" or "150, 240".
 */
function parsePoint(val?: string | null): Point2D {
  if (!val) return { x: 0, y: 0 };
  const cleaned = val.replace(/[[\]()]/g, "").trim();
  const parts = cleaned.split(/[\s,]+/).map(Number);
  return {
    x: isNaN(parts[0]) ? 0 : parts[0],
    y: isNaN(parts[1]) ? 0 : parts[1],
  };
}

/**
 * Parses a PSCAD .pscx XML string.
 */
export function parsePscx(xmlContent: string): PscxProject {
  const settings: PscxProjectSettings = {
    timeStepUs: 50.0,
    durationSec: 1.0,
    startType: "flat",
    frequencyHz: 60.0,
  };

  let projectName = "Untitled";
  let version = "5.0";
  const linkedLibraries: string[] = [];

  // Match root project tag
  const projectMatch = /<project\s+([^>]*?)>/i.exec(xmlContent);
  if (projectMatch) {
    const attrText = projectMatch[1];
    const nameMatch = /name\s*=\s*["']([^"']+)["']/i.exec(attrText);
    if (nameMatch) projectName = nameMatch[1];
    const verMatch = /version\s*=\s*["']([^"']+)["']/i.exec(attrText);
    if (verMatch) version = verMatch[1];
  }

  // Parse project settings parameters
  const paramRegex = /<param\s+([^>]*?)(?:\/>|>(.*?)<\/param>)/gi;
  let pMatch: RegExpExecArray | null;
  while ((pMatch = paramRegex.exec(xmlContent)) !== null) {
    const attrs = pMatch[1];
    const nameAttr = /name\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1];
    const valAttr = /value\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1] ?? pMatch[2]?.trim();

    if (!nameAttr || valAttr === undefined) continue;

    const lowerName = nameAttr.toLowerCase();
    if (lowerName === "time_step" || lowerName === "timestep") {
      const parsed = parseFloat(valAttr);
      if (!isNaN(parsed) && parsed > 0) settings.timeStepUs = parsed;
    } else if (lowerName === "time_duration" || lowerName === "duration") {
      const parsed = parseFloat(valAttr);
      if (!isNaN(parsed) && parsed > 0) settings.durationSec = parsed;
    } else if (lowerName === "f_base" || lowerName === "frequency" || lowerName === "freq") {
      const parsed = parseFloat(valAttr);
      if (!isNaN(parsed) && parsed > 0) settings.frequencyHz = parsed;
    } else if (lowerName === "start_type") {
      settings.startType = valAttr === "1" ? "snapshot" : "flat";
    }
  }

  // Parse main module schematic
  const rootModule: PscxModule = {
    id: "Main",
    name: "Main",
    components: [],
    buses: [],
    wires: [],
  };

  const subModules = new Map<string, PscxModule>();

  // Extract User / Component elements
  const cmpRegex = /<(?:User|Component)\s+([^>]*?)>([\s\S]*?)<\/(?:User|Component)>/gi;
  let cMatch: RegExpExecArray | null;
  let autoIdCounter = 1;

  while ((cMatch = cmpRegex.exec(xmlContent)) !== null) {
    const attrs = cMatch[1];
    const inner = cMatch[2];

    const defn =
      /defn\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1] || /type\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1] || "Component";

    const id = /\bid\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1] || String(autoIdCounter++);
    const posX = parseFloat(/x\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1] || "0");
    const posY = parseFloat(/y\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1] || "0");
    const orient = parseInt(/orient\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1] || "0", 10);

    const params: Record<string, string | number> = {};
    const ports: PscxPort[] = [];

    // Parse inner parameters
    let innerParamMatch: RegExpExecArray | null;
    const innerParamRegex = /<param\s+([^>]*?)(?:\/>|>(.*?)<\/param>)/gi;
    while ((innerParamMatch = innerParamRegex.exec(inner)) !== null) {
      const pAttrs = innerParamMatch[1];
      const pName = /name\s*=\s*["']([^"']+)["']/i.exec(pAttrs)?.[1];
      const pVal = /value\s*=\s*["']([^"']+)["']/i.exec(pAttrs)?.[1] ?? innerParamMatch[2]?.trim();
      if (pName && pVal !== undefined) {
        const numVal = parseFloat(pVal);
        params[pName] = isNaN(numVal) ? pVal : numVal;
      }
    }

    // Parse inner ports
    let portMatch: RegExpExecArray | null;
    const portRegex = /<port\s+([^>]*?)(?:\/>|>(.*?)<\/port>)/gi;
    while ((portMatch = portRegex.exec(inner)) !== null) {
      const portAttrs = portMatch[1];
      const portName = /name\s*=\s*["']([^"']+)["']/i.exec(portAttrs)?.[1] || "p";
      const posVal = /pos\s*=\s*["']([^"']+)["']/i.exec(portAttrs)?.[1];
      const kindVal = (/kind\s*=\s*["']([^"']+)["']/i.exec(portAttrs)?.[1] as any) || "electrical";
      const dimVal = parseInt(/dim\s*=\s*["']([^"']+)["']/i.exec(portAttrs)?.[1] || "3", 10);

      ports.push({
        id: `${id}_${portName}`,
        name: portName,
        kind: kindVal,
        dimension: dimVal,
        position: parsePoint(posVal),
      });
    }

    // Infer instance name if present in params
    const instanceName = (params["Name"] || params["name"] || `${defn}_${id}`) as string;

    rootModule.components.push({
      id,
      definitionName: defn,
      instanceName,
      position: { x: posX, y: posY },
      rotation: orient,
      parameters: params,
      ports,
    });
  }

  // Extract Buses
  const busRegex = /<Bus\s+([^>]*?)(?:\/>|>(.*?)<\/Bus>)/gi;
  let bMatch: RegExpExecArray | null;
  while ((bMatch = busRegex.exec(xmlContent)) !== null) {
    const attrs = bMatch[1];
    const busName = /name\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1] || `Bus_${autoIdCounter++}`;
    const busId = /\bid\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1] || busName;
    const posX = parseFloat(/x\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1] || "0");
    const posY = parseFloat(/y\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1] || "0");
    const vbase = parseFloat(
      /vbase\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1] || /v_base\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1] || "0",
    );
    const length = parseFloat(/length\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1] || "50");

    rootModule.buses.push({
      id: busId,
      name: busName,
      voltageBaseKv: vbase > 0 ? vbase : undefined,
      position: { x: posX, y: posY },
      length,
      phaseCount: 3,
    });
  }

  // Extract Wires
  const wireRegex = /<Wire\s*([^>]*?)>([\s\S]*?)<\/Wire>/gi;
  let wMatch: RegExpExecArray | null;
  let wireId = 1;
  while ((wMatch = wireRegex.exec(xmlContent)) !== null) {
    const inner = wMatch[2];
    const vertices: Point2D[] = [];

    const vertexRegex = /<vertex\s+([^>]*?)\/>/gi;
    let vMatch: RegExpExecArray | null;
    while ((vMatch = vertexRegex.exec(inner)) !== null) {
      const vAttrs = vMatch[1];
      const vx = parseFloat(/x\s*=\s*["']([^"']+)["']/i.exec(vAttrs)?.[1] || "0");
      const vy = parseFloat(/y\s*=\s*["']([^"']+)["']/i.exec(vAttrs)?.[1] || "0");
      vertices.push({ x: vx, y: vy });
    }

    if (vertices.length >= 2) {
      rootModule.wires.push({
        id: `wire_${wireId++}`,
        vertices,
        connectedPortIds: [],
      });
    }
  }

  // Resolve spatial wire connectivity: snap wire endpoints to ports and buses
  snapWireConnections(rootModule);

  return {
    name: projectName,
    version,
    settings,
    rootModule,
    subModules,
    linkedLibraries,
  };
}

/**
 * Snaps wire endpoints to nearby component ports and buses within SNAP_TOLERANCE.
 */
const SNAP_TOLERANCE = 15.0; // 15 pixels/units snap radius

function distance(p1: Point2D, p2: Point2D): number {
  const dx = p1.x - p2.x;
  const dy = p1.y - p2.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function snapWireConnections(mod: PscxModule): void {
  for (const wire of mod.wires) {
    if (wire.vertices.length < 2) continue;
    const start = wire.vertices[0];
    const end = wire.vertices[wire.vertices.length - 1];

    for (const cmp of mod.components) {
      for (const port of cmp.ports) {
        // Calculate port world coordinates (component pos + port offset)
        const portWorld: Point2D = {
          x: cmp.position.x + port.position.x,
          y: cmp.position.y + port.position.y,
        };

        if (distance(start, portWorld) <= SNAP_TOLERANCE || distance(end, portWorld) <= SNAP_TOLERANCE) {
          wire.connectedPortIds.push(port.id);
        }
      }
    }

    for (const bus of mod.buses) {
      const busStart = bus.position;
      const busEnd: Point2D = { x: bus.position.x + (bus.length ?? 50), y: bus.position.y };

      // Check distance to bus line segment
      if (
        distance(start, busStart) <= SNAP_TOLERANCE ||
        distance(start, busEnd) <= SNAP_TOLERANCE ||
        distance(end, busStart) <= SNAP_TOLERANCE ||
        distance(end, busEnd) <= SNAP_TOLERANCE
      ) {
        wire.connectedPortIds.push(bus.id);
      }
    }
  }
}
