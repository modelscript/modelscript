// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/plcopen — PLCopen TC6 XML v2.01 / v2.02 Schema Parser.
 *
 * Ingests PLCopen XML projects using @modelscript/dsl/xml, extracting data types,
 * POUs (program, functionBlock, function), interfaces, variable tables with addresses,
 * configurations, resources, tasks, and Structured Text bodies.
 */

import { parseXml, type XmlElement } from "@modelscript/dsl/xml";
import type {
  PlcBody,
  PlcConfiguration,
  PlcContentHeader,
  PlcDataType,
  PlcFileHeader,
  PlcPou,
  PlcPouInstance,
  PlcPouType,
  PlcProject,
  PlcRange,
  PlcResource,
  PlcStructMember,
  PlcTask,
  PlcVariable,
  PlcVariableScope,
} from "../types.js";
import { parseStructuredTextStatements } from "./st-parser.js";

function getAttr(elem: XmlElement, name: string): string | undefined {
  const attr = elem.attributes.find((a) => a.name.toLowerCase() === name.toLowerCase());
  return attr?.value;
}

function findChild(elem: XmlElement, name: string): XmlElement | undefined {
  return elem.children.find((c) => c.name.toLowerCase() === name.toLowerCase());
}

function findChildren(elem: XmlElement, name: string): XmlElement[] {
  return elem.children.filter((c) => c.name.toLowerCase() === name.toLowerCase());
}

function computeLineCol(source: string, offset: number): { line: number; col: number } {
  let line = 1;
  let col = 1;
  const target = Math.min(offset, source.length);
  for (let i = 0; i < target; i++) {
    if (source[i] === "\n") {
      line++;
      col = 1;
    } else {
      col++;
    }
  }
  return { line, col };
}

function makeElemRange(source: string, elem: XmlElement): PlcRange {
  const start = computeLineCol(source, elem.start);
  const end = computeLineCol(source, elem.end);
  return {
    startLine: start.line,
    startColumn: start.col,
    endLine: end.line,
    endColumn: end.col,
    startOffset: elem.start,
    endOffset: elem.end,
  };
}

