// name:     IfEquation
// keywords: if
// status:   correct
//
// Drmodelica: 8.2 Conditional Equations with if-Equations (p. 245)
//


class IfEquation
  parameter Real u;
  parameter Real uMax;
  parameter Real uMin;
  Real y;
equation
  if u > uMax then
    y = uMax;
  elseif u < uMin then
    y = uMin;
  else
    y = u;
  end if;
end IfEquation;

model Test
  IfEquation y1(u = 1.0, uMax = 2.0, uMin = 0.0);
  IfEquation y2(u = 0.0, uMax = 2.0, uMin = 0.0);
  IfEquation y3(u = 3.0, uMax = 2.0, uMin = 0.0);
end Test;

// Result:
// Error processing file: IfEquation.mo
// [OpenModelica/flattening/modelica/equations/IfEquation.mo:10:3-10:19:writable] Warning: Components are deprecated in class.
// [OpenModelica/flattening/modelica/equations/IfEquation.mo:11:3-11:22:writable] Warning: Components are deprecated in class.
// [OpenModelica/flattening/modelica/equations/IfEquation.mo:12:3-12:22:writable] Warning: Components are deprecated in class.
// [OpenModelica/flattening/modelica/equations/IfEquation.mo:13:3-13:9:writable] Warning: Components are deprecated in class.
// [OpenModelica/flattening/modelica/equations/IfEquation.mo:15:3-21:9:writable] Warning: Equation sections are deprecated in class.
// [OpenModelica/flattening/modelica/equations/IfEquation.mo:10:3-10:19:writable] Error: Parameter u has neither value nor start value, and is fixed during initialization (fixed=true).
// Error: Error occurred while flattening model IfEquation
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
