// SPDX-License-Identifier: AGPL-3.0-or-later

export function getKindBadgeStyle(
  kind: string,
  allowClassBadge = false,
): { bg: string; color: string; label?: string } | null {
  const k = kind
    .toLowerCase()
    .replace(/^owl2-/, "")
    .replace(/^ontology-/, "");
  if (k === "package" || k === "folder" || (!allowClassBadge && k === "class")) return null;
  switch (k) {
    case "class":
      return { bg: "rgba(231, 76, 60, 0.15)", color: "#ef4444", label: "CLASS" };
    case "definedclass":
    case "defined_class":
      return { bg: "rgba(243, 156, 18, 0.16)", color: "#f59e0b", label: "DEFINED" };
    case "objectproperty":
    case "object-property":
      return { bg: "rgba(52, 152, 219, 0.16)", color: "#3b82f6", label: "OBJ PROP" };
    case "dataproperty":
    case "data-property":
      return { bg: "rgba(46, 204, 113, 0.16)", color: "#10b981", label: "DATA PROP" };
    case "individual":
    case "namedindividual":
      return { bg: "rgba(155, 89, 182, 0.16)", color: "#a855f7", label: "INDIVIDUAL" };
    case "datatype":
      return { bg: "rgba(6, 182, 212, 0.15)", color: "#06b6d4", label: "DATATYPE" };
    case "model":
      return { bg: "rgba(59, 130, 246, 0.15)", color: "#3b82f6", label: "MODEL" };
    case "block":
      return { bg: "rgba(16, 185, 129, 0.15)", color: "#10b981", label: "BLOCK" };
    case "function":
      return { bg: "rgba(245, 158, 11, 0.15)", color: "#f59e0b", label: "FUNC" };
    case "connector":
      return { bg: "rgba(168, 85, 247, 0.15)", color: "#a855f7", label: "CONN" };
    case "record":
      return { bg: "rgba(6, 182, 212, 0.15)", color: "#06b6d4", label: "RECORD" };
    case "type":
      return { bg: "rgba(100, 116, 139, 0.18)", color: "#94a3b8", label: "TYPE" };
    default:
      return null;
  }
}
