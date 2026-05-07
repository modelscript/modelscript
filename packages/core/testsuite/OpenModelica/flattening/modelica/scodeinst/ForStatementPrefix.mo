// name: ForStatementPrefix.mo
// keywords:
// status: correct
//
// Checks that for loop iterators are not prefixed.
//

model A
  Real x[5];
algorithm
  for i in 1:5 loop
    x[i] := i;
  end for;
end A;

model ForStatementPrefix
  A a;
end ForStatementPrefix;

// Result:
// Error processing file: ForStatementPrefix.mo
// Error: Class ForStatementPrefix.mo not found in scope <top>.
// Error: Error occurred while flattening model ForStatementPrefix.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
