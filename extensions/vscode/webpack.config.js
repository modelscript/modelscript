/* eslint-disable no-undef */
/* eslint-disable @typescript-eslint/no-var-requires */
//@ts-check
"use strict";

/** @typedef {import('webpack').Configuration} WebpackConfig **/

const path = require("path");
const CopyPlugin = require("copy-webpack-plugin");
const webpack = require("webpack");
const TerserPlugin = require("terser-webpack-plugin");

/** @type WebpackConfig */
const browserClientConfig = {
  context: __dirname,
  mode: "development",
  target: "webworker",
  entry: {
    browserClientMain: "./src/browserClientMain.ts",
  },
  output: {
    filename: "[name].js",
    path: path.join(__dirname, "dist"),
    libraryTarget: "commonjs",
    devtoolModuleFilenameTemplate: "../[resource-path]",
  },
  resolve: {
    mainFields: ["browser", "module", "main"],
    extensions: [".ts", ".js"],
    alias: {},
    fallback: {
      path: require.resolve("path-browserify"),
    },
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [
          {
            loader: "ts-loader",
          },
        ],
      },
    ],
  },
  externals: {
    vscode: "commonjs vscode",
  },
  plugins: [
    new webpack.DefinePlugin({
      "process.env": JSON.stringify({}),
      "process.browser": JSON.stringify(true),
    }),
    new CopyPlugin({
      patterns: [
        {
          from: path.resolve(__dirname, "..", "..", "node_modules", "web-tree-sitter", "web-tree-sitter.wasm"),
          to: path.join(__dirname, "server", "dist", "web-tree-sitter.wasm"),
        },
        {
          from: path.resolve(__dirname, "..", "..", "languages", "modelica", "tree-sitter-modelica.wasm"),
          to: path.join(__dirname, "server", "dist", "tree-sitter-modelica.wasm"),
        },
        {
          from: path.resolve(__dirname, "..", "..", "languages", "sysml2", "tree-sitter-sysml2.wasm"),
          to: path.join(__dirname, "server", "dist", "tree-sitter-sysml2.wasm"),
        },
        {
          from: path.resolve(__dirname, "..", "..", "languages", "step", "tree-sitter-step.wasm"),
          to: path.join(__dirname, "server", "dist", "tree-sitter-step.wasm"),
        },
        {
          from: path.resolve(__dirname, "..", "..", "node_modules", "occt-import-js", "dist", "occt-import-js.wasm"),
          to: path.join(__dirname, "server", "dist", "occt-import-js.wasm"),
        },
        {
          from: path.resolve(__dirname, "..", "..", "scripts", "ModelicaStandardLibrary_v4.1.0.zip"),
          to: path.join(__dirname, "server", "dist", "ModelicaStandardLibrary_v4.1.0.zip"),
        },
        {
          from: path.resolve(__dirname, "..", "..", "scripts", "SysML-v2-Release-2026-03.zip"),
          to: path.join(__dirname, "server", "dist", "SysML-v2-Release-2026-03.zip"),
        },
        {
          from: path.resolve(__dirname, "..", "..", "packages", "lsp", "dist"),
          to: path.join(__dirname, "server", "dist"),
          force: true,
        },
      ],
    }),
  ],
  performance: {
    hints: false,
  },
  optimization: {
    minimizer: [
      new TerserPlugin({
        terserOptions: {
          keep_classnames: true,
          keep_fnames: true,
        },
      }),
    ],
  },
  devtool: "nosources-source-map",
};

/** @type WebpackConfig */
const webviewConfig = {
  context: __dirname,
  mode: "none",
  target: "web",
  entry: {
    diagramWebview: "./src/webview/diagram.ts",
    simulationWebview: "./src/webview/simulationWebview.ts",
    cosimWebview: "./src/webview/cosimWebview.ts",
    chatWebview: "./src/webview/chatWebview.ts",
    chatWorker: "./src/webview/chatWorker.ts",
    cadWebview: "./src/webview/cadWebview.tsx",
    stepWebview: "./src/webview/stepWebview.tsx",
    analysisWebview: "./src/webview/analysisWebview.ts",
    markdownPreview: "./src/webview/markdownPreview.ts",
  },
  output: {
    filename: "[name].js",
    path: path.join(__dirname, "dist"),
    devtoolModuleFilenameTemplate: "../[resource-path]",
  },
  resolve: {
    mainFields: ["browser", "module", "main"],
    extensions: [".tsx", ".ts", ".js"],
    alias: {},
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        exclude: /node_modules/,
        use: [
          { loader: "ts-loader", options: { configFile: path.resolve(__dirname, "src", "webview", "tsconfig.json") } },
        ],
      },
      {
        test: /\.m?js$/,
        resolve: { fullySpecified: false },
      },
    ],
  },
  performance: {
    hints: false,
  },
  optimization: {
    usedExports: false,
    sideEffects: false,
  },
  devtool: "nosources-source-map",
};

/** @type WebpackConfig */
const notebookRendererConfig = {
  context: __dirname,
  mode: "none",
  target: "web",
  entry: {
    notebookRenderer: "./src/webview/notebookRenderer.ts",
  },
  output: {
    filename: "[name].js",
    path: path.join(__dirname, "dist"),
    library: {
      type: "module",
    },
    devtoolModuleFilenameTemplate: "../[resource-path]",
  },
  experiments: {
    outputModule: true,
  },
  resolve: {
    mainFields: ["browser", "module", "main"],
    extensions: [".tsx", ".ts", ".js"],
    alias: {},
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [
          { loader: "ts-loader", options: { configFile: path.resolve(__dirname, "src", "webview", "tsconfig.json") } },
        ],
      },
      {
        test: /\.m?js$/,
        resolve: { fullySpecified: false },
      },
    ],
  },
  performance: {
    hints: false,
  },
  optimization: {
    usedExports: false,
    sideEffects: false,
  },
  devtool: "nosources-source-map",
};

module.exports = [browserClientConfig, webviewConfig, notebookRendererConfig];
