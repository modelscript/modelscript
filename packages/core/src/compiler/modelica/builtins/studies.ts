// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Built-in standard library for ModelScript Studies.
 * This defines the base configuration schemas that solvers expect.
 */
export const MODELSCRIPT_STUDIES_PACKAGE = `
package ModelScript
  package Studies "Standard Simulation and Analysis configurations"

    record TransientSimulation "Configuration for standard time-domain ODE/DAE simulation"
      parameter Real startTime = 0.0 "Simulation start time";
      parameter Real stopTime = 1.0 "Simulation stop time";
      parameter Real tolerance = 1e-6 "Solver relative tolerance";
      parameter String solver = "dopri5" "Integration algorithm";
      parameter Real stepSize = 0.0 "Fixed step size (0 = variable)";
    end TransientSimulation;

    record StaticStructuralFEA "Configuration for Static Structural Finite Element Analysis"
      parameter Real meshResolution = 0.1 "Target maximum edge length for meshing";
      parameter Integer elementOrder = 2 "Polynomial order of the finite elements (1 or 2)";
      parameter Real tolerance = 1e-6 "Solver convergence tolerance";
    end StaticStructuralFEA;

    record MonteCarlo "Configuration for Monte Carlo Parameter Sweeps"
      parameter Integer iterations = 100 "Number of samples to run";
      parameter Integer seed = 42 "Random number generator seed";
      parameter Boolean parallel = true "Run samples in parallel";
    end MonteCarlo;

  end Studies;
end ModelScript;
`;
