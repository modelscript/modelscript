import fs from "fs";
import occtimportjs from "occt-import-js";
import path from "path";

// 1. Read CAD and calculate geometric properties
interface MeshData {
  attributes?: { position?: { array: ArrayLike<number> } };
  index?: { array: ArrayLike<number> };
}

function computeMeshProperties(meshes: MeshData[]) {
  let totalVolume = 0;
  let totalSurfaceArea = 0;

  for (const mesh of meshes) {
    if (!mesh.attributes || !mesh.attributes.position || !mesh.index) continue;

    const positions = mesh.attributes.position.array;
    const indices = mesh.index.array;

    let volume = 0;
    let surfaceArea = 0;

    for (let i = 0; i < indices.length; i += 3) {
      const i0 = indices[i] * 3;
      const i1 = indices[i + 1] * 3;
      const i2 = indices[i + 2] * 3;

      const v0 = [positions[i0], positions[i0 + 1], positions[i0 + 2]];
      const v1 = [positions[i1], positions[i1 + 1], positions[i1 + 2]];
      const v2 = [positions[i2], positions[i2 + 1], positions[i2 + 2]];

      const crossX = v1[1] * v2[2] - v1[2] * v2[1];
      const crossY = v1[2] * v2[0] - v1[0] * v2[2];
      const crossZ = v1[0] * v2[1] - v1[1] * v2[0];

      volume += (v0[0] * crossX + v0[1] * crossY + v0[2] * crossZ) / 6.0;

      const dx1 = v1[0] - v0[0];
      const dy1 = v1[1] - v0[1];
      const dz1 = v1[2] - v0[2];

      const dx2 = v2[0] - v0[0];
      const dy2 = v2[1] - v0[1];
      const dz2 = v2[2] - v0[2];

      const nx = dy1 * dz2 - dz1 * dy2;
      const ny = dz1 * dx2 - dx1 * dz2;
      const nz = dx1 * dy2 - dy1 * dx2;

      surfaceArea += 0.5 * Math.sqrt(nx * nx + ny * ny + nz * nz);
    }

    totalVolume += Math.abs(volume);
    totalSurfaceArea += surfaceArea;
  }

  return { volume: totalVolume, surfaceArea: totalSurfaceArea };
}

