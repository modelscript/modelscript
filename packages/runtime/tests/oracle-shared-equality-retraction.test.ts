// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AbstractDomainOracle } from "../src/formal/oracles/abstract_domain_oracle.js";
import { CaeContractOracle } from "../src/formal/oracles/cae_contract_oracle.js";
import { CausalizationTheoryOracle } from "../src/formal/oracles/causalization_oracle.js";
import { ConstraintTheoryOracle } from "../src/formal/oracles/constraint_oracle.js";
import { DIMENSION_LENGTH, DIMENSION_MASS, DimensionalTheoryOracle } from "../src/formal/oracles/dimensional_oracle.js";
import { EntailmentTheoryOracle } from "../src/formal/oracles/entailment_oracle.js";
import { FlowAlgebraOracle } from "../src/formal/oracles/flow_algebra_oracle.js";
import { MarineMooringTheoryOracle } from "../src/formal/oracles/marine_mooring_oracle.js";
import { OntologyTheoryOracle } from "../src/formal/oracles/ontology_oracle.js";
import { PowerGridTheoryOracle } from "../src/formal/oracles/power_grid_oracle.js";
import {
  hasSharedEqualityWithLiteral,
  retainSharedEqualitiesWithoutLiteral,
} from "../src/formal/oracles/retraction_utils.js";
import { SafetyTheoryOracle } from "../src/formal/oracles/safety_theory_oracle.js";
import { SpatialPhysicsOracle } from "../src/formal/oracles/spatial_physics_oracle.js";
import { TelecomTheoryOracle } from "../src/formal/oracles/telecom_oracle.js";
import { ToleranceStackOracle } from "../src/formal/oracles/tolerance_stack_oracle.js";
import { UqTheoryOracle } from "../src/formal/oracles/uq_oracle.js";
import type { SharedEquality, TheoryOracle } from "../src/formal/theory_coordinator.js";

