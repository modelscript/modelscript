// name:     ArrayMatrixSimplifier
// keywords: simplify array matrix
// status:   correct
//
// This tests checks that the simplifying process from a[{x,y,z}] simplifies to
// {a[x], a[y], a[z]} and x[{1,2},{3,4}] simplifies to {{x[1,3], x[1,4]}, {x[2,3], x[2,4]}}
//
model ArrayMatrixSimplifier
  parameter Real a[:]={1,1};
  output Real x[size(a, 1) - 1];
  parameter Real u = 3;
  protected
  Real x1;
  Real z[4,4];
  Real q[2,2];
equation
  z[{1,2},{3,4}]=q;
  x1=(u - a[2:size(a, 1)]*pre(x))/a[1];
end ArrayMatrixSimplifier;

// Result:
// Error processing file: ArrayMatrixSimplifier.mo
// [OpenModelica/flattening/modelica/arrays/ArrayMatrixSimplifier.mo:18:3-18:39:writable] Error: Argument 1 of pre must be a discrete expression, but x is continuous.
// Error: Error occurred while flattening model ArrayMatrixSimplifier
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
