// SPDX-License-Identifier: AGPL-3.0-or-later

import { parseXml, type XmlDocument, type XmlElement } from "@modelscript/dsl/xml";
import type {
  AutosarCanFrame,
  AutosarConnector,
  AutosarDataElement,
  AutosarInternalBehavior,
  AutosarModel,
  AutosarPackage,
  AutosarPdu,
  AutosarPortInterface,
  AutosarPortPrototype,
  AutosarPortRef,
  AutosarRteEvent,
  AutosarRunnableEntity,
  AutosarSignal,
  AutosarSwComponent,
  AutosarSwcPrototype,
  SourceRange,
  SwComponentKind,
} from "../types.js";

function computeLineStarts(source: string): number[] {
  const starts: number[] = [0];
  for (let i = 0; i < source.length; i++) {
    if (source.charCodeAt(i) === 10) {
      starts.push(i + 1);
    }
  }
  return starts;
}

function offsetToPosition(offset: number, lineStarts: number[]): { line: number; column: number } {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (lineStarts[mid]! <= offset) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  const lineIdx = low - 1;
  const lineStart = lineStarts[lineIdx] ?? 0;
  return { line: lineIdx + 1, column: offset - lineStart + 1 };
}

function elementRange(elem: XmlElement, lineStarts: number[]): SourceRange {
  const start = offsetToPosition(elem.start, lineStarts);
  const end = offsetToPosition(elem.end, lineStarts);
  return {
    startLine: start.line,
    startColumn: start.column,
    endLine: end.line,
    endColumn: end.column,
  };
}

function getChildText(elem: XmlElement, tagName: string): string | undefined {
  const child = elem.children.find((c) => c.name === tagName);
  return child?.text.trim();
}

function findChildren(elem: XmlElement, tagName: string): XmlElement[] {
  return elem.children.filter((c) => c.name === tagName);
}

function findFirstDescendant(elem: XmlElement, tagName: string): XmlElement | undefined {
  for (const child of elem.children) {
    if (child.name === tagName) return child;
    const desc = findFirstDescendant(child, tagName);
    if (desc) return desc;
  }
  return undefined;
}

function parseShortName(elem: XmlElement): string {
  return getChildText(elem, "SHORT-NAME") || "unnamed";
}

function parseDataElements(container: XmlElement, lineStarts: number[]): AutosarDataElement[] {
  const results: AutosarDataElement[] = [];
  const elems = findChildren(container, "VARIABLE-DATA-PROTOTYPE");
  for (const el of elems) {
    const shortName = parseShortName(el);
    const typeRef = getChildText(el, "TYPE-TREF") || "";
    const initValStr = getChildText(el, "INIT-VALUE") ?? getChildText(el, "VALUE");
    const num = initValStr !== undefined ? Number(initValStr) : undefined;
    results.push({
      shortName,
      typeRef,
      initValue: num !== undefined && !Number.isNaN(num) ? num : initValStr,
      range: elementRange(el, lineStarts),
    });
  }
  return results;
}

function parsePortInterface(elem: XmlElement, lineStarts: number[]): AutosarPortInterface {
  const shortName = parseShortName(elem);
  const kind = elem.name as AutosarPortInterface["kind"];
  let dataElements: AutosarDataElement[] | undefined;

  const dataContainer = elem.children.find((c) => c.name === "DATA-ELEMENTS");
  if (dataContainer) {
    dataElements = parseDataElements(dataContainer, lineStarts);
  }

  return {
    shortName,
    kind,
    dataElements,
    range: elementRange(elem, lineStarts),
  };
}

