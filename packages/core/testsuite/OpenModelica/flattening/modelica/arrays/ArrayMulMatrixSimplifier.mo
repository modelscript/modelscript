// name:     ArrayMulMatrixSimplifier
// keywords: Simplifier
// status:   correct
//
// Check si that the multiplication with array * matrix, simplify process works.
// Also tests builtin pre function.
//

model ArrayMulMatrixSimplifier
  parameter Real A[:,size(A, 1)]={{1,0},{0,1}};
  parameter Real B[size(A, 1),:]={{1},{1}};
  output Real x[size(A, 1)];
  output Real y[size(A, 1)];
  Real u[1];

equation
      x= pre(x)*A + B*u;
      y= A*pre(x) + B*u;
end ArrayMulMatrixSimplifier;
// Result:
// Error processing file: ArrayMulMatrixSimplifier.mo
// [OpenModelica/flattening/modelica/arrays/ArrayMulMatrixSimplifier.mo:17:7-17:24:writable] Error: Argument 1 of pre must be a discrete expression, but x is continuous.
// Error: Error occurred while flattening model ArrayMulMatrixSimplifier
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
