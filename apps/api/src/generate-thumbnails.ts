import { LibraryDatabase } from "./database.js";
import { generateThumbnail } from "./workers/thumbnailWorker.js";

const database = new LibraryDatabase();
const db = database.db;

async function main() {
  console.log("Starting thumbnail generation for missing artifacts...");

  // Find all artifacts that are 3D models (simulation or CAD) and lack a thumbnailUrl
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = db.prepare(`SELECT id, view_type, view_config FROM artifact_views`).all() as any[];

  for (const row of rows) {
    if (["simulation-result", "fea-result", "cfd-result", "cad-step", "cad_step"].includes(row.view_type)) {
      const config = JSON.parse(row.view_config || "{}");
      if (!config.thumbnailUrl) {
        console.log(`Generating thumbnail for artifact ${row.id} (${row.view_type})...`);
        const result = await generateThumbnail(row.id);
        if (result) {
          console.log(`Success! Thumbnail saved to ${result}`);
        } else {
          console.log(`Failed to generate thumbnail for artifact ${row.id}.`);
        }
      }
    }
  }

  console.log("Finished generating missing thumbnails.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Error running script:", err);
  process.exit(1);
});
