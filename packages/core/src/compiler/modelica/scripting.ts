// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Built-in Modelica class definitions for the scripting API.
 * Parsed by tree-sitter and loaded into the scripting scope, following the
 * same pattern as annotation.ts for the built-in annotation classes.
 */
export const SCRIPTING = `
class Scripting

  record SimulationOptions
    Real startTime "Simulation start time";
    Real stopTime "Simulation stop time";
    Integer numberOfIntervals "Number of output intervals";
    Real tolerance "Integration tolerance";
  end SimulationOptions;

  record SimulationResult
    String resultFile "Path to result file (empty for in-memory)";
    String messages "Simulation messages or error output";
    Real timeValues[:] "Array of time points";
    SimulationOptions simulationOptions "Resolved simulation parameters";
  end SimulationResult;

end Scripting;
`;