function parsePorts(container: XmlElement, lineStarts: number[]): Map<string, AutosarPortPrototype> {
  const ports = new Map<string, AutosarPortPrototype>();

  for (const child of container.children) {
    if (child.name === "P-PORT-PROTOTYPE" || child.name === "R-PORT-PROTOTYPE" || child.name === "PR-PORT-PROTOTYPE") {
      const shortName = parseShortName(child);
      const direction =
        child.name === "P-PORT-PROTOTYPE"
          ? "provided"
          : child.name === "R-PORT-PROTOTYPE"
            ? "required"
            : "provided-required";
      const ifRef =
        getChildText(child, "PROVIDED-INTERFACE-TREF") ??
        getChildText(child, "REQUIRED-INTERFACE-TREF") ??
        getChildText(child, "PROVIDED-REQUIRED-INTERFACE-TREF") ??
        "";

      ports.set(shortName, {
        shortName,
        direction,
        interfaceRef: ifRef,
        range: elementRange(child, lineStarts),
      });
    }
  }

  return ports;
}

function parseInternalBehavior(elem: XmlElement, lineStarts: number[]): AutosarInternalBehavior {
  const shortName = parseShortName(elem);
  const runnables = new Map<string, AutosarRunnableEntity>();
  const events: AutosarRteEvent[] = [];

  const runnablesContainer = elem.children.find((c) => c.name === "RUNNABLES");
  if (runnablesContainer) {
    for (const rElem of findChildren(runnablesContainer, "RUNNABLE-ENTITY")) {
      const rName = parseShortName(rElem);
      const symbol = getChildText(rElem, "SYMBOL");
      const wcetStr = getChildText(rElem, "MINIMUM-START-INTERVAL") ?? getChildText(rElem, "EXECUTION-TIME-WCET");
      const wcet = wcetStr ? Number(wcetStr) : undefined;
      const concStr = getChildText(rElem, "CAN-BE-INVOKED-CONCURRENTLY");
      const canBeInvokedConcurrently = concStr === "true";

      const dataReadAccess: { port: string; dataElement: string }[] = [];
      const draContainer = rElem.children.find((c) => c.name === "DATA-READ-ACCESSS");
      if (draContainer) {
        for (const va of findChildren(draContainer, "VARIABLE-ACCESS")) {
          const portRef = getChildText(va, "PORT-PROTOTYPE-REF") ?? "";
          const targetRef = getChildText(va, "TARGET-DATA-PROTOTYPE-REF") ?? "";
          const portName = portRef.split("/").pop() ?? portRef;
          const dataElemName = targetRef.split("/").pop() ?? targetRef;
          dataReadAccess.push({ port: portName, dataElement: dataElemName });
        }
      }

      const dataWriteAccess: { port: string; dataElement: string }[] = [];
      const dwaContainer = rElem.children.find((c) => c.name === "DATA-WRITE-ACCESSS");
      if (dwaContainer) {
        for (const va of findChildren(dwaContainer, "VARIABLE-ACCESS")) {
          const portRef = getChildText(va, "PORT-PROTOTYPE-REF") ?? "";
          const targetRef = getChildText(va, "TARGET-DATA-PROTOTYPE-REF") ?? "";
          const portName = portRef.split("/").pop() ?? portRef;
          const dataElemName = targetRef.split("/").pop() ?? targetRef;
          dataWriteAccess.push({ port: portName, dataElement: dataElemName });
        }
      }

      runnables.set(rName, {
        shortName: rName,
        symbol,
        executionTimeWcet: wcet !== undefined && !Number.isNaN(wcet) ? wcet : undefined,
        canBeInvokedConcurrently,
        dataReadAccess,
        dataWriteAccess,
        range: elementRange(rElem, lineStarts),
      });
    }
  }

  const eventsContainer = elem.children.find((c) => c.name === "EVENTS");
  if (eventsContainer) {
    for (const evElem of eventsContainer.children) {
      const evName = parseShortName(evElem);
      const startRef = getChildText(evElem, "START-ON-EVENT-REF") ?? "";
      const runnableName = startRef.split("/").pop() ?? startRef;

      if (evElem.name === "TIMING-EVENT") {
        const periodStr = getChildText(evElem, "PERIOD");
        const period = periodStr ? Number(periodStr) : undefined;
        events.push({
          shortName: evName,
          kind: "TIMING-EVENT",
          startOnEventRef: runnableName,
          period: period !== undefined && !Number.isNaN(period) ? period : undefined,
          range: elementRange(evElem, lineStarts),
        });
      } else if (evElem.name === "DATA-RECEIVED-EVENT") {
        const drPoint = evElem.children.find(
          (c) => c.name === "DATA-IREF" || c.name === "DATA-RECEIVE-POINT-BY-ARGUMENTS",
        );
        let access: { port: string; dataElement: string } | undefined;
        if (drPoint) {
          const portRef = getChildText(drPoint, "PORT-PROTOTYPE-REF") ?? "";
          const targetRef = getChildText(drPoint, "TARGET-DATA-PROTOTYPE-REF") ?? "";
          access = {
            port: portRef.split("/").pop() ?? portRef,
            dataElement: targetRef.split("/").pop() ?? targetRef,
          };
        }
        events.push({
          shortName: evName,
          kind: "DATA-RECEIVED-EVENT",
          startOnEventRef: runnableName,
          dataReceivePointRef: access,
          range: elementRange(evElem, lineStarts),
        });
      } else if (evElem.name === "INIT-EVENT") {
        events.push({
          shortName: evName,
          kind: "INIT-EVENT",
          startOnEventRef: runnableName,
          range: elementRange(evElem, lineStarts),
        });
      } else if (evElem.name === "OPERATION-INVOKED-EVENT") {
        const opRef = getChildText(evElem, "OPERATION-IREF") ?? "";
        events.push({
          shortName: evName,
          kind: "OPERATION-INVOKED-EVENT",
          startOnEventRef: runnableName,
          operationRef: opRef.split("/").pop() ?? opRef,
          range: elementRange(evElem, lineStarts),
        });
      }
    }
  }

  return {
    shortName,
    runnables,
    events,
    range: elementRange(elem, lineStarts),
  };
}

