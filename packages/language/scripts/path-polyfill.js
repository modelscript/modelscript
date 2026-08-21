export function resolve(...args) {
  return args.filter(Boolean).join("/").replace(/\/+/g, "/");
}
export function join(...args) {
  return args.filter(Boolean).join("/").replace(/\/+/g, "/");
}
export function dirname(p) {
  const parts = p.split("/");
  parts.pop();
  return parts.join("/") || "/";
}
export function basename(p) {
  return p.split("/").pop() || "";
}
export function extname(p) {
  const base = basename(p);
  const idx = base.lastIndexOf(".");
  return idx > 0 ? base.slice(idx) : "";
}
export default { resolve, join, dirname, basename, extname };
