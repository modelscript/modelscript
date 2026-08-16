import * as esbuild from "esbuild";
import * as fs from "fs";

const patchX6Plugin = {
  name: "patch-x6",
  setup(build) {
    build.onEnd(async () => {
      let code = fs.readFileSync("dist/browser.js", "utf8");
      code = code.replace(
        /node\s*&&\s*node\.tagName\.toUpperCase\(\)/g,
        "node && (node.tagName || node.nodeName || '').toUpperCase()",
      );
      code = code.replace(
        /firstChild\s*&&\s*firstChild\.tagName\.toUpperCase\(\)/g,
        "firstChild && (firstChild.tagName || firstChild.nodeName || '').toUpperCase()",
      );
      fs.writeFileSync("dist/browser.js", code);
      console.log("Patched X6 TextNode tagName handling in dist/browser.js");
    });
  },
};

esbuild
  .build({
    entryPoints: ["src/index.ts"],
    bundle: true,
    outfile: "dist/browser.js",
    format: "esm",
    platform: "browser",
    plugins: [patchX6Plugin],
    define: {
      "process.env.NODE_ENV": '"production"',
    },
  })
  .then(() => {
    console.log("Browser bundle created at dist/browser.js");
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
