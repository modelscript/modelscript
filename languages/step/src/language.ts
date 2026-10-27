// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  choice,
  def,
  field,
  language,
  optional,
  ref,
  repeat,
  repeat1,
  seq,
  tggComplement,
  tggEq,
  tggRule,
} from "@modelscript/dsl";

/**
 * Language definition for STEP ISO 10303-21 Clear Text Encoding of the Exchange Structure
 * (`.step`, `.stp`, `.p21`), providing the native GLR grammar, 3D CAD viewer & CAE discretization
 * actions (MultiBody, FEA `.inp`, CFD `.su2`), MCP tools, and polyglot TGG rules with SysML v2 and Modelica.
 */
export const stepLanguage = language({
  name: "step",
  maturity: "stable",

  // Bi-directional source writeback for updating quoted string parameters in STEP entity records
  writeback: (ctx) => {
    const { entry, fullText, newValue } = ctx;
    const startOffset = entry?.startOffset;
    const endOffset = entry?.endOffset;
    if (startOffset != null && endOffset != null && endOffset > startOffset) {
      const declText = fullText.substring(startOffset, endOffset);
      // E.g. #10 = PRODUCT('DroneBody', ...)
      const strMatch = declText.match(/'([^'\\]*(?:\\.[^'\\]*)*)'/);
      if (strMatch && strMatch.index !== undefined) {
        const valStartOffset = startOffset + strMatch.index + 1;
        const valEndOffset = valStartOffset + strMatch[1]!.length;
        const cleanVal = newValue.replace(/^'|'$/g, "");
        return { startOffset: valStartOffset, endOffset: valEndOffset, newText: cleanVal };
      }
    }
    return null;
  },

  // IDE and AI agent actions for 3D visualization, Modelica MultiBody synthesis, and FEA/CFD mesh generation
  actions: [
    {
      id: "open_cad_viewer",
      title: "Open 3D CAD Viewer",
      description: "Opens the interactive 3D WebGL assembly and solid geometry viewer.",
      category: "query",
      execute: async (ctx: any, params: { documentText?: string | undefined; uri?: string | undefined }) => {
        const targetUri = params?.uri || ctx.uri;
        let meshes = [...(ctx.workspaceManager?.stepWorkspaceIndex?.getMeshes(targetUri) || [])];
        return {
          success: true,
          uri: targetUri,
          meshCount: meshes.length,
          meshes: meshes.slice(0, 5),
        };
      },
      ui: {
        editorTitle: {
          icon: "$(package)",
          group: "navigation@0",
        },
        explorerContextMenu: {
          group: "modelscript_cae@0",
        },
        languageModelTool: {
          name: "step_open_cad_viewer",
          displayName: "Open 3D CAD Viewer",
          modelDescription: "Opens the interactive 3D WebGL assembly and solid geometry viewer.",
        },
      },
    },
    {
      id: "generate_multibody",
      title: "Translate CAD Assembly to Modelica MultiBody",
      description: "Extracts kinematic joints and mass properties to generate a Modelica MultiBody simulation model.",
      category: "transform",
      execute: async (ctx: any, params: { documentText?: string | undefined; uri?: string | undefined }) => {
        const targetUri = params?.uri || ctx.uri;
        const filename = targetUri ? targetUri.split("/").pop() || "assembly" : "assembly";
        const name = filename.replace(/\.[^/.]+$/, "").replace(/[^a-zA-Z0-9_]/g, "_");
        const stepText =
          params?.documentText ??
          ctx.documentText ??
          (targetUri ? ctx.documents?.get?.(targetUri)?.getText?.() : undefined) ??
          "";
        const { extractStepAssembly } = await import("./assembly-extractor.js");
        const assembly =
          (stepText ? extractStepAssembly(stepText) : undefined) ??
          ctx.workspaceManager?.stepWorkspaceIndex?.getAssemblyModel?.(targetUri);

        const bodyLines: string[] = ["  inner Modelica.Mechanics.MultiBody.World world;"];
        const eqLines: string[] = [];
        const partIdToSafeName = new Map<string, string>();
        const safeNames: string[] = [];

        if (assembly && (assembly.parts.size > 0 || assembly.joints.length > 0)) {
          const defaultMass = assembly.massProperties.values().next().value?.mass ?? 1.0;
          let idx = 0;
          for (const [, part] of assembly.parts) {
            const safeName = part.name.replace(/[^a-zA-Z0-9_]/g, "_") || `body_${idx + 1}`;
            partIdToSafeName.set(part.id, safeName);
            safeNames.push(safeName);
            const partProps = assembly.massProperties.get(part.id);
            const partMass =
              partProps?.mass ?? (idx === 0 ? defaultMass : Math.max(0.1, defaultMass / assembly.parts.size));
            const edge = assembly.edges.find((e: any) => e.childPartId === part.id) ?? assembly.edges[idx];
            const loc = edge?.placement?.location ?? partProps?.centerOfMass ?? [0, 0, 0];
            bodyLines.push(
              `  Parts.BodyBox ${safeName}(r = {${loc[0]}, ${loc[1]}, ${loc[2]}}, m = ${partMass.toFixed(4)}) "${part.name}";`,
            );
            idx++;
          }
          if (safeNames.length === 0) {
            const fallbackBody = `${name}_body`;
            safeNames.push(fallbackBody);
            bodyLines.push(`  Parts.BodyBox ${fallbackBody}(r = {0, 0, 0}, m = ${defaultMass.toFixed(4)}) "${name}";`);
          }

          const connectedChildren = new Set<string>();
          for (let jIdx = 0; jIdx < assembly.joints.length; jIdx++) {
            const j = assembly.joints[jIdx]!;
            const jName = `joint_${jIdx + 1}`;
            const jClass = j.type === "prismatic" ? "Prismatic" : j.type === "spherical" ? "Spherical" : "Revolute";
            bodyLines.push(
              `  Joints.${jClass} ${jName}(n = {${j.axis[0]}, ${j.axis[1]}, ${j.axis[2]}}) "${j.type} joint";`,
            );
            const nameA = partIdToSafeName.get(j.partA) ?? safeNames[0]!;
            const nameB = partIdToSafeName.get(j.partB) ?? safeNames[Math.min(1, safeNames.length - 1)]!;
            eqLines.push(`  connect(${nameA}.frame_b, ${jName}.frame_a);`);
            eqLines.push(`  connect(${jName}.frame_b, ${nameB}.frame_a);`);
            connectedChildren.add(nameB);
          }

          let offsetIdx = 1;
          for (const edge of assembly.edges) {
            const nameA = partIdToSafeName.get(edge.parentPartId);
            const nameB = partIdToSafeName.get(edge.childPartId);
            if (!nameA || !nameB || connectedChildren.has(nameB)) continue;
            const offName = `offset_${offsetIdx++}`;
            const loc = edge.placement?.location ?? [0, 0, 0];
            bodyLines.push(`  Parts.FixedTranslation ${offName}(r = {${loc[0]}, ${loc[1]}, ${loc[2]}});`);
            eqLines.push(`  connect(${nameA}.frame_b, ${offName}.frame_a);`);
            eqLines.push(`  connect(${offName}.frame_b, ${nameB}.frame_a);`);
            connectedChildren.add(nameB);
          }

          const roots = safeNames.filter((n) => !connectedChildren.has(n));
          const rootBody = roots[0] ?? safeNames[0]!;
          eqLines.unshift(`  connect(world.frame_b, ${rootBody}.frame_a);`);
        } else {
          // Extract solid brep / shell names and bounding box volume directly from STEP text
          const lengthScale = /SI_UNIT\s*\(\s*\.MILLI\.\s*,\s*\.METRE\.\s*\)/i.test(stepText) ? 1e-3 : 1.0;
          const brepRegex = /(?:MANIFOLD_SOLID_BREP|BREP_WITH_VOIDS|CLOSED_SHELL)\s*\(\s*'([^']*)'/gi;
          const solidNames: string[] = [];
          let bm: RegExpExecArray | null;
          while ((bm = brepRegex.exec(stepText)) !== null) {
            if (bm[1] && !solidNames.includes(bm[1])) solidNames.push(bm[1]);
          }
          const ptRegex =
            /CARTESIAN_POINT\s*\(\s*'[^']*'\s*,\s*\(\s*([-+\d.eE]+)\s*,\s*([-+\d.eE]+)\s*,\s*([-+\d.eE]+)\s*\)/gi;
          let minX = Infinity,
            minY = Infinity,
            minZ = Infinity;
          let maxX = -Infinity,
            maxY = -Infinity,
            maxZ = -Infinity;
          let ptCount = 0;
          let pm: RegExpExecArray | null;
          while ((pm = ptRegex.exec(stepText)) !== null) {
            const x = parseFloat(pm[1]!) * lengthScale,
              y = parseFloat(pm[2]!) * lengthScale,
              z = parseFloat(pm[3]!) * lengthScale;
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (z < minZ) minZ = z;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
            if (z > maxZ) maxZ = z;
            ptCount++;
          }
          const dx = ptCount >= 2 ? Math.max(maxX - minX, 0.01) : 0.1;
          const dy = ptCount >= 2 ? Math.max(maxY - minY, 0.01) : 0.1;
          const dz = ptCount >= 2 ? Math.max(maxZ - minZ, 0.01) : 0.1;
          const estMass = Math.max(0.01, Number((dx * dy * dz * 2700.0).toFixed(4)));
          if (solidNames.length > 0) {
            const perSolidMass = Math.max(0.01, estMass / solidNames.length);
            solidNames.forEach((sName, sIdx) => {
              const safe = sName.replace(/[^a-zA-Z0-9_]/g, "_") || `solid_${sIdx + 1}`;
              safeNames.push(safe);
              bodyLines.push(
                `  Parts.BodyBox ${safe}(r = {${dx.toFixed(4)}, 0, 0}, m = ${perSolidMass.toFixed(4)}) "${sName}";`,
              );
              if (sIdx === 0) {
                eqLines.push(`  connect(world.frame_b, ${safe}.frame_a);`);
              } else {
                eqLines.push(`  connect(${safeNames[sIdx - 1]!}.frame_b, ${safe}.frame_a);`);
              }
            });
          } else {
            const fallbackBody = `${name}_body`;
            bodyLines.push(
              `  Parts.BodyBox ${fallbackBody}(r = {${dx.toFixed(4)}, ${dy.toFixed(4)}, ${dz.toFixed(4)}}, m = ${estMass.toFixed(4)}) "${name}";`,
            );
            eqLines.push(`  connect(world.frame_b, ${fallbackBody}.frame_a);`);
          }
        }

        const moCode = `model ${name}_MultiBody "Modelica MultiBody assembly translated from STEP CAD"\n  import Modelica.Mechanics.MultiBody.Parts;\n  import Modelica.Mechanics.MultiBody.Joints;\n\n${bodyLines.join("\n")}\nequation\n${eqLines.join("\n")}\nend ${name}_MultiBody;\n`;
        return {
          success: true,
          uri: targetUri,
          name: `${name}_MultiBody`,
          source: moCode,
        };
      },
      ui: {
        editorTitle: {
          icon: "$(symbol-structure)",
          group: "navigation@2",
        },
        editorContextMenu: {
          group: "2_transform@1",
        },
        explorerContextMenu: {
          group: "modelscript_cae@1",
        },
        languageModelTool: {
          name: "step_to_multibody",
          displayName: "Translate STEP to Modelica MultiBody",
          modelDescription: "Translates STEP geometry entities into Modelica MultiBody kinematic frames.",
        },
      },
    },
    {
      id: "generate_fea_mesh",
      title: "Discretize CAD to FEA Mesh (.inp)",
      description: "Discretizes 3D CAD boundary surfaces and volumes into an FEA hexahedral/tetrahedral mesh deck.",
      category: "transform",
      execute: async (ctx: any, params: { documentText?: string | undefined; uri?: string | undefined }) => {
        const targetUri = params?.uri || ctx.uri;
        const filename = targetUri ? targetUri.split("/").pop() || "part" : "part";
        const baseName = filename.replace(/\.[^/.]+$/, "");
        const stepText =
          params?.documentText ??
          ctx.documentText ??
          (targetUri ? ctx.documents?.get?.(targetUri)?.getText?.() : undefined) ??
          "";
        const lengthScale = /SI_UNIT\s*\(\s*\.MILLI\.\s*,\s*\.METRE\.\s*\)/i.test(stepText) ? 1e-3 : 1.0;
        const ptRegex =
          /CARTESIAN_POINT\s*\(\s*'[^']*'\s*,\s*\(\s*([-+\d.eE]+)\s*,\s*([-+\d.eE]+)\s*,\s*([-+\d.eE]+)\s*\)/gi;
        let minX = Infinity,
          minY = Infinity,
          minZ = Infinity;
        let maxX = -Infinity,
          maxY = -Infinity,
          maxZ = -Infinity;
        let ptCount = 0;
        let m: RegExpExecArray | null;
        while ((m = ptRegex.exec(stepText)) !== null) {
          const x = parseFloat(m[1]!) * lengthScale,
            y = parseFloat(m[2]!) * lengthScale,
            z = parseFloat(m[3]!) * lengthScale;
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (z < minZ) minZ = z;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
          if (z > maxZ) maxZ = z;
          ptCount++;
        }
        if (ptCount < 2 || !(maxX > minX || maxY > minY || maxZ > minZ)) {
          minX = 0.0;
          maxX = 0.2;
          minY = -0.02;
          maxY = 0.02;
          minZ = 0.0;
          maxZ = 0.01;
        } else {
          if (maxX - minX < 1e-4) {
            minX -= 0.005;
            maxX += 0.005;
          }
          if (maxY - minY < 1e-4) {
            minY -= 0.005;
            maxY += 0.005;
          }
          if (maxZ - minZ < 1e-4) {
            minZ -= 0.005;
            maxZ += 0.005;
          }
        }

        // Generate a structured 3D C3D8 hexahedral grid over [minX..maxX] x [minY..maxY] x [minZ..maxZ]
        const nx = 3,
          ny = 2,
          nz = 2;
        const nodeLines: string[] = [];
        const rootNodes: number[] = [];
        const tipNodes: number[] = [];
        const nodeIdAt = (ix: number, iy: number, iz: number) => 1 + ix + iy * (nx + 1) + iz * (nx + 1) * (ny + 1);

        for (let iz = 0; iz <= nz; iz++) {
          const z = minZ + (iz / nz) * (maxZ - minZ);
          for (let iy = 0; iy <= ny; iy++) {
            const y = minY + (iy / ny) * (maxY - minY);
            for (let ix = 0; ix <= nx; ix++) {
              const x = minX + (ix / nx) * (maxX - minX);
              const nid = nodeIdAt(ix, iy, iz);
              nodeLines.push(`${nid}, ${x.toFixed(6)}, ${y.toFixed(6)}, ${z.toFixed(6)}`);
              if (ix === 0) rootNodes.push(nid);
              if (ix === nx) tipNodes.push(nid);
            }
          }
        }

        const elemLines: string[] = [];
        let elemId = 1;
        for (let iz = 0; iz < nz; iz++) {
          for (let iy = 0; iy < ny; iy++) {
            for (let ix = 0; ix < nx; ix++) {
              const n1 = nodeIdAt(ix, iy, iz);
              const n2 = nodeIdAt(ix + 1, iy, iz);
              const n3 = nodeIdAt(ix + 1, iy + 1, iz);
              const n4 = nodeIdAt(ix, iy + 1, iz);
              const n5 = nodeIdAt(ix, iy, iz + 1);
              const n6 = nodeIdAt(ix + 1, iy, iz + 1);
              const n7 = nodeIdAt(ix + 1, iy + 1, iz + 1);
              const n8 = nodeIdAt(ix, iy + 1, iz + 1);
              elemLines.push(`${elemId}, ${n1}, ${n2}, ${n3}, ${n4}, ${n5}, ${n6}, ${n7}, ${n8}`);
              elemId++;
            }
          }
        }

        const boundaryLines = rootNodes.map((nid) => `${nid}, 1, 3, 0.0`);
        const loadPerTipNode = Number((100.0 / Math.max(tipNodes.length, 1)).toFixed(4));
        const cloadLines = tipNodes.map((nid) => `${nid}, 3, ${loadPerTipNode}`);

        const inpText = `** CalculiX FEA Mesh Deck generated from CAD: ${filename}\n*HEADING\nDiscretized 3D Hexahedral Mesh for ${baseName}\n*NODE, NSET=NALL\n${nodeLines.join("\n")}\n*ELEMENT, TYPE=C3D8, ELSET=ESOLID\n${elemLines.join("\n")}\n*MATERIAL, NAME=STRUCTURAL_ALLOY\n*ELASTIC\n7.0e10, 0.33\n*DENSITY\n2700.0\n*PLASTIC\n250.0e6, 0.0\n*SOLID SECTION, ELSET=ESOLID, MATERIAL=STRUCTURAL_ALLOY\n*BOUNDARY\n${boundaryLines.join("\n")}\n*STEP\n*STATIC\n*CLOAD\n${cloadLines.join("\n")}\n*END STEP\n`;
        return {
          success: true,
          uri: targetUri,
          deckText: inpText,
          suggestedFilename: `${baseName}_mesh.inp`,
        };
      },
      ui: {
        editorContextMenu: {
          group: "2_transform@2",
        },
        explorerContextMenu: {
          group: "modelscript_cae@2",
        },
        languageModelTool: {
          name: "step_discretize_fea",
          displayName: "Discretize CAD to FEA Mesh",
          modelDescription: "Discretizes 3D CAD geometry into an FEA mesh deck (.inp).",
        },
      },
    },
    {
      id: "generate_cfd_mesh",
      title: "Discretize CAD to CFD Mesh (.su2)",
      description: "Generates aerodynamic surface and volume computational meshes for SU2 CFD analysis.",
      category: "transform",
      execute: async (ctx: any, params: { documentText?: string | undefined; uri?: string | undefined }) => {
        const targetUri = params?.uri || ctx.uri;
        const filename = targetUri ? targetUri.split("/").pop() || "body" : "body";
        const baseName = filename.replace(/\.[^/.]+$/, "");
        const stepText =
          params?.documentText ??
          ctx.documentText ??
          (targetUri ? ctx.documents?.get?.(targetUri)?.getText?.() : undefined) ??
          "";
        const lengthScale = /SI_UNIT\s*\(\s*\.MILLI\.\s*,\s*\.METRE\.\s*\)/i.test(stepText) ? 1e-3 : 1.0;
        let minX = -0.1,
          maxX = 0.1,
          minY = -0.1,
          maxY = 0.1,
          minZ = -0.05,
          maxZ = 0.05;
        if (stepText) {
          const ptRegex =
            /CARTESIAN_POINT\s*\(\s*'[^']*'\s*,\s*\(\s*([-+\d.eE]+)\s*,\s*([-+\d.eE]+)\s*,\s*([-+\d.eE]+)\s*\)/gi;
          let bx0 = Infinity,
            by0 = Infinity,
            bz0 = Infinity;
          let bx1 = -Infinity,
            by1 = -Infinity,
            bz1 = -Infinity;
          let count = 0;
          let m: RegExpExecArray | null;
          while ((m = ptRegex.exec(stepText)) !== null) {
            const x = parseFloat(m[1]!) * lengthScale,
              y = parseFloat(m[2]!) * lengthScale,
              z = parseFloat(m[3]!) * lengthScale;
            if (x < bx0) bx0 = x;
            if (y < by0) by0 = y;
            if (z < bz0) bz0 = z;
            if (x > bx1) bx1 = x;
            if (y > by1) by1 = y;
            if (z > bz1) bz1 = z;
            count++;
          }
          if (count >= 2) {
            minX = bx0;
            maxX = Math.max(bx1, bx0 + 0.01);
            minY = by0;
            maxY = Math.max(by1, by0 + 0.01);
            minZ = bz0;
            maxZ = Math.max(bz1, bz0 + 0.01);
          }
        }
        const refArea = Math.max(0.0001, Number(((maxY - minY) * (maxZ - minZ)).toFixed(6)));
        const refLength = Math.max(0.001, Number((maxX - minX).toFixed(4)));

        // Build a 3D SU2 hexahedral/tetrahedral volume mesh (.su2 format) around the CAD domain
        const nx = 2,
          ny = 2,
          nz = 2;
        const points: string[] = [];
        const ptIdx = (ix: number, iy: number, iz: number) => ix + iy * (nx + 1) + iz * (nx + 1) * (ny + 1);
        let pId = 0;
        for (let iz = 0; iz <= nz; iz++) {
          const z = minZ + (iz / nz) * (maxZ - minZ);
          for (let iy = 0; iy <= ny; iy++) {
            const y = minY + (iy / ny) * (maxY - minY);
            for (let ix = 0; ix <= nx; ix++) {
              const x = minX + (ix / nx) * (maxX - minX);
              points.push(`${x.toFixed(6)} ${y.toFixed(6)} ${z.toFixed(6)} ${pId}`);
              pId++;
            }
          }
        }

        // VTK_HEXAHEDRON = 12, VTK_QUAD = 9
        const elems: string[] = [];
        const inletQuads: string[] = [];
        const outletQuads: string[] = [];
        const wallQuads: string[] = [];
        let eId = 0;
        for (let iz = 0; iz < nz; iz++) {
          for (let iy = 0; iy < ny; iy++) {
            for (let ix = 0; ix < nx; ix++) {
              const n0 = ptIdx(ix, iy, iz);
              const n1 = ptIdx(ix + 1, iy, iz);
              const n2 = ptIdx(ix + 1, iy + 1, iz);
              const n3 = ptIdx(ix, iy + 1, iz);
              const n4 = ptIdx(ix, iy, iz + 1);
              const n5 = ptIdx(ix + 1, iy, iz + 1);
              const n6 = ptIdx(ix + 1, iy + 1, iz + 1);
              const n7 = ptIdx(ix, iy + 1, iz + 1);
              elems.push(`12 ${n0} ${n1} ${n2} ${n3} ${n4} ${n5} ${n6} ${n7} ${eId}`);
              eId++;
              if (ix === 0) inletQuads.push(`9 ${n0} ${n3} ${n7} ${n4}`);
              if (ix === nx - 1) outletQuads.push(`9 ${n1} ${n2} ${n6} ${n5}`);
              if (iz === 0) wallQuads.push(`9 ${n0} ${n1} ${n2} ${n3}`);
            }
          }
        }

        const su2MeshText = [
          `% SU2 3D Volume Mesh generated from STEP CAD: ${filename}`,
          `NDIME= 3`,
          `NELEM= ${elems.length}`,
          ...elems,
          `NPOIN= ${points.length}`,
          ...points,
          `NMARK= 3`,
          `MARKER_TAG= wall`,
          `MARKER_ELEMS= ${wallQuads.length}`,
          ...wallQuads,
          `MARKER_TAG= inlet`,
          `MARKER_ELEMS= ${inletQuads.length}`,
          ...inletQuads,
          `MARKER_TAG= outlet`,
          `MARKER_ELEMS= ${outletQuads.length}`,
          ...outletQuads,
          ``,
        ].join("\n");

        const cfgText = `% SU2 Aerodynamic Configuration generated from CAD: ${filename}\nSOLVER= INC_RANS\nKIND_TURB_MODEL= SST\nMATH_PROBLEM= DIRECT\nMESH_FILENAME= ${baseName}_mesh.su2\nINC_DENSITY_INIT= 1.225\nINC_VELOCITY_INIT= ( 10.0, 0.0, 0.0 )\nREF_LENGTH= ${refLength}\nREF_AREA= ${refArea}\nMARKER_HEATFLUX= ( wall, 0.0 )\nMARKER_INLET= ( inlet, 288.15, 10.0, 1.0, 0.0, 0.0 )\nMARKER_OUTLET= ( outlet, 101325.0 )\nITER= 250\n`;

        return {
          success: true,
          uri: targetUri,
          meshText: su2MeshText,
          configText: cfgText,
          suggestedFilename: `${baseName}_mesh.su2`,
        };
      },
      ui: {
        editorContextMenu: {
          group: "2_transform@3",
        },
        explorerContextMenu: {
          group: "modelscript_cae@3",
        },
        languageModelTool: {
          name: "step_discretize_cfd",
          displayName: "Discretize CAD to CFD Mesh",
          modelDescription: "Discretizes CAD geometry into an SU2 CFD volume mesh (.su2).",
        },
      },
    },
    {
      id: "create_fea_setup",
      title: "Create FEA Simulation Study (.fea.mo)",
      category: "transform",
      description: "Scaffolds a Modelica static structural FEA study targeting this CAD model.",
      execute: async (ctx: any, params: { documentText?: string | undefined; uri?: string | undefined }) => {
        const targetUri = params?.uri || ctx.uri;
        const filename = targetUri ? targetUri.split("/").pop() || "study" : "study";
        const baseName = filename.replace(/\.[^/.]+$/, "").replace(/[^a-zA-Z0-9_]/g, "_");
        const stepText =
          params?.documentText ??
          ctx.documentText ??
          (targetUri ? ctx.documents?.get?.(targetUri)?.getText?.() : undefined) ??
          "";
        const { extractStepAssembly } = await import("./assembly-extractor.js");
        const assembly = stepText ? extractStepAssembly(stepText) : undefined;
        const firstMassProps = assembly?.massProperties.values().next().value;

        let spanL = 0.2,
          widthB = 0.025,
          heightH = 0.01;
        if (stepText) {
          const ptRegex =
            /CARTESIAN_POINT\s*\(\s*'[^']*'\s*,\s*\(\s*([-+\d.eE]+)\s*,\s*([-+\d.eE]+)\s*,\s*([-+\d.eE]+)\s*\)/gi;
          let minX = Infinity,
            minY = Infinity,
            minZ = Infinity;
          let maxX = -Infinity,
            maxY = -Infinity,
            maxZ = -Infinity;
          let count = 0;
          let m: RegExpExecArray | null;
          while ((m = ptRegex.exec(stepText)) !== null) {
            const x = parseFloat(m[1]!),
              y = parseFloat(m[2]!),
              z = parseFloat(m[3]!);
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (z < minZ) minZ = z;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
            if (z > maxZ) maxZ = z;
            count++;
          }
          if (count >= 2) {
            const dims = [
              Math.max(maxX - minX, 0.005),
              Math.max(maxY - minY, 0.005),
              Math.max(maxZ - minZ, 0.005),
            ].sort((a, b) => b - a);
            spanL = dims[0]!;
            widthB = dims[1]!;
            heightH = dims[2]!;
          }
        }
        const massKg = firstMassProps?.mass ?? Number((spanL * widthB * heightH * 2700.0).toFixed(4));
        const sectionModulus = Math.max((widthB * heightH * heightH) / 6.0, 1e-9);
        const nominalLoadN = 100.0;
        const estimatedStressPa = Number(((nominalLoadN * spanL) / sectionModulus).toFixed(1));
        const yieldLimitPa = 250.0e6;

        const moText = `model ${baseName}_FEA "FEA Structural Study for ${filename}"\n  parameter Real m = ${massKg} "Structural mass derived from STEP CAD [kg]";\n  parameter Real span = ${spanL.toFixed(4)} "Characteristic span [m]";\n  parameter Real maxStress = ${estimatedStressPa} "Estimated max von Mises stress [Pa]";\n  parameter Real yieldLimit = ${yieldLimitPa} "Yield strength limit [Pa]";\n  Boolean isSafe = maxStress <= yieldLimit;\nend ${baseName}_FEA;\n`;
        return {
          success: true,
          uri: targetUri,
          source: moText,
          suggestedFilename: `${baseName}.fea.mo`,
        };
      },
      ui: {
        explorerContextMenu: {
          group: "modelscript_cae@4",
        },
      },
    },
    {
      id: "create_cfd_setup",
      title: "Create CFD Simulation Study (.cfd.mo)",
      category: "transform",
      description: "Scaffolds a Modelica steady-state CFD study targeting this CAD model.",
      execute: async (ctx: any, params: { documentText?: string | undefined; uri?: string | undefined }) => {
        const targetUri = params?.uri || ctx.uri;
        const filename = targetUri ? targetUri.split("/").pop() || "study" : "study";
        const baseName = filename.replace(/\.[^/.]+$/, "").replace(/[^a-zA-Z0-9_]/g, "_");
        const stepText =
          params?.documentText ??
          ctx.documentText ??
          (targetUri ? ctx.documents?.get?.(targetUri)?.getText?.() : undefined) ??
          "";
        let dx = 0.2,
          dy = 0.15,
          dz = 0.05;
        if (stepText) {
          const ptRegex =
            /CARTESIAN_POINT\s*\(\s*'[^']*'\s*,\s*\(\s*([-+\d.eE]+)\s*,\s*([-+\d.eE]+)\s*,\s*([-+\d.eE]+)\s*\)/gi;
          let minX = Infinity,
            minY = Infinity,
            minZ = Infinity;
          let maxX = -Infinity,
            maxY = -Infinity,
            maxZ = -Infinity;
          let count = 0;
          let m: RegExpExecArray | null;
          while ((m = ptRegex.exec(stepText)) !== null) {
            const x = parseFloat(m[1]!),
              y = parseFloat(m[2]!),
              z = parseFloat(m[3]!);
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (z < minZ) minZ = z;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
            if (z > maxZ) maxZ = z;
            count++;
          }
          if (count >= 2) {
            dx = Math.max(maxX - minX, 0.005);
            dy = Math.max(maxY - minY, 0.005);
            dz = Math.max(maxZ - minZ, 0.005);
          }
        }
        const refArea = Number((dy * dz).toFixed(6));
        const finenessRatio = dx / Math.max(Math.sqrt(refArea), 1e-4);
        const estCd = Number(Math.min(Math.max(0.05 + 0.65 / Math.max(finenessRatio, 0.5), 0.08), 1.15).toFixed(4));

        const moText = `model ${baseName}_CFD "CFD Aerodynamic Study for ${filename}"\n  parameter Real Cd = ${estCd} "Estimated drag coefficient from CAD fineness ratio";\n  parameter Real A_ref = ${refArea} "Projected frontal area from CAD bounding box [m²]";\n  parameter Real L_ref = ${dx.toFixed(4)} "Characteristic streamwise length [m]";\nend ${baseName}_CFD;\n`;
        return {
          success: true,
          uri: targetUri,
          source: moText,
          suggestedFilename: `${baseName}.cfd.mo`,
        };
      },
      ui: {
        explorerContextMenu: {
          group: "modelscript_cae@5",
        },
      },
    },
  ],

  // MCP server tools for STEP entity extraction and Modelica MultiBody conversion
  mcp: {
    serverName: "step-mcp",
    serverVersion: "1.0.0",
    tools: [
      {
        name: "step_extract_entities",
        description: "Extracts CAD product entities and shape representations from a STEP Part 21 file.",
        category: "ast",
        inputSchema: {
          path: { type: "string", description: "Path to .step / .stp file", required: true },
        },
      },
      {
        name: "step_to_multibody",
        description: "Translates STEP geometry entities into Modelica MultiBody kinematic frames.",
        category: "transformation",
        inputSchema: {
          path: { type: "string", description: "Path to .step / .stp file", required: true },
        },
      },
    ],
  },

  // Polyglot Triple Graph Grammar (TGG) rules linking STEP products, properties, placements, and joints to SysML v2 and Modelica
  polyglot: {
    languages: ["sysml2", "modelica"],
    rules: [
      tggRule({
        name: "StepProductToSysML2Part",
        sourceLang: "step",
        targetLang: "sysml2",
        source: ($, v) => $.ProductDefinition({ name: v("prodName") }),
        target: ($, v) => $.PartDefinition({ declaredName: v("prodName") }),
        where: (v) => [tggEq(v("prodName"), v("prodName")), tggComplement(["description", "id", "formation"])],
      }),
      tggRule({
        name: "StepPropertyToSysML2Attribute",
        sourceLang: "step",
        targetLang: "sysml2",
        source: ($, v) => $.PropertyDefinition({ name: v("propName"), value: v("val") }),
        target: ($, v) => $.AttributeUsage({ declaredName: v("propName"), defaultValue: v("val") }),
        where: (v) => [
          tggEq(v("propName"), v("propName")),
          tggEq(v("val"), v("val")),
          tggComplement(["definition", "representation"]),
        ],
      }),
      tggRule({
        name: "StepPlacementToSysML2Port",
        sourceLang: "step",
        targetLang: "sysml2",
        source: ($, v) => $.Axis2Placement3D({ name: v("frameName") }),
        target: ($, v) => $.PortUsage({ declaredName: v("frameName") }),
        where: (v) => [tggEq(v("frameName"), v("frameName")), tggComplement(["location", "axis", "refDirection"])],
      }),
      tggRule({
        name: "StepRevoluteJointToModelicaRevolute",
        sourceLang: "step",
        targetLang: "modelica",
        source: ($, v) => $.KinematicPair({ name: v("jointName"), pairType: "revolute" }),
        target: ($, v) =>
          $.ComponentClause({
            name: v("jointName"),
            typeSpecifier: "Modelica.Mechanics.MultiBody.Joints.Revolute",
          }),
        where: (v) => [tggEq(v("jointName"), v("jointName")), tggComplement(["axis", "limits", "origin"])],
      }),
      tggRule({
        name: "StepPrismaticJointToModelicaPrismatic",
        sourceLang: "step",
        targetLang: "modelica",
        source: ($, v) => $.KinematicPair({ name: v("jointName"), pairType: "prismatic" }),
        target: ($, v) =>
          $.ComponentClause({
            name: v("jointName"),
            typeSpecifier: "Modelica.Mechanics.MultiBody.Joints.Prismatic",
          }),
        where: (v) => [tggEq(v("jointName"), v("jointName")), tggComplement(["axis", "limits", "origin"])],
      }),
    ],
  },

  lsp: {
    fileExtensions: [".step", ".stp", ".p21"],
    icons: {
      light: "./assets/step/icon-light.png",
      dark: "./assets/step/icon-dark.png",
    },
    handlers: {
      // LSP request handler that maps a STEP assembly into a Modelica MultiBody model
      "modelscript/generateMultiBody": async (ctx: any, params: { uri: string }) => {
        const model = ctx.workspaceManager?.stepWorkspaceIndex?.getAssemblyModel(params.uri);
        if (!model) {
          throw new Error(`No STEP assembly found for ${params.uri}`);
        }

        const filename = params.uri.split("/").pop() || "Assembly";
        const baseName = filename.replace(/\.[^/.]+$/, "").replace(/[^a-zA-Z0-9_]/g, "_");

        const { mapStepToMultiBody } = await import("../step-multibody-mapper.js");
        const { generateMultiBodyModelica } = await import("@modelscript/modelica");

        const multiBodyDescriptor = mapStepToMultiBody(baseName, model as any);
        const modelicaSource = generateMultiBodyModelica(multiBodyDescriptor, params.uri);

        return { source: modelicaSource, name: baseName };
      },
      // LSP request handler that returns triangulated 3D WebGL meshes via OCCT or B-Rep loop fallback
      "modelscript/getStepMeshes": async (
        ctx: any,
        params: { uri: string; documentText?: string | undefined },
      ): Promise<any[]> => {
        let targetUri = params.uri;
        if (!/\.(step|stp|p21)$/i.test(targetUri)) {
          const unifiedIdx = ctx.workspaceManager?.unifiedWorkspace?.toUnifiedPartial?.();
          if (unifiedIdx) {
            for (const [, entry] of unifiedIdx.symbols) {
              if (
                entry.ruleName === "step_product" &&
                entry.resourceId &&
                /\.(step|stp|p21)$/i.test(entry.resourceId)
              ) {
                targetUri = entry.resourceId;
                break;
              }
            }
          }
        }

        let meshes = [...(ctx.workspaceManager?.stepWorkspaceIndex?.getMeshes(targetUri) || [])];
        let unifiedIndex = ctx.workspaceManager?.unifiedWorkspace?.toUnifiedPartial?.();

        let stepSourceText = params?.documentText || ctx.documentManager?.documentTrees?.get(targetUri)?.text;
        if (!stepSourceText && ctx.documents?.get) {
          stepSourceText = ctx.documents.get(targetUri)?.getText();
        }
        if (!stepSourceText) {
          try {
            stepSourceText = await ctx.sharedFs?.read?.(targetUri);
          } catch {}
        }

        if (meshes.length === 0 && ctx.workspaceManager?.stepWorkspaceIndex && stepSourceText) {
          try {
            const buffer = new TextEncoder().encode(stepSourceText);
            await ctx.workspaceManager.stepWorkspaceIndex.parseStepFile(targetUri, buffer);
            meshes = [...(ctx.workspaceManager.stepWorkspaceIndex.getMeshes(targetUri) || [])];
            unifiedIndex = ctx.workspaceManager?.unifiedWorkspace?.toUnifiedPartial?.();
          } catch {}
        }

        if (meshes.length === 0) {
          // Pure-TypeScript fallback triangulator for STEP B-Rep loops (POLY_LOOP / EDGE_LOOP)
          const triangulateStepGeometry = (srcText: string) => {
            const ptMap = new Map<string, [number, number, number]>();
            const allPts: [number, number, number][] = [];
            const cpRegex =
              /(#\d+)\s*=\s*CARTESIAN_POINT\s*\(\s*'[^']*'\s*,\s*\(\s*([-+\d.eE]+)\s*,\s*([-+\d.eE]+)\s*,\s*([-+\d.eE]+)\s*\)/gi;
            let m: RegExpExecArray | null;
            while ((m = cpRegex.exec(srcText)) !== null) {
              const pt: [number, number, number] = [parseFloat(m[2]!), parseFloat(m[3]!), parseFloat(m[4]!)];
              ptMap.set(m[1]!, pt);
              allPts.push(pt);
            }
            const dirMap = new Map<string, [number, number, number]>();
            const dirRegex =
              /(#\d+)\s*=\s*DIRECTION\s*\(\s*'[^']*'\s*,\s*\(\s*([-+\d.eE]+)\s*,\s*([-+\d.eE]+)\s*,\s*([-+\d.eE]+)\s*\)/gi;
            while ((m = dirRegex.exec(srcText)) !== null) {
              dirMap.set(m[1]!, [parseFloat(m[2]!), parseFloat(m[3]!), parseFloat(m[4]!)]);
            }
            const axis2Map = new Map<
              string,
              { loc: [number, number, number]; axis: [number, number, number]; refDir: [number, number, number] }
            >();
            const axRegex =
              /(#\d+)\s*=\s*AXIS2_PLACEMENT_3D\s*\(\s*'[^']*'\s*,\s*(#\d+)\s*(?:,\s*(#\d+|\$)\s*(?:,\s*(#\d+|\$))?)?\s*\)/gi;
            while ((m = axRegex.exec(srcText)) !== null) {
              const loc = ptMap.get(m[2]!) ?? [0, 0, 0];
              const axis = (m[3] ? dirMap.get(m[3]) : undefined) ?? [0, 0, 1];
              const refDir = (m[4] ? dirMap.get(m[4]) : undefined) ?? [1, 0, 0];
              axis2Map.set(m[1]!, { loc, axis, refDir });
            }
            const circleMap = new Map<string, { axis2Ref: string; radius: number }>();
            const circRegex = /(#\d+)\s*=\s*CIRCLE\s*\(\s*'[^']*'\s*,\s*(#\d+)\s*,\s*([-+\d.eE]+)\s*\)/gi;
            while ((m = circRegex.exec(srcText)) !== null) {
              circleMap.set(m[1]!, { axis2Ref: m[2]!, radius: Math.abs(parseFloat(m[3]!)) || 1.0 });
            }
            const bsplineMap = new Map<string, [number, number, number][]>();
            const bsRegex = /(#\d+)\s*=\s*B_SPLINE_CURVE_WITH_KNOTS\s*\(\s*'[^']*'\s*,\s*\d+\s*,\s*\(([^)]+)\)/gi;
            while ((m = bsRegex.exec(srcText)) !== null) {
              const ctrlRefs = m[2]!.match(/#\d+/g) || [];
              const ctrlPts: [number, number, number][] = [];
              for (const r of ctrlRefs) {
                const p = ptMap.get(r);
                if (p) ctrlPts.push(p);
              }
              if (ctrlPts.length >= 2) bsplineMap.set(m[1]!, ctrlPts);
            }

            const vpMap = new Map<string, [number, number, number]>();
            const vpRegex = /(#\d+)\s*=\s*VERTEX_POINT\s*\(\s*'[^']*'\s*,\s*(#\d+)\s*\)/gi;
            while ((m = vpRegex.exec(srcText)) !== null) {
              const cp = ptMap.get(m[2]!);
              if (cp) vpMap.set(m[1]!, cp);
            }

            const edgeChainMap = new Map<string, [number, number, number][]>();
            const ecRegex =
              /(#\d+)\s*=\s*EDGE_CURVE\s*\(\s*'[^']*'\s*,\s*(#\d+)\s*,\s*(#\d+)\s*(?:,\s*(#\d+))?(?:\s*,\s*(\.[TF]\.))?\s*\)/gi;
            while ((m = ecRegex.exec(srcText)) !== null) {
              const pA = vpMap.get(m[2]!) ?? ptMap.get(m[2]!);
              const pB = vpMap.get(m[3]!) ?? ptMap.get(m[3]!);
              const curveRef = m[4];
              if (pA && pB) {
                const circ = curveRef ? circleMap.get(curveRef) : undefined;
                const bspline = curveRef ? bsplineMap.get(curveRef) : undefined;
                if (circ) {
                  const ax = axis2Map.get(circ.axis2Ref) ?? {
                    loc: [0, 0, 0] as [number, number, number],
                    axis: [0, 0, 1] as [number, number, number],
                    refDir: [1, 0, 0] as [number, number, number],
                  };
                  const r = circ.radius;
                  const c = ax.loc;
                  const u = ax.refDir;
                  const z = ax.axis;
                  // v = z x u
                  const v: [number, number, number] = [
                    z[1] * u[2] - z[2] * u[1],
                    z[2] * u[0] - z[0] * u[2],
                    z[0] * u[1] - z[1] * u[0],
                  ];
                  const distAB = Math.hypot(pA[0] - pB[0], pA[1] - pB[1], pA[2] - pB[2]);
                  const segs = 16;
                  const chain: [number, number, number][] = [];
                  if (distAB < 1e-6) {
                    // Full circle
                    for (let s = 0; s < segs; s++) {
                      const th = (s / segs) * 2 * Math.PI;
                      const cs = Math.cos(th),
                        sn = Math.sin(th);
                      const pt: [number, number, number] = [
                        c[0] + r * (cs * u[0] + sn * v[0]),
                        c[1] + r * (cs * u[1] + sn * v[1]),
                        c[2] + r * (cs * u[2] + sn * v[2]),
                      ];
                      chain.push(pt);
                      allPts.push(pt);
                    }
                  } else {
                    // Circular arc between pA and pB
                    const dA = [pA[0] - c[0], pA[1] - c[1], pA[2] - c[2]];
                    const dB = [pB[0] - c[0], pB[1] - c[1], pB[2] - c[2]];
                    const thA = Math.atan2(
                      dA[0]! * v[0] + dA[1]! * v[1] + dA[2]! * v[2],
                      dA[0]! * u[0] + dA[1]! * u[1] + dA[2]! * u[2],
                    );
                    let thB = Math.atan2(
                      dB[0]! * v[0] + dB[1]! * v[1] + dB[2]! * v[2],
                      dB[0]! * u[0] + dB[1]! * u[1] + dB[2]! * u[2],
                    );
                    while (thB <= thA + 1e-6) thB += 2 * Math.PI;
                    const arcSegs = Math.max(4, Math.round(((thB - thA) / (2 * Math.PI)) * segs));
                    for (let s = 0; s <= arcSegs; s++) {
                      const th = thA + (s / arcSegs) * (thB - thA);
                      const cs = Math.cos(th),
                        sn = Math.sin(th);
                      const pt: [number, number, number] = [
                        c[0] + r * (cs * u[0] + sn * v[0]),
                        c[1] + r * (cs * u[1] + sn * v[1]),
                        c[2] + r * (cs * u[2] + sn * v[2]),
                      ];
                      chain.push(pt);
                      allPts.push(pt);
                    }
                  }
                  edgeChainMap.set(m[1]!, chain);
                } else if (bspline) {
                  edgeChainMap.set(m[1]!, bspline);
                } else {
                  edgeChainMap.set(m[1]!, [pA, pB]);
                }
              }
            }
            const oeChainMap = new Map<string, [number, number, number][]>();
            const oeRegex = /(#\d+)\s*=\s*ORIENTED_EDGE\s*\([^,]*,[^,]*,[^,]*,\s*(#\d+)\s*,\s*(\.[TF]\.)\s*\)/gi;
            while ((m = oeRegex.exec(srcText)) !== null) {
              const chain = edgeChainMap.get(m[2]!);
              if (chain && chain.length > 0) {
                const forward = m[3]!.toUpperCase() === ".T.";
                oeChainMap.set(m[1]!, forward ? chain : [...chain].reverse());
              }
            }

            const vertices: number[] = [];
            const normals: number[] = [];
            const indices: number[] = [];
            const addTriangle = (
              a: [number, number, number],
              b: [number, number, number],
              c: [number, number, number],
            ) => {
              const ux = b[0] - a[0],
                uy = b[1] - a[1],
                uz = b[2] - a[2];
              const vx = c[0] - a[0],
                vy = c[1] - a[1],
                vz = c[2] - a[2];
              let nx = uy * vz - uz * vy;
              let ny = uz * vx - ux * vz;
              let nz = ux * vy - uy * vx;
              const len = Math.hypot(nx, ny, nz);
              if (len <= 1e-12) return;
              nx /= len;
              ny /= len;
              nz /= len;
              const baseIdx = vertices.length / 3;
              vertices.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
              normals.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
              indices.push(baseIdx, baseIdx + 1, baseIdx + 2);
            };

            const pushUniquePt = (arr: [number, number, number][], p: [number, number, number]) => {
              if (arr.length > 0) {
                const last = arr[arr.length - 1]!;
                if (Math.hypot(last[0] - p[0], last[1] - p[1], last[2] - p[2]) < 1e-7) return;
              }
              arr.push(p);
            };

            const loopRegex = /(#\d+)\s*=\s*(?:POLY_LOOP|EDGE_LOOP)\s*\(\s*'[^']*'\s*,\s*\(([^)]+)\)\s*\)/gi;
            while ((m = loopRegex.exec(srcText)) !== null) {
              const refs = m[2]!.match(/#\d+/g) || [];
              const loopPts: [number, number, number][] = [];
              for (const r of refs) {
                const oeChain = oeChainMap.get(r);
                if (oeChain) {
                  for (const p of oeChain) pushUniquePt(loopPts, p);
                  continue;
                }
                const pt = ptMap.get(r) ?? vpMap.get(r);
                if (pt) pushUniquePt(loopPts, pt);
              }
              if (
                loopPts.length >= 2 &&
                Math.hypot(
                  loopPts[0]![0] - loopPts[loopPts.length - 1]![0],
                  loopPts[0]![1] - loopPts[loopPts.length - 1]![1],
                  loopPts[0]![2] - loopPts[loopPts.length - 1]![2],
                ) < 1e-7
              ) {
                loopPts.pop();
              }
              if (loopPts.length >= 3) {
                for (let i = 1; i < loopPts.length - 1; i++) {
                  addTriangle(loopPts[0]!, loopPts[i]!, loopPts[i + 1]!);
                }
              }
            }

            if (indices.length === 0) {
              // Build a triangulated 3D box mesh spanning the STEP CARTESIAN_POINT bounding box
              let minX = -0.05,
                minY = -0.05,
                minZ = -0.025;
              let maxX = 0.05,
                maxY = 0.05,
                maxZ = 0.025;
              if (allPts.length >= 2) {
                minX = Infinity;
                minY = Infinity;
                minZ = Infinity;
                maxX = -Infinity;
                maxY = -Infinity;
                maxZ = -Infinity;
                for (const [px, py, pz] of allPts) {
                  if (px < minX) minX = px;
                  if (py < minY) minY = py;
                  if (pz < minZ) minZ = pz;
                  if (px > maxX) maxX = px;
                  if (py > maxY) maxY = py;
                  if (pz > maxZ) maxZ = pz;
                }
                if (maxX - minX < 1e-4) {
                  minX -= 0.01;
                  maxX += 0.01;
                }
                if (maxY - minY < 1e-4) {
                  minY -= 0.01;
                  maxY += 0.01;
                }
                if (maxZ - minZ < 1e-4) {
                  minZ -= 0.01;
                  maxZ += 0.01;
                }
              }
              const corners: [number, number, number][] = [
                [minX, minY, minZ],
                [maxX, minY, minZ],
                [maxX, maxY, minZ],
                [minX, maxY, minZ],
                [minX, minY, maxZ],
                [maxX, minY, maxZ],
                [maxX, maxY, maxZ],
                [minX, maxY, maxZ],
              ];
              const quads: [number, number, number, number][] = [
                [0, 3, 2, 1],
                [4, 5, 6, 7],
                [0, 1, 5, 4],
                [2, 3, 7, 6],
                [0, 4, 7, 3],
                [1, 2, 6, 5],
              ];
              for (const [q0, q1, q2, q3] of quads) {
                addTriangle(corners[q0]!, corners[q1]!, corners[q2]!);
                addTriangle(corners[q0]!, corners[q2]!, corners[q3]!);
              }
            }

            return {
              vertices: new Float32Array(vertices),
              normals: new Float32Array(normals),
              indices: new Uint32Array(indices),
            };
          };

          const geom = triangulateStepGeometry(stepSourceText || "");
          const normTarget = targetUri.replace(":///", ":/");
          if (unifiedIndex) {
            for (const [, entry] of unifiedIndex.symbols) {
              const normResource = (entry.resourceId || "").replace(":///", ":/");
              if (normResource === normTarget && entry.ruleName === "step_shape") {
                meshes.push({
                  name: entry.name,
                  color: [0.6, 0.75, 0.9],
                  attributes: { position: { array: geom.vertices }, normal: { array: geom.normals } },
                  index: { array: geom.indices },
                });
              }
            }
          }
          if (meshes.length === 0 && /\.(step|stp|p21)$/i.test(targetUri)) {
            const nameMatch = (stepSourceText || "").match(
              /(?:MANIFOLD_SOLID_BREP|CLOSED_SHELL|PRODUCT)\s*\(\s*'([^']+)'/i,
            );
            const fallbackName = nameMatch?.[1] || "SolidBody";
            meshes.push({
              name: fallbackName,
              color: [0.6, 0.75, 0.9],
              attributes: { position: { array: geom.vertices }, normal: { array: geom.normals } },
              index: { array: geom.indices },
            });
          }
        }

        return meshes.map((mesh: any, idx: number) => {
          const rawName = mesh.name || `Mesh_${idx}`;
          let displayName = rawName;
          let type = "Face";
          if (unifiedIndex) {
            const normTarget = targetUri.replace(":///", ":/");
            for (const [, entry] of unifiedIndex.symbols) {
              const normResource = (entry.resourceId || "").replace(":///", ":/");
              if (normResource === normTarget && entry.name === rawName && entry.ruleName === "step_shape") {
                displayName = entry.name;
                type = (entry.metadata as any)?.stepType ?? "NamedShape";
                break;
              }
            }
          }

          const posArr = mesh.attributes?.position?.array || [];
          const normArr = mesh.attributes?.normal?.array || [];
          const idxArr = mesh.index?.array || [];

          return {
            id: idx,
            name: displayName,
            type,
            color: mesh.color || [0.8, 0.8, 0.8],
            vertices: Array.isArray(posArr) ? posArr : Array.from(posArr),
            normals: Array.isArray(normArr) ? normArr : Array.from(normArr),
            indices: Array.isArray(idxArr) ? idxArr : Array.from(idxArr),
          };
        });
      },
    },
  },

  extras: ($) => [/\s/, $["BLOCK_COMMENT"]!],

  rules: {
    // Top-level structure
    StepFile: ($) => seq($["HeaderSection"]!, repeat($["DataSection"]!), $["Trailer"]!),

    Trailer: () => "END-ISO-10303-21;",

    // Header Section
    HeaderSection: ($) => seq("ISO-10303-21;", "HEADER;", repeat(field("headerEntity", $["HeaderEntity"]!)), "ENDSEC;"),

    HeaderEntity: ($) =>
      def({
        syntax: seq(field("keyword", $["KEYWORD"]!), "(", field("parameters", $["ParameterList"]!), ")", ";"),
        symbol: (self: Record<string, string>) => ({
          kind: "HeaderEntity",
          name: self["keyword"] ?? "",
        }),
      }),

    // Data Section
    DataSection: ($) =>
      def({
        syntax: seq(
          "DATA",
          optional(seq("(", field("scopeName", $["STRING"]!), ")")),
          ";",
          repeat(field("entity", $["EntityInstance"]!)),
          "ENDSEC;",
        ),
        symbol: (self: Record<string, string>) => ({
          kind: "DataSection",
          name: self["scopeName"] || "DATA",
          exports: [self["scopeName"] ?? ""],
        }),
      }),

    // Entity Instance
    EntityInstance: ($) =>
      def({
        syntax: seq(field("id", $["ENTITY_INSTANCE_NAME"]!), "=", field("record", $["_Record"]!), ";"),
        symbol: (self: Record<string, string>) => ({
          kind: "Entity",
          name: self["id"] ?? "",
          exports: [self["id"] ?? ""],
          attributes: {
            entityType: self["record"] ?? "",
          },
        }),
      }),

    _Record: ($) => choice($["SimpleRecord"]!, $["ComplexRecord"]!),

    SimpleRecord: ($) =>
      seq(field("keyword", $["KEYWORD"]!), "(", optional(field("parameters", $["ParameterList"]!)), ")"),

    ComplexRecord: ($) => seq("(", repeat1($["SimpleRecord"]!), ")"),

    ParameterList: ($) => seq($["_Parameter"]!, repeat(seq(",", $["_Parameter"]!))),

    _Parameter: ($) =>
      choice(
        $["TypedParameter"]!,
        $["EntityReference"]!,
        $["REAL"]!,
        $["INTEGER"]!,
        $["STRING"]!,
        $["ENUMERATION"]!,
        $["ListValue"]!,
        $["OMITTED_PARAMETER"]!,
        $["DERIVED_PARAMETER"]!,
      ),

    EntityReference: ($) =>
      ref({
        syntax: field("target", $["ENTITY_INSTANCE_NAME"]!),
        name: (self: Record<string, string>) => self["target"] ?? "",
        targetKinds: ["Entity"],
        resolve: "lexical",
      }),

    TypedParameter: ($) =>
      seq(field("keyword", $["KEYWORD"]!), "(", optional(field("parameters", $["ParameterList"]!)), ")"),

    ListValue: ($) => seq("(", optional($["ParameterList"]!), ")"),

    OMITTED_PARAMETER: () => "$",

    DERIVED_PARAMETER: () => "*",

    // Terminals
    ENTITY_INSTANCE_NAME: () => /#[0-9]+/,

    KEYWORD: () => /[A-Z][A-Z0-9_]*/,

    INTEGER: () => /[+-]?[0-9]+/,

    REAL: () => /[+-]?[0-9]+\.[0-9]*([eE][+-]?[0-9]+)?/,

    STRING: () => /'([^']|'')*'/,

    ENUMERATION: () => /\.[A-Z][A-Z0-9_]*\./,

    BLOCK_COMMENT: () => /\/\*[^*]*\*+([^/*][^*]*\*+)*\//,
  },
});

export default stepLanguage;
