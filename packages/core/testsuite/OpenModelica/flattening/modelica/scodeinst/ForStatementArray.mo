// name: ForStatementArray.mo
// keywords:
// status: correct
//
//

model ForStatementArray
  Real x[5];
algorithm
  for i in {1, 2, 3, 4, 5} loop
    x[i] := i;
  end for;
end ForStatementArray;

// Result:
// Error processing file: ForStatementArray.mo
// Error: Class ForStatementArray.mo not found in scope <top>.
// Error: Error occurred while flattening model ForStatementArray.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
