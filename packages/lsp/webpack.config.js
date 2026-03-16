/* eslint-disable no-undef */
//@ts-check
"use strict";

/** @typedef {import('webpack').Configuration} WebpackConfig **/

const path = require("path");

/** @type WebpackConfig */
const browserServerConfig = {
  context: __dirname,
  mode: "none",
  target: "webworker",
  entry: {
    browserServerMain: "./src/browserServerMain.ts",
  },
  output: {
    filename: "[name].js",
    path: path.join(__dirname, "dist"),
    libraryTarget: "var",
    library: "serverExportVar",
    devtoolModuleFilenameTemplate: "../[resource-path]",
  },
  resolve: {
    mainFields: ["module", "main"],
    extensions: [".ts", ".js"],
    alias: {},
    fallback: {},
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
  performance: {
    hints: false,
  },
  devtool: "nosources-source-map",
};

module.exports = [browserServerConfig];