export function parsePlcopenXml(source: string, filename?: string): PlcProject {
  const doc = parseXml(source);
  const root = doc.root;

  if (!root || root.name.toLowerCase() !== "project") {
    // If not standard project tag, search for pous directly
    const pousElem = root?.children.find((c) => c.name.toLowerCase() === "pous");
    if (!pousElem) {
      return {
        dataTypes: [],
        pous: [],
        configurations: [],
        sourceFile: filename,
      };
    }
  }

  // 1. File & Content Headers
  let fileHeader: PlcFileHeader | undefined = undefined;
  const fileHeaderElem = root ? findChild(root, "fileHeader") : undefined;
  if (fileHeaderElem) {
    fileHeader = {
      companyName: getAttr(fileHeaderElem, "companyName"),
      productName: getAttr(fileHeaderElem, "productName"),
      productVersion: getAttr(fileHeaderElem, "productVersion"),
      creationDateTime: getAttr(fileHeaderElem, "creationDateTime"),
    };
  }

  let contentHeader: PlcContentHeader | undefined = undefined;
  const contentHeaderElem = root ? findChild(root, "contentHeader") : undefined;
  if (contentHeaderElem) {
    contentHeader = {
      name: getAttr(contentHeaderElem, "name") ?? "PLC_Project",
      version: getAttr(contentHeaderElem, "version"),
      modificationDateTime: getAttr(contentHeaderElem, "modificationDateTime"),
      organization: getAttr(contentHeaderElem, "organization"),
      author: getAttr(contentHeaderElem, "author"),
    };
  }

  // 2. Types: Data Types & POUs
  const typesElem = root ? findChild(root, "types") : undefined;
  const dataTypes: PlcDataType[] = [];
  const pous: PlcPou[] = [];

  if (typesElem) {
    // Data Types
    const dtContainer = findChild(typesElem, "dataTypes");
    if (dtContainer) {
      for (const dtElem of findChildren(dtContainer, "dataType")) {
        const dtName = getAttr(dtElem, "name") ?? "UnknownType";
        const baseTypeElem = findChild(dtElem, "baseType");
        let baseType: string | undefined = undefined;
        let enumValues: string[] | undefined = undefined;
        let structMembers: PlcStructMember[] | undefined = undefined;

        if (baseTypeElem) {
          const enumElem = findChild(baseTypeElem, "enum");
          const structElem = findChild(baseTypeElem, "struct");
          if (enumElem) {
            const valuesElem = findChild(enumElem, "values");
            if (valuesElem) {
              enumValues = findChildren(valuesElem, "value").map((v) => getAttr(v, "name") ?? v.text.trim());
            }
          } else if (structElem) {
            structMembers = findChildren(structElem, "variable").map((v) => {
              const memName = getAttr(v, "name") ?? "";
              const typeSub = findChild(v, "type");
              const typeName = typeSub?.children[0]?.name ?? "DINT";
              return { name: memName, dataType: typeName };
            });
          } else if (baseTypeElem.children.length > 0) {
            baseType = baseTypeElem.children[0]?.name;
          }
        }

        dataTypes.push({
          name: dtName,
          kind: enumValues ? "enum" : structMembers ? "struct" : "simple",
          baseType,
          enumValues,
          structMembers,
          range: makeElemRange(source, dtElem),
        });
      }
    }

    // POUs
    const pousContainer = findChild(typesElem, "pous");
    if (pousContainer) {
      for (const pouElem of findChildren(pousContainer, "pou")) {
        const parsedPou = parsePouElement(source, pouElem);
        if (parsedPou) pous.push(parsedPou);
      }
    }
  }

  // 3. Configurations, Resources, Tasks
  const configurations: PlcConfiguration[] = [];
  const instancesElem = root ? findChild(root, "instances") : undefined;
  if (instancesElem) {
    const configContainer = findChild(instancesElem, "configurations");
    if (configContainer) {
      for (const configElem of findChildren(configContainer, "configuration")) {
        const configName = getAttr(configElem, "name") ?? "Configuration";
        const resources: PlcResource[] = [];
        const globalVars: PlcVariable[] = [];

        // Global variables at configuration level
        const configGlobalVarsElem = findChild(configElem, "globalVars");
        if (configGlobalVarsElem) {
          globalVars.push(...parseVariableGroup(source, configGlobalVarsElem, "global"));
        }

        // Resources
        for (const resElem of findChildren(configElem, "resource")) {
          const resName = getAttr(resElem, "name") ?? "Resource";
          const tasks: PlcTask[] = [];
          const resGlobalVars: PlcVariable[] = [];
          const instances: PlcPouInstance[] = [];

          // Resource global vars
          const resGvElem = findChild(resElem, "globalVars");
          if (resGvElem) {
            resGlobalVars.push(...parseVariableGroup(source, resGvElem, "global"));
          }

          // Tasks
          for (const taskElem of findChildren(resElem, "task")) {
            const taskName = getAttr(taskElem, "name") ?? "Task";
            const priorityStr = getAttr(taskElem, "priority") ?? "1";
            const priority = parseInt(priorityStr, 10) || 1;
            const interval = getAttr(taskElem, "interval");
            let intervalMs: number | undefined = undefined;
            if (interval) {
              const msMatch = /T#(\d+)(ms|s|m|h)/i.exec(interval);
              if (msMatch) {
                const val = parseInt(msMatch[1] ?? "0", 10);
                const unit = (msMatch[2] ?? "ms").toLowerCase();
                if (unit === "ms") intervalMs = val;
                else if (unit === "s") intervalMs = val * 1000;
                else if (unit === "m") intervalMs = val * 60000;
                else if (unit === "h") intervalMs = val * 3600000;
              }
            }

            // POU Instances under task
            for (const piElem of findChildren(taskElem, "pouInstance")) {
              instances.push({
                name: getAttr(piElem, "name") ?? "",
                typeName: getAttr(piElem, "typeName") ?? "",
                taskName,
                range: makeElemRange(source, piElem),
              });
            }

            tasks.push({
              name: taskName,
              priority,
              interval,
              intervalMs,
              single: getAttr(taskElem, "single"),
              range: makeElemRange(source, taskElem),
            });
          }

          // Standalone POU Instances under resource
          for (const piElem of findChildren(resElem, "pouInstance")) {
            instances.push({
              name: getAttr(piElem, "name") ?? "",
              typeName: getAttr(piElem, "typeName") ?? "",
              range: makeElemRange(source, piElem),
            });
          }

          resources.push({
            name: resName,
            tasks,
            globalVars: resGlobalVars,
            instances,
            range: makeElemRange(source, resElem),
          });
        }

        configurations.push({
          name: configName,
          resources,
          globalVars,
          range: makeElemRange(source, configElem),
        });
      }
    }
  }

  return {
    fileHeader,
    contentHeader,
    dataTypes,
    pous,
    configurations,
    sourceFile: filename,
  };
}

