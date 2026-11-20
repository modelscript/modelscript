// SPDX-License-Identifier: AGPL-3.0-or-later

export const extractCanteraTheoryConstraints = async (text: string) => {
  const { parseCantera } = await import("./index.js");
  const doc = parseCantera(text);
  const ns = `Cantera::${doc.mechanism?.name || "Mechanism"}`;
  const parameters: any[] = [];
  parameters.push({
    name: "speciesCount",
    fqn: `${ns}::speciesCount`,
    value: doc.mechanism?.species?.size ?? 0,
    rawValueText: String(doc.mechanism?.species?.size ?? 0),
    unit: "",
    line: 1,
    startCol: 1,
    endCol: 13,
  });
  parameters.push({
    name: "reactionCount",
    fqn: `${ns}::reactionCount`,
    value: doc.mechanism?.reactions?.length ?? 0,
    rawValueText: String(doc.mechanism?.reactions?.length ?? 0),
    unit: "",
    line: 1,
    startCol: 1,
    endCol: 14,
  });
  return { namespaceFqn: ns, parameters, ports: [] };
};
