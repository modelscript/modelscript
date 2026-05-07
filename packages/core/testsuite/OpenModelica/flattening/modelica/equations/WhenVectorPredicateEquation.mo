// name:     WhenVectorPredicateEquation
// keywords: when
// status:   correct
//
// Conditional Equations with when-equations
//

class WhenSet
  Real x;
  parameter Real y2 = 3;
  discrete Real y1;
  discrete Real y3;
equation
  x = time - y2;
  when {x > 2, sample(0, 2), x < 5} then
    y1 = sin(x);
    y3 = 2*x + y1 + y2;
  end when;
end WhenSet;

// Result:
// Error processing file: WhenVectorPredicateEquation.mo
// Error: Failed to load package WhenVectorPredicateEquation (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class WhenVectorPredicateEquation not found in scope <top>.
// Error: Error occurred while flattening model WhenVectorPredicateEquation
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