function parsePouElement(source: string, pouElem: XmlElement): PlcPou {
  const name = getAttr(pouElem, "name") ?? "UnnamedPou";
  const typeAttr = getAttr(pouElem, "pouType")?.toLowerCase();
  const pouType: PlcPouType =
    typeAttr === "functionblock" ? "functionBlock" : typeAttr === "function" ? "function" : "program";

  let returnType: string | undefined = undefined;
  const variables: PlcVariable[] = [];

  // Parse Interface
  const ifaceElem = findChild(pouElem, "interface");
  if (ifaceElem) {
    const returnTypeElem = findChild(ifaceElem, "returnType");
    const firstChild = returnTypeElem?.children[0];
    if (firstChild) {
      returnType =
        firstChild.name.toLowerCase() === "derived" ? (getAttr(firstChild, "name") ?? "DERIVED") : firstChild.name;
    }

    // Input Variables
    for (const group of findChildren(ifaceElem, "inputVars")) {
      variables.push(...parseVariableGroup(source, group, "input"));
    }
    // Output Variables
    for (const group of findChildren(ifaceElem, "outputVars")) {
      variables.push(...parseVariableGroup(source, group, "output"));
    }
    // InOut Variables
    for (const group of findChildren(ifaceElem, "inOutVars")) {
      variables.push(...parseVariableGroup(source, group, "inOut"));
    }
    // Local Variables
    for (const group of findChildren(ifaceElem, "localVars")) {
      variables.push(...parseVariableGroup(source, group, "local"));
    }
    // Temp Variables
    for (const group of findChildren(ifaceElem, "tempVars")) {
      variables.push(...parseVariableGroup(source, group, "temp"));
    }
  }

  // Parse Body
  const bodyElem = findChild(pouElem, "body");
  let body: PlcBody = { kind: "ST", st: { statements: [] } };

  if (bodyElem) {
    const stElem = findChild(bodyElem, "ST");
    if (stElem) {
      let stCode = "";
      if (stElem.cdata.length > 0) {
        stCode = stElem.cdata.map((c) => c.text).join("\n");
      } else if (stElem.text.trim().length > 0) {
        stCode = stElem.text;
      } else {
        // Collect text from all children (e.g. <xhtml> or <xhtml:p>)
        stCode = collectElementText(stElem);
      }
      body = {
        kind: "ST",
        st: parseStructuredTextStatements(stCode),
        raw: stCode,
      };
    } else {
      const fbdElem = findChild(bodyElem, "FBD");
      const sfcElem = findChild(bodyElem, "SFC");
      const ldElem = findChild(bodyElem, "LD");
      if (fbdElem) body = { kind: "FBD", raw: collectElementText(fbdElem) };
      else if (sfcElem) body = { kind: "SFC", raw: collectElementText(sfcElem) };
      else if (ldElem) body = { kind: "LD", raw: collectElementText(ldElem) };
    }
  }

  return {
    name,
    pouType,
    returnType,
    variables,
    body,
    range: makeElemRange(source, pouElem),
  };
}

function parseVariableGroup(source: string, groupElem: XmlElement, scope: PlcVariableScope): PlcVariable[] {
  const isConstant = getAttr(groupElem, "constant") === "true";
  const isRetain = getAttr(groupElem, "retain") === "true";
  const vars: PlcVariable[] = [];

  for (const varElem of findChildren(groupElem, "variable")) {
    const name = getAttr(varElem, "name") ?? "unnamed";
    const address = getAttr(varElem, "address");

    // Extract Type
    let dataType = "BOOL";
    const typeElem = findChild(varElem, "type");
    const typeChild = typeElem?.children[0];
    if (typeChild) {
      if (typeChild.name.toLowerCase() === "derived") {
        dataType = getAttr(typeChild, "name") ?? "DERIVED";
      } else if (typeChild.name.toLowerCase() === "string") {
        dataType = "STRING";
      } else {
        dataType = typeChild.name.toUpperCase();
      }
    }

    // Extract Initial Value
    let initialValue: string | number | boolean | undefined = undefined;
    const initElem = findChild(varElem, "initialValue");
    if (initElem) {
      const simpleElem = findChild(initElem, "simpleValue");
      if (simpleElem) {
        const valAttr = getAttr(simpleElem, "value");
        if (valAttr !== undefined) {
          if (valAttr.toLowerCase() === "true") initialValue = true;
          else if (valAttr.toLowerCase() === "false") initialValue = false;
          else if (!isNaN(Number(valAttr))) initialValue = Number(valAttr);
          else initialValue = valAttr;
        }
      }
    }

    vars.push({
      name,
      scope,
      dataType,
      initialValue,
      address,
      isConstant,
      isRetain,
      range: makeElemRange(source, varElem),
    });
  }

  return vars;
}

function collectElementText(elem: XmlElement): string {
  let text = elem.text ?? "";
  for (const c of elem.children) {
    text += "\n" + collectElementText(c);
  }
  return text.trim();
}
