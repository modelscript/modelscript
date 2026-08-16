import type { Config } from "jest";

const config: Config = {
  clearMocks: true,
  coverageProvider: "v8",
  moduleNameMapper: {
    "^(\\.\\.?/.+)\\.js$": "$1",
  },
  preset: "ts-jest/presets/default-esm",
  testMatch: ["<rootDir>/tests/**/*.test.[jt]s?(x)"],
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        useESM: true,
      },
    ],
  },
};

export default config;
