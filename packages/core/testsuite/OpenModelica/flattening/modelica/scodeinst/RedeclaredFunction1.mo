// name: RedeclareFunction1
// keywords:
// status: correct
//

package P
  replaceable function f
  end f;
end P;

function f
  input Real x;
  output Real y;
algorithm
  x := y;
end f;

model RedeclareFunction1
  package P = .P(redeclare function f = .f);
  Real x = P.f(4);
end RedeclareFunction1;

// Result:
// Error processing file: RedeclaredFunction1.mo
// [OpenModelica/flattening/modelica/scodeinst/RedeclaredFunction1.mo:15:3-15:9:writable] Error: Trying to assign to input component x.
// Error: Error occurred while flattening model RedeclareFunction1
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
