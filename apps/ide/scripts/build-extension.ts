import { buildIdeExtension } from "@modelscript/dsl";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, "..", "dist", "extension");

console.log(`Building IDE extension into ${outDir}...`);
await buildIdeExtension(outDir);
console.log("IDE extension built successfully!");
