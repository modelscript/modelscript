// name: ForStatement1.mo
// keywords:
// status: correct
//
//

model ForStatement1
  Real x[5];
algorithm
  for i in 1:5 loop
    x[i] := i;
  end for;
end ForStatement1;

// Result:
// Error processing file: ForStatement1.mo
// Error: Class ForStatement1.mo not found in scope <top>.
// Error: Error occurred while flattening model ForStatement1.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
