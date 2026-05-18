export interface SimulationResult {
  /** Time vector */
  t: number[];
  /** State matrix [time_step][state_index] */
  y: number[][];
  /** Names of the states/variables corresponding to the columns of y */
  states: string[];
  /** Optional parameter info passed back from the simulator */
  parameters?: { name: string; value: number | string | boolean }[];
}
