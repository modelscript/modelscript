// name:     Vectorizable2
// keywords: vectorized calls
// status:   incorrect
//
// This tests vectorized calls.
//

function foo
  input Real x;
  input Real x2[2];
  output Real y;
algorithm
  y:=x+1+x2[1]+2*x2[2];
end foo;


model Vectorizable2
  Real x[3];
equation
  x=foo({1,2,3},[1,2;3,4;5,6]);
  annotation(__OpenModelica_commandLineOptions="-d=-newInst");
end Vectorizable2;

// function foo
// input Real x;
// input Real x2;
// output Real y;
// algorithm
//   y := x + 1.0 + x2[1] + 2.0 * x2[2];
// end foo;

// Result:
// Error processing file: Vectorizable2.mo
// [flattening/modelica/algorithms-functions/Vectorizable2.mo:20:3-20:31:writable] Error: No matching function found for foo({1, 2, 3}, {{1, 2}, {3, 4}, {5, 6}})
// of type
//   .foo<function>(Integer[3] x, Integer[3, 2] x2) => Real in component <NO COMPONENT>
// candidates are 
//   .foo<function>(Real x, Real[2] x2) => Real
// Error: Error occurred while flattening model Vectorizable2
// endResult
