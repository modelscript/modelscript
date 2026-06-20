import * as esbuild from "esbuild";

// We want to bundle `@modelscript/language` into a single file for the browser.
// We must externalize 'typescript' because it's too large to bundle easily and we might not need it in the browser if we only generate ASTs/WASM,
// OR if the user wants full generation in the browser, they might have to load TS via a CDN.
// For the playground, we only need `generateParser` and `generateParserTables`. `generateJavaScriptWrapper` uses `typescript`, so we should probably mock or stub it if it's imported.

esbuild
  .build({
    entryPoints: ["src/index.ts"],
    bundle: true,
    outfile: "dist/browser.js",
    format: "esm",
    platform: "browser",
    external: ["typescript", "fs", "path", "url"], // Externalize node modules just in case
    define: {
      // any node globals we need to mock
    },
  })
  .then(() => {
    console.log("Browser bundle created at dist/browser.js");

    // Also create a standalone, self-hosted ESM bundle of typescript for the playground
    return esbuild.build({
      entryPoints: ["../../node_modules/typescript/lib/typescript.js"],
      bundle: true,
      minify: true,
      outfile: "dist/typescript.mjs",
      format: "esm",
      platform: "browser",
      alias: {
        os: "./scripts/os-polyfill.js",
        fs: "./scripts/fs-polyfill.js",
      },
      define: {
        __filename: '"/"',
        __dirname: '"/"',
      },
      inject: ["./scripts/process-polyfill.js"],
    });
  })
  .then(() => {
    console.log("Self-hosted typescript bundle created at dist/typescript.mjs");
  })
  .catch(() => process.exit(1));
