/**
 * Seed script: Create a drone CFD simulation result post.
 *
 * Reads the generated VTU file for the drone CFD and creates a social post.
 *
 * Usage:
 *   cd apps/api && npx tsx src/seed-drone-cfd.ts
 */

import fs from "fs";
import { LibraryDatabase } from "./database.js";
import { generateThumbnail } from "./workers/thumbnailWorker.js";

// ── Seed ─────────────────────────────────────────────────────────

export async function seedDroneCfd(db: LibraryDatabase) {
  const devUser = db.getUserByUsername("dev");

  if (!devUser) {
    console.error("No 'dev' user found. Run test-reset.ts first.");
    return;
  }

  const vtuPath = "/home/omar/git/modelscript/packages/examples/drone-chassis/drone_cfd.vtu";
  if (!fs.existsSync(vtuPath)) {
    console.error(`VTU file not found at ${vtuPath}`);
    process.exit(1);
  }

  const vtuXml = fs.readFileSync(vtuPath, "utf-8");

  const viewId = db.createArtifactView(
    devUser.id,
    "simulation-result",
    "inline",
    JSON.stringify({
      vtuInline: vtuXml,
      fieldUnits: {
        SurfacePressure: "Pa",
        Velocity: "m/s",
      },
      solverInfo: {
        name: "OpenFOAM / Gmsh Aerodynamics",
        version: "24.06",
      },
    }),
    "Drone Chassis CFD — Forward Flight Envelope",
  );

  db.createPost(
    devUser.id,
    "Ran a high-speed forward flight envelope analysis using OpenFOAM 💨 Wind incoming at 15 m/s. The SurfacePressure mapping clearly highlights the stagnation points on the front chassis nose and leading arm edges. You can also visualize the aerodynamic velocity boundary slip! Very slippery geometry! 🚀",
    viewId,
  );

  console.log("✅ Seeded Drone CFD simulation result post!");
  generateThumbnail(viewId).catch(console.error);
}

// If run directly
import { fileURLToPath } from "url";
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const database = new LibraryDatabase();
  seedDroneCfd(database);
}
