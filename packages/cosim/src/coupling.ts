// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Variable coupling graph for co-simulation.
 *
 * Defines which output variables from one participant feed into
 * which input variables of another participant.
 */

/** A single variable coupling: one output feeds one input. */
export interface VariableCoupling {
  from: {
    participantId: string;
    variableName: string;
  };
  to: {
    participantId: string;
    variableName: string;
  };
}

/**
 * Coupling graph that manages variable interconnections between participants.
 */
export class CouplingGraph {
  private readonly couplings: VariableCoupling[] = [];

  /** Add a coupling from an output variable to an input variable. */
  addCoupling(coupling: VariableCoupling): void {
    // Validate: no duplicate targets (one input can only receive from one source)
    const existing = this.couplings.find(
      (c) => c.to.participantId === coupling.to.participantId && c.to.variableName === coupling.to.variableName,
    );
    if (existing) {
      throw new Error(
        `Input ${coupling.to.participantId}.${coupling.to.variableName} is already coupled to ${existing.from.participantId}.${existing.from.variableName}`,
      );
    }
    this.couplings.push(coupling);
  }

  /** Remove a coupling. */
  removeCoupling(from: { participantId: string; variableName: string }): void {
    const idx = this.couplings.findIndex(
      (c) => c.from.participantId === from.participantId && c.from.variableName === from.variableName,
    );
    if (idx >= 0) this.couplings.splice(idx, 1);
  }

  /** Get all couplings. */
  getAll(): readonly VariableCoupling[] {
    return this.couplings;
  }

  /** Get all couplings where the given participant is the source (output). */
  getOutputCouplings(participantId: string): VariableCoupling[] {
    return this.couplings.filter((c) => c.from.participantId === participantId);
  }

  /** Get all couplings where the given participant is the target (input). */
  getInputCouplings(participantId: string): VariableCoupling[] {
    return this.couplings.filter((c) => c.to.participantId === participantId);
  }

  /**
   * Apply coupling values: given a map of all participant outputs,
   * produce a map of participant ID → input values to inject.
   */
  applyCouplings(allOutputs: Map<string, Map<string, number>>): Map<string, Map<string, number>> {
    const inputs = new Map<string, Map<string, number>>();

    for (const coupling of this.couplings) {
      const sourceOutputs = allOutputs.get(coupling.from.participantId);
      if (!sourceOutputs) continue;

      const value = sourceOutputs.get(coupling.from.variableName);
      if (value === undefined) continue;

      let targetInputs = inputs.get(coupling.to.participantId);
      if (!targetInputs) {
        targetInputs = new Map<string, number>();
        inputs.set(coupling.to.participantId, targetInputs);
      }
      targetInputs.set(coupling.to.variableName, value);
    }

    return inputs;
  }

  /** Clear all couplings. */
  clear(): void {
    this.couplings.length = 0;
  }
}
