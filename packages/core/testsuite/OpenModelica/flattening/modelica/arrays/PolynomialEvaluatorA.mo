// name:     PolynomialEvaluatorA
// keywords:
// status:   correct
//


block PolynomialEvaluator
  parameter Real c[:];
  input Real x;
  output Real y;
protected
  parameter Integer n = size(c, 1) - 1;
  Real xpowers[n + 1];
equation
  xpowers[1] = 1;
  for i in 1:n loop
    xpowers[i + 1] = xpowers[i]*x;
  end for;
  y = c[1] * xpowers[n + 1];
end PolynomialEvaluator;

class PolyEvaluate1
  Real p;
  PolynomialEvaluator polyeval(c = {1, 2, 3, 4});
equation
  polyeval.x = time;
  p = polyeval.y;              // p gets the result
end PolyEvaluate1;

// Result:
// Error processing file: PolynomialEvaluatorA.mo
// Error: Failed to load package PolynomialEvaluatorA (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class PolynomialEvaluatorA not found in scope <top>.
// Error: Error occurred while flattening model PolynomialEvaluatorA
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
