// SPDX-License-Identifier: AGPL-3.0-or-later

export const MODELSCRIPT_STUDIES_PACKAGE = `
package ModelScript
  package Studies "Built-in study constructs for computational experiments"

  record ParameterStudy "Defines a multidimensional grid sweep over model parameters"
    parameter String modelName = "" "Target model to evaluate";
    parameter Real stopTime = 1.0 "Simulation stop time";
  end ParameterStudy;

  record OptimizationStudy "Defines a mathematical programming optimization problem"
    parameter String modelName = "" "Target model to optimize";
    parameter Real stopTime = 1.0 "Simulation horizon";
    parameter Real tolerance = 1e-4 "Convergence tolerance";
  end OptimizationStudy;

  record MonteCarloStudy "Defines a stochastic sampling / uncertainty quantification study"
    parameter String modelName = "" "Target model to sample";
    parameter Integer samples = 100 "Number of realizations";
    parameter Real stopTime = 1.0 "Simulation stop time";
  end MonteCarloStudy;

  end Studies;
end ModelScript;
`;
