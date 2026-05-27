/**
 * Seed script: Create a drone FEA simulation result post.
 *
 * Reads the generated VTU file for the drone chassis and creates a social post
 * with the simulation-result artifact type.
 *
 * Usage:
 *   cd apps/api && npx tsx src/seed-drone-fea.ts
 */

import fs from "fs";
import { LibraryDatabase } from "./database.js";
import { generateThumbnail } from "./workers/thumbnailWorker.js";

// ── Seed ─────────────────────────────────────────────────────────

export async function seedDroneFea(db: LibraryDatabase) {
  const devUser = db.getUserByUsername("dev");

  if (!devUser) {
    console.error("No 'dev' user found. Run test-reset.ts first.");
    return;
  }

  const vtuPath = "/home/omar/git/modelscript/packages/examples/drone-chassis/drone_fea.vtu";
  if (!fs.existsSync(vtuPath)) {
    console.error(`VTU file not found at ${vtuPath}`);
    console.error("Run the python FEA script first!");
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
        vonMisesStress: "Pa",
        DisplacementZ: "m",
      },
      solverInfo: {
        name: "CalculiX / Gmsh Python Runner",
        version: "1.0",
      },
    }),
    "Drone Chassis FEA — Max Thrust Load",
  );

  db.createPost(
    devUser.id,
    "Completed static structural analysis on the drone chassis design 🚁 Simulation of full-thrust bending loads. The von Mises stress map shows concentration near the central core joints, but it remains well below the yielding threshold for our carbon fiber composite. Check out the interactive 3D VTU viewer below! 📊",
    viewId,
  );

  console.log("✅ Seeded Drone FEA simulation result post!");
  generateThumbnail(viewId).catch(console.error);
}

// If run directly
import { fileURLToPath } from "url";
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const database = new LibraryDatabase();
  seedDroneFea(database);
}