describe("Theory Oracle Shared-Equality Retraction", () => {
  it("identifies and filters justifications across singular and plural SharedEquality fields", () => {
    const eqs: SharedEquality[] = [
      { varA: "a", varB: "b", domain: "real", justifications: [101] },
      { varA: "c", varB: "d", domain: "real", justification: [202] },
      { varA: "e", varB: "f", domain: "real" },
    ];
    assert.strictEqual(hasSharedEqualityWithLiteral(eqs, 101), true);
    assert.strictEqual(hasSharedEqualityWithLiteral(eqs, 202), true);
    assert.strictEqual(hasSharedEqualityWithLiteral(eqs, 303), false);

    const after101 = retainSharedEqualitiesWithoutLiteral(eqs, 101);
    assert.deepStrictEqual(
      after101.map((eq) => eq.varA),
      ["c", "e"],
    );

    const after202 = retainSharedEqualitiesWithoutLiteral(after101, 202);
    assert.deepStrictEqual(
      after202.map((eq) => eq.varA),
      ["e"],
    );
  });

  it("clears indirect sharedEquality conflicts on retractLiteral in CaeContractOracle", () => {
    const oracle = new CaeContractOracle();
    oracle.assertContract({
      contractId: "C1",
      metricName: "max_stress",
      actualValue: 60,
      threshold: 100,
      operator: "<=",
    });
    assert.strictEqual(oracle.checkSat().isSat, true);

    oracle.onSharedEquality({
      varA: "C1.max_stress",
      varB: "C1.max_stress",
      domain: "interval",
      bounds: [0, 50],
      justifications: [999],
    });
    assert.strictEqual(oracle.checkSat().isSat, false);

    oracle.retractLiteral(999);
    assert.strictEqual(oracle.checkSat().isSat, true);
  });

  it("clears indirect sharedEquality conflicts on retractLiteral in DimensionalTheoryOracle", () => {
    const oracle = new DimensionalTheoryOracle();
    oracle.assertLiteral({ id: 1, predicate: "dimension", args: ["m", DIMENSION_MASS], isNegated: false });
    oracle.assertLiteral({ id: 2, predicate: "dimension", args: ["L", DIMENSION_LENGTH], isNegated: false });
    assert.strictEqual(oracle.checkSat().isSat, true);

    oracle.onSharedEquality({
      varA: "m",
      varB: "L",
      domain: "real",
      justifications: [999],
    });
    assert.strictEqual(oracle.checkSat().isSat, false);

    oracle.retractLiteral(999);
    assert.strictEqual(oracle.checkSat().isSat, true);
  });

  it("clears indirect sharedEquality conflicts on retractLiteral in PowerGridTheoryOracle", () => {
    const oracle = new PowerGridTheoryOracle();
    oracle.assertBusVoltage({ busId: 1, actualVm: 1.02, minVm: 0.95, maxVm: 1.05 });
    assert.strictEqual(oracle.checkSat().isSat, true);

    oracle.onSharedEquality({
      varA: "grid.bus_voltage.1",
      varB: "grid.bus_voltage.1",
      domain: "interval",
      bounds: [0.98, 1.0],
      justifications: [999],
    });
    assert.strictEqual(oracle.checkSat().isSat, false);

    oracle.retractLiteral(999);
    assert.strictEqual(oracle.checkSat().isSat, true);
  });

  it("clears indirect sharedEquality conflicts on retractLiteral in OntologyTheoryOracle", () => {
    const oracle = new OntologyTheoryOracle();
    oracle.assertLiteral({ id: 1, predicate: "differentIndividuals", args: ["indA", "indB"], isNegated: false });
    assert.strictEqual(oracle.checkSat().isSat, true);

    oracle.onSharedEquality({
      varA: "indA",
      varB: "indB",
      domain: "concept",
      justifications: [999],
    });
    assert.strictEqual(oracle.checkSat().isSat, false);

    oracle.retractLiteral(999);
    assert.strictEqual(oracle.checkSat().isSat, true);
  });

  it("purges retracted sharedEquality while preserving surviving ones in AbstractDomainOracle", () => {
    const oracle = new AbstractDomainOracle();
    oracle.onSharedEquality({
      varA: "x",
      varB: "x",
      domain: "interval",
      bounds: [10, 20],
      justifications: [888],
    });
    oracle.onSharedEquality({
      varA: "x",
      varB: "x",
      domain: "interval",
      bounds: [0, 5],
      justifications: [999],
    });
    assert.strictEqual(oracle.checkSat().isSat, false);

    oracle.retractLiteral(999);
    assert.strictEqual(oracle.checkSat().isSat, true);
    assert.deepStrictEqual(oracle.getModel().x, [10, 20]);
  });

  it("purges indirect sharedEqualities and preserves remaining ones across all 15 theory oracles", () => {
    const oracles: TheoryOracle[] = [
      new AbstractDomainOracle(),
      new CaeContractOracle(),
      new CausalizationTheoryOracle(),
      new ConstraintTheoryOracle(),
      new DimensionalTheoryOracle(),
      new EntailmentTheoryOracle(),
      new FlowAlgebraOracle(),
      new MarineMooringTheoryOracle(),
      new OntologyTheoryOracle(),
      new PowerGridTheoryOracle(),
      new SafetyTheoryOracle(),
      new SpatialPhysicsOracle(),
      new TelecomTheoryOracle(),
      new ToleranceStackOracle(),
      new UqTheoryOracle(),
    ];

    for (const oracle of oracles) {
      oracle.onSharedEquality({
        varA: "kept_var_a",
        varB: "kept_var_b",
        domain: "interval",
        bounds: [1, 2],
        justification: [888],
      });
      oracle.onSharedEquality({
        varA: "retracted_var_a",
        varB: "retracted_var_b",
        domain: "interval",
        bounds: [3, 4],
        justifications: [999],
      });

      oracle.retractLiteral(999);

      const remaining = (oracle as unknown as { sharedEqualities: SharedEquality[] }).sharedEqualities ?? [];
      assert.strictEqual(remaining.length, 1, `${oracle.name} should keep exactly the non-retracted sharedEquality`);
      assert.strictEqual(remaining[0]?.varA, "kept_var_a", `${oracle.name} should purge the sharedEquality citing 999`);
    }
  });
});
