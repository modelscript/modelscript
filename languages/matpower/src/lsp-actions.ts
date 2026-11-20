// SPDX-License-Identifier: AGPL-3.0-or-later

export const extractMatpowerTheoryConstraints = async (text: string) => {
  const { parseMatpowerCase } = await import("./index.js");
  const mpc = parseMatpowerCase(text);
  const ns = `MATPOWER::${mpc.caseName || "Case"}`;
  const parameters: any[] = [
    {
      name: "baseMVA",
      fqn: `${ns}::baseMVA`,
      value: mpc.baseMVA,
      rawValueText: String(mpc.baseMVA),
      unit: "MVA",
      line: 1,
      startCol: 1,
      endCol: 8,
    },
  ];
  const ports: any[] = [];
  for (const b of mpc.bus) {
    const bName = `bus_${b.bus_i}`;
    if (Number.isFinite(b.baseKv)) {
      parameters.push({
        name: `${bName}_baseKV`,
        fqn: `${ns}::${bName}.baseKV`,
        value: b.baseKv,
        rawValueText: String(b.baseKv),
        unit: "kV",
        line: 1,
        startCol: 1,
        endCol: 1 + bName.length,
      });
    }
    ports.push({ name: bName, kind: "PowerBus", line: 1 });
  }
  for (let i = 0; i < mpc.gen.length; i++) {
    const g = mpc.gen[i]!;
    if (Number.isFinite(g.pg)) {
      parameters.push({
        name: `gen_${g.bus}_${i + 1}_Pg`,
        fqn: `${ns}::gen_${g.bus}_${i + 1}.Pg`,
        value: g.pg,
        rawValueText: String(g.pg),
        unit: "MW",
        line: 1,
        startCol: 1,
        endCol: 12,
      });
    }
  }
  return { namespaceFqn: ns, parameters, ports };
};
