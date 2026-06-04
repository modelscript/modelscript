/**
 * Seed script: Create a CFD animation post for the SNES injection mold.
 *
 * Runs the WasmOpenFoamProvider to generate mesh frames, then creates
 * a social post with the cfd-animation artifact type.
 *
 * Usage:
 *   cd apps/api && npx tsx src/seed-cfd-animation.ts
 */

import { WasmOpenFoamProvider } from "@modelscript/cosim/participants/cfd-provider";
import { LibraryDatabase } from "./database.js";
import { generateThumbnail } from "./workers/thumbnailWorker.js";

// ── Seed ─────────────────────────────────────────────────────────

export async function seedCfdAnimation(db: LibraryDatabase) {
  const devUser = db.getUserByUsername("dev");

  if (!devUser) {
    console.error("No 'dev' user found. Run test-reset.ts first.");
    return;
  }

  const provider = new WasmOpenFoamProvider("seed-cfd", "InjectionCavity");
  await provider.loadGeometry(new Uint8Array([83, 84, 69, 80])); // "STEP"

  const frames: Record<string, unknown>[] = [];
  const STEPS = 120;
  const DT = 0.005; // 5ms steps → 600ms total fill and cool

  for (let i = 0; i < STEPS; i++) {
    await provider.doStep(i * DT, DT);
    const buffer = await provider.getVtkBuffer();
    if (!buffer) continue;
    const payload = JSON.parse(new TextDecoder().decode(buffer));

    if (i === 0) {
      // First frame: include full geometry
      frames.push({
        time: payload.time,
        geometry: payload.geometry,
        fields: payload.fields,
      });
    } else {
      // Subsequent frames: fields only (geometry shared with frame 0)
      frames.push({
        time: payload.time,
        fields: payload.fields,
      });
    }
  }

  await provider.terminate();

  const viewConfig = JSON.stringify({
    frames,
    solverInfo: { name: "OpenFOAM / ModelScript", version: "24.06" },
    modelDescription: "SNES Controller — ABS Injection Molding",
    moldGeometry: { length: 0.15, width: 0.1, height: 0.02 },
  });

  const viewId = db.createArtifactView(
    devUser.id,
    "cfd-animation",
    "inline",
    viewConfig,
    "SNES Mold Injection — Melt Front Animation",
  );

  db.createPost(
    devUser.id,
    "Ran the injection molding co-simulation for the SNES controller mold 🎮 Watch the ABS polymer melt front advance through the 150mm × 100mm cavity with parabolic flow! The alpha.polymer field shows fill fraction at each vertex. Gate inlet at x=0. Full fill in ~200ms. #cfd #injection-molding #cosim",
    viewId,
  );

  console.log("✅ Seeded CFD Animation post!");
  generateThumbnail(viewId).catch(console.error);
}

// If run directly
import { fileURLToPath } from "url";
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const database = new LibraryDatabase();
  seedCfdAnimation(database).catch(console.error);
}
