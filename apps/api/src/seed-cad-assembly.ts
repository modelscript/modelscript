/**
 * Seed script: Create a CAD Assembly artifact post.
 *
 * Copies a sample STEP file to the uploads directory and creates a social post
 * with the cad-step artifact type.
 *
 * Usage:
 *   cd apps/api && npx tsx src/seed-cad-assembly.ts
 */

import fs from "fs";
import path from "path";
import { LibraryDatabase } from "./database.js";
import { generateThumbnail } from "./workers/thumbnailWorker.js";

// ── Seed ─────────────────────────────────────────────────────────

export async function seedCadAssembly(db: LibraryDatabase) {
  const devUser = db.getUserByUsername("dev");

  if (!devUser) {
    console.error("No 'dev' user found. Run test-reset.ts first.");
    return;
  }

  const candidatePaths = [
    path.resolve(process.cwd(), "packages/examples/drone-chassis/cad/drone.step"),
    path.resolve(process.cwd(), "../../packages/examples/drone-chassis/cad/drone.step"),
    path.resolve(import.meta.dirname, "../../../packages/examples/drone-chassis/cad/drone.step"),
  ];
  const stepSourcePath = candidatePaths.find((p) => fs.existsSync(p));
  if (!stepSourcePath) {
    console.warn("[seedCadAssembly] drone.step not found in candidate paths, skipping CAD seed.");
    return;
  }

  // Define upload destination
  const uploadsDir = path.join(process.cwd(), "uploads", "cad");
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  // Use deterministic filename to avoid recreating files with timestamps on every boot
  const filename = "drone_assembly.step";
  const destPath = path.join(uploadsDir, filename);

  // Copy file so it can be served if not already present
  if (!fs.existsSync(destPath)) {
    fs.copyFileSync(stepSourcePath, destPath);
  }

  // Create the artifact view
  const viewId = db.createArtifactView(
    devUser.id,
    "cad-step",
    "inline",
    JSON.stringify({
      url: `/uploads/cad/${filename}`,
    }),
    "Drone Chassis STEP Assembly",
  );

  db.createPost(
    devUser.id,
    "Just finished modeling the primary structural assembly for the quadcopter drone! 🚀 The STEP file includes all the motor mounts and the central hub. I've broken the components apart using our new assembly viewer explosion feature so you can see how everything fits together. Let me know what you think of the clearances! 🚁",
    viewId,
  );

  console.log("✅ Seeded CAD Assembly post!");
  generateThumbnail(viewId).catch(console.error);
}

// If run directly
import { fileURLToPath } from "url";
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const database = new LibraryDatabase();
  seedCadAssembly(database);
}