function parseSwComponent(elem: XmlElement, lineStarts: number[]): AutosarSwComponent {
  const shortName = parseShortName(elem);
  const kind = elem.name as SwComponentKind;
  let ports = new Map<string, AutosarPortPrototype>();
  let internalBehavior: AutosarInternalBehavior | undefined;
  let subComponents: Map<string, AutosarSwcPrototype> | undefined;
  let connectors: AutosarConnector[] | undefined;

  const portsContainer = elem.children.find((c) => c.name === "PORTS");
  if (portsContainer) {
    ports = parsePorts(portsContainer, lineStarts);
  }

  const ibContainer = elem.children.find((c) => c.name === "INTERNAL-BEHAVIORS");
  if (ibContainer) {
    const ibElem = ibContainer.children.find((c) => c.name === "SWC-INTERNAL-BEHAVIOR");
    if (ibElem) {
      internalBehavior = parseInternalBehavior(ibElem, lineStarts);
    }
  }

  const compsContainer = elem.children.find((c) => c.name === "COMPONENTS");
  if (compsContainer) {
    subComponents = new Map();
    for (const proto of findChildren(compsContainer, "SW-COMPONENT-PROTOTYPE")) {
      const pName = parseShortName(proto);
      const tref = getChildText(proto, "TYPE-TREF") || "";
      subComponents.set(pName, {
        shortName: pName,
        typeRef: tref,
        range: elementRange(proto, lineStarts),
      });
    }
  }

  const connsContainer = elem.children.find((c) => c.name === "CONNECTORS");
  if (connsContainer) {
    connectors = [];
    for (const conn of connsContainer.children) {
      if (conn.name === "ASSEMBLY-SW-CONNECTOR") {
        const cName = parseShortName(conn);
        let provider: AutosarPortRef | undefined;
        let requirer: AutosarPortRef | undefined;

        const pIref = conn.children.find((c) => c.name === "PROVIDER-IREF");
        if (pIref) {
          const compRef = getChildText(pIref, "CONTEXT-COMPONENT-REF") ?? "";
          const portRef = getChildText(pIref, "TARGET-P-PORT-REF") ?? "";
          provider = {
            component: compRef.split("/").pop() ?? compRef,
            port: portRef.split("/").pop() ?? portRef,
          };
        }

        const rIref = conn.children.find((c) => c.name === "REQUESTER-IREF");
        if (rIref) {
          const compRef = getChildText(rIref, "CONTEXT-COMPONENT-REF") ?? "";
          const portRef = getChildText(rIref, "TARGET-R-PORT-REF") ?? "";
          requirer = {
            component: compRef.split("/").pop() ?? compRef,
            port: portRef.split("/").pop() ?? portRef,
          };
        }

        connectors.push({
          shortName: cName,
          kind: "ASSEMBLY-SW-CONNECTOR",
          provider,
          requirer,
          range: elementRange(conn, lineStarts),
        });
      } else if (conn.name === "DELEGATION-SW-CONNECTOR") {
        const cName = parseShortName(conn);
        const outerPort = getChildText(conn, "OUTER-PORT-REF")?.split("/").pop();
        let innerPort: AutosarPortRef | undefined;
        const innerIref = conn.children.find((c) => c.name === "INNER-PORT-IREF");
        if (innerIref) {
          const compRef = getChildText(innerIref, "CONTEXT-COMPONENT-REF") ?? "";
          const portRef =
            getChildText(innerIref, "TARGET-P-PORT-REF") ?? getChildText(innerIref, "TARGET-R-PORT-REF") ?? "";
          innerPort = {
            component: compRef.split("/").pop() ?? compRef,
            port: portRef.split("/").pop() ?? portRef,
          };
        }

        connectors.push({
          shortName: cName,
          kind: "DELEGATION-SW-CONNECTOR",
          outerPort,
          innerPort,
          range: elementRange(conn, lineStarts),
        });
      }
    }
  }

  return {
    shortName,
    kind,
    ports,
    internalBehavior,
    subComponents,
    connectors,
    range: elementRange(elem, lineStarts),
  };
}

