import { globSync } from "glob";
import fs from "node:fs";

const files = globSync("**/package.json", { ignore: "**/node_modules/**" });
for (const file of files) {
  try {
    JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    console.error(`Broken file: ${file}`);
    console.error(err);
  }
}
