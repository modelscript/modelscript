// name: ForStatementNonVector.mo
// keywords:
// status: incorrect
//

model ForStatementNonVector
  Real x;
equation
  for i in 1 loop
    x = x;
  end for;
end ForStatementNonVector;

// Result:
// Error processing file: ForStatementNonVector.mo
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// [OpenModelica/flattening/modelica/scodeinst/ForStatementNonVector.mo:9:3-11:10:writable] Error: Type error in iteration range '1'. Expected array got Integer.
//
// Execution failed!
// endResult