function parsePdu(elem: XmlElement, lineStarts: number[]): AutosarPdu {
  const shortName = parseShortName(elem);
  const lenStr = getChildText(elem, "LENGTH");
  const byteLength = lenStr ? Number(lenStr) : 8;
  const signals: AutosarSignal[] = [];

  const mappings =
    findFirstDescendant(elem, "I-SIGNAL-TO-PDU-MAPPINGS") ??
    elem.children.find((c) => c.name === "I-SIGNAL-TO-I-PDU-MAPPINGS");
  if (mappings) {
    for (const mapElem of mappings.children) {
      const sName = parseShortName(mapElem);
      const startBitStr = getChildText(mapElem, "START-POSITION") ?? "0";
      const startBit = Number(startBitStr);
      const sigRef = getChildText(mapElem, "I-SIGNAL-REF") ?? "";
      const lenStrSig = getChildText(mapElem, "LENGTH") ?? "8";
      const length = Number(lenStrSig);
      const byteOrderStr = getChildText(mapElem, "PACKING-BYTE-ORDER");
      const byteOrder =
        byteOrderStr === "LEAST-SIGNIFICANT-BYTE-FIRST"
          ? "LEAST-SIGNIFICANT-BYTE-FIRST"
          : "MOST-SIGNIFICANT-BYTE-FIRST";

      signals.push({
        shortName: sigRef.split("/").pop() || sName,
        startBit: !Number.isNaN(startBit) ? startBit : 0,
        length: !Number.isNaN(length) ? length : 8,
        byteOrder,
        range: elementRange(mapElem, lineStarts),
      });
    }
  }

  return {
    shortName,
    byteLength: !Number.isNaN(byteLength) ? byteLength : 8,
    signals,
    range: elementRange(elem, lineStarts),
  };
}

