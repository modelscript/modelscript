// SPDX-License-Identifier: AGPL-3.0-or-later

export interface IpoptResult {
  status: string;
  objectiveValue: number;
  variables: Record<string, number[]>;
}

export class IpoptSolver {
  constructor(public modelDllPath: string) {}

  public async solve(): Promise<IpoptResult> {
    // Stub implementation
    // Future work will load the DLL via ffi-napi or as WASM
    // and invoke the IpStdCInterface callbacks
    console.log(`[IpoptSolver] Solving model using ${this.modelDllPath}`);
    return {
      status: "STUB_SOLVED_SUCCESS",
      objectiveValue: 0.0,
      variables: {},
    };
  }
}
