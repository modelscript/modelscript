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
// Error: Class ForStatementNonVector.mo not found in scope <top>.
// Error: Error occurred while flattening model ForStatementNonVector.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
