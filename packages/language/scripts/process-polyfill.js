export const process = {
  env: {},
  cwd: () => "/",
  platform: "browser",
  pid: 1,
  version: "v18.0.0",
  argv: ["node", "script"],
  nextTick: (cb) => setTimeout(cb, 0),
};
