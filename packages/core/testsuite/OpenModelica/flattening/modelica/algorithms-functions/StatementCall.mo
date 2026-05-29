// name:     StatementCall
// keywords: multiple results, algorithm
// status:   correct
//
// Computes cartesian coordinates of a point
//
// Drmodelica: 9.2 Multiple Results (p. 302)
//
function PointOnCircle
  input Real angle "Angle in radians";
  input Real radius;
  output Real x; // 1:st result formal parameter
  output Real y; // 2:nd result formal parameter
algorithm
  x := radius*Modelica.Math.cos(angle);
  y := radius*Modelica.Math.sin(angle);
end PointOnCircle;

class StatementCall
  Real px, py;
algorithm
  (px, py) := PointOnCircle(1.2, 2);
  annotation(__OpenModelica_commandLineOptions="-d=-newInst");
end StatementCall;

// Result:
// Error processing file: StatementCall.mo
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// [OpenModelica/flattening/modelica/algorithms-functions/StatementCall.mo:15:3-15:39:writable] Error: Class Modelica.Math.cos not found in scope PointOnCircle (looking for a function or record).
// Error: Error occurred while flattening model StatementCall
//
// Execution failed!
// endResult