async function main() {
  const stepPath = path.join(__dirname, "cad/drone.step");
  console.log(`[1/3] Parsing CAD geometry from ${stepPath}...`);
  const fileData = fs.readFileSync(stepPath);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const occt = await (occtimportjs as any)();
  const result = occt.ReadStepFile(new Uint8Array(fileData), null);

  const props = computeMeshProperties(result.meshes || []);
  // Note: Assuming CAD units are mm, converting to meters for physics model
  const volumeM3 = props.volume * 1e-9;
  const areaM2 = props.surfaceArea * 1e-6;
  const rawStockVolumeM3 = volumeM3 * 1.5; // Assume 50% more raw material for milling

  console.log(`      Extracted Volume: ${(volumeM3 * 1e6).toFixed(2)} cm^3`);
  console.log(`      Extracted Surface Area: ${(areaM2 * 1e4).toFixed(2)} cm^2`);

  // 2. Generate the TradeStudy Modelica file
  console.log(`\n[2/3] Generating Modelica Trade Study with Extracted Parameters...`);

  const moCode = `
model TradeStudy
  import Manufacturing;
  
  // UMP: 3D Printing the drone chassis
  Manufacturing.FDM_3D_Printing fdm(
    partVolume = ${volumeM3.toExponential(4)},
    surfaceArea = ${areaM2.toExponential(4)}
  );
  
  // UMP: CNC Milling the drone chassis
  Manufacturing.CNC_Milling cnc(
    rawVolume = ${rawStockVolumeM3.toExponential(4)},
    partVolume = ${volumeM3.toExponential(4)}
  );
  
  // Evaluation Metric Deltas
  Real costDifference = cnc.cost - fdm.cost;
  Real timeDifference = cnc.totalTime - fdm.totalTime;
end TradeStudy;
`;

  const moPath = path.join(__dirname, "TradeStudy.mo");
  fs.writeFileSync(moPath, moCode);
  console.log(`      Wrote TradeStudy.mo`);

  // 3. Evaluate the models (mocked evaluation for the proof of concept)
  console.log(`\n[3/3] Evaluating Manufacturing Pipeline...`);
  console.log(`--------------------------------------------------`);

  // Since we don't have a direct CLI command for evaluating arbitrary equations yet,
  // we'll run the equations natively in JS to show what the ModelScript DAE solver would yield:

  // FDM Output
  const supportVolRatio = 0.2;
  const depRate = 0.5e-6; // m3/s
  const fdmRate = 15.0; // $/h
  const fdmSetup = 300.0;

  const fdmVol = volumeM3 * (1.0 + supportVolRatio);
  const fdmTime = fdmVol / depRate;
  const fdmTotalTime = fdmSetup + fdmTime;
  const fdmCost = (fdmTotalTime / 3600.0) * fdmRate;

  // CNC Output
  const mrr = 1.5e-6; // m3/s
  const cncRate = 65.0; // $/h
  const cncSetupTime = 1800.0;
  const cncSetupCost = 50.0;

  const removedVol = rawStockVolumeM3 - volumeM3;
  const cncTime = removedVol / mrr;
  const cncTotalTime = cncSetupTime + cncTime;
  const cncCost = cncSetupCost + (cncTotalTime / 3600.0) * cncRate;

  console.log(`Option A: FDM 3D Printing`);
  console.log(`  Lead Time : ${(fdmTotalTime / 3600).toFixed(2)} hours`);
  console.log(`  Unit Cost : $${fdmCost.toFixed(2)}`);

  console.log(`\nOption B: CNC Machining (Aluminum)`);
  console.log(`  Lead Time : ${(cncTotalTime / 3600).toFixed(2)} hours`);
  console.log(`  Unit Cost : $${cncCost.toFixed(2)}`);

  console.log(`\nConclusion:`);
  if (fdmCost < cncCost) {
    console.log(`  FDM is $${(cncCost - fdmCost).toFixed(2)} cheaper per unit at low volume.`);
  } else {
    console.log(`  CNC is $${(fdmCost - cncCost).toFixed(2)} cheaper per unit.`);
  }

  console.log(`--------------------------------------------------`);
  console.log(`Digital Thread link complete: Modifying drone.step will automatically update these values.`);

  // 4. Generate Visualizations (Mermaid)
  console.log(`\n[4/4] Generating Manufacturing Visualizations...`);

  // Gantt Chart for CNC
  const cncSetupMin = Math.round(cncSetupTime / 60);
  const cncMachiningMin = Math.round(cncTime / 60);
  const fdmSetupMin = Math.round(fdmSetup / 60);
  const fdmPrintMin = Math.round(fdmTime / 60);

  const mermaidGantt = `
\`\`\`mermaid
gantt
    title Drone Chassis Manufacturing Lead Time (Dynamic)
    dateFormat m
    axisFormat %H:%M

    section CNC Machining (Option B)
    Machine Setup ($${cncSetupCost.toFixed(2)}) :a1, 0, ${cncSetupMin}m
    Active Milling ($${(cncCost - cncSetupCost).toFixed(2)}) :a2, after a1, ${cncMachiningMin}m

    section FDM 3D Printing (Option A)
    Bed Prep & Heat ($${((fdmSetup / 3600) * fdmRate).toFixed(2)}) :b1, 0, ${fdmSetupMin}m
    Active Printing ($${((fdmTime / 3600) * fdmRate).toFixed(2)}) :b2, after b1, ${fdmPrintMin}m
\`\`\`
  `;

  const mermaidSankey = `
\`\`\`mermaid
sankey-beta
    Total Cost CNC, Labor & Setup, ${cncSetupCost.toFixed(2)}
    Total Cost CNC, Machine Time, ${(cncCost - cncSetupCost).toFixed(2)}
\`\`\`
  `;

  console.log(mermaidGantt.trim());
  console.log();
  console.log(mermaidSankey.trim());

  const vizPath = path.join(__dirname, "Visualizations.md");
  fs.writeFileSync(vizPath, "# Dynamic Manufacturing Visualizations\n" + mermaidGantt + "\n" + mermaidSankey);
  console.log(`\n      Wrote Visualizations.md`);
}

main().catch(console.error);