function parseCanFrame(elem: XmlElement, lineStarts: number[]): AutosarCanFrame {
  const shortName = parseShortName(elem);
  const idStr = getChildText(elem, "IDENTIFIER") ?? getChildText(elem, "FRAME-ID") ?? "0";
  const frameId = Number(idStr);
  const lenStr = getChildText(elem, "FRAME-LENGTH") ?? getChildText(elem, "LENGTH") ?? "8";
  const length = Number(lenStr);

  let pduRef: string | undefined;
  const pduMap = findFirstDescendant(elem, "PDU-TO-FRAME-MAPPING");
  if (pduMap) {
    pduRef = getChildText(pduMap, "PDU-REF")?.split("/").pop();
  }

  return {
    shortName,
    frameId: !Number.isNaN(frameId) ? frameId : 0,
    length: !Number.isNaN(length) ? length : 8,
    pduRef,
    range: elementRange(elem, lineStarts),
  };
}

function parseArPackage(elem: XmlElement, lineStarts: number[], model: AutosarModel): AutosarPackage {
  const shortName = parseShortName(elem);
  const elements = new Map<string, any>();
  const subPackages = new Map<string, AutosarPackage>();

  const elementsContainer = elem.children.find((c) => c.name === "ELEMENTS");
  if (elementsContainer) {
    for (const child of elementsContainer.children) {
      if (
        child.name === "APPLICATION-SW-COMPONENT-TYPE" ||
        child.name === "SENSOR-ACTUATOR-SW-COMPONENT-TYPE" ||
        child.name === "COMPLEX-DEVICE-DRIVER-SW-COMPONENT-TYPE" ||
        child.name === "COMPOSITION-SW-COMPONENT-TYPE" ||
        child.name === "SERVICE-SW-COMPONENT-TYPE" ||
        child.name === "ECU-ABSTRACTION-SW-COMPONENT-TYPE"
      ) {
        const swc = parseSwComponent(child, lineStarts);
        elements.set(swc.shortName, swc);
        model.components.set(swc.shortName, swc);
      } else if (
        child.name === "SENDER-RECEIVER-INTERFACE" ||
        child.name === "CLIENT-SERVER-INTERFACE" ||
        child.name === "TRIGGER-INTERFACE" ||
        child.name === "MODE-SWITCH-INTERFACE"
      ) {
        const iface = parsePortInterface(child, lineStarts);
        elements.set(iface.shortName, iface);
        model.interfaces.set(iface.shortName, iface);
      } else if (child.name === "I-SIGNAL-I-PDU" || child.name === "I-PDU") {
        const pdu = parsePdu(child, lineStarts);
        elements.set(pdu.shortName, pdu);
        model.pdus.set(pdu.shortName, pdu);
      } else if (child.name === "CAN-FRAME" || child.name === "FIBEX-FRAME") {
        const frame = parseCanFrame(child, lineStarts);
        elements.set(frame.shortName, frame);
        model.frames.set(frame.shortName, frame);
      }
    }
  }

  const subPkgsContainer = elem.children.find((c) => c.name === "AR-PACKAGES");
  if (subPkgsContainer) {
    for (const pElem of findChildren(subPkgsContainer, "AR-PACKAGE")) {
      const pkg = parseArPackage(pElem, lineStarts, model);
      subPackages.set(pkg.shortName, pkg);
    }
  }

  return {
    shortName,
    elements,
    subPackages,
    range: elementRange(elem, lineStarts),
  };
}

/**
 * Parses an AUTOSAR Classic or Adaptive ARXML document into a typed AutosarModel AST.
 * Completely zero-regex parsing with streaming XML character scanning.
 */
export function parseArxml(source: string): AutosarModel {
  const doc: XmlDocument = parseXml(source);
  const lineStarts = computeLineStarts(source);

  const model: AutosarModel = {
    packages: new Map(),
    components: new Map(),
    interfaces: new Map(),
    pdus: new Map(),
    frames: new Map(),
  };

  const root = doc.root;
  if (!root) return model;

  const topPkgsContainer = root.name === "AR-PACKAGES" ? root : root.children.find((c) => c.name === "AR-PACKAGES");
  if (topPkgsContainer) {
    for (const pElem of findChildren(topPkgsContainer, "AR-PACKAGE")) {
      const pkg = parseArPackage(pElem, lineStarts, model);
      model.packages.set(pkg.shortName, pkg);
    }
  }

  return model;
}
