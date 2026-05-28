import { LibraryDatabase } from "./database.js";

const db = new LibraryDatabase().db;
interface ArtifactViewRow {
  id: number;
  view_config: string | null;
}

const rows = db.prepare(`SELECT id, view_config FROM artifact_views`).all() as ArtifactViewRow[];

for (const row of rows) {
  const config = JSON.parse(row.view_config || "{}");
  if (config.thumbnailUrl) {
    delete config.thumbnailUrl;
    delete config.thumbnailUrlLight;
    delete config.thumbnailUrlDark;
    db.prepare(`UPDATE artifact_views SET view_config = ? WHERE id = ?`).run(JSON.stringify(config), row.id);
  }
}
console.log("Cleared all thumbnail URLs.");
