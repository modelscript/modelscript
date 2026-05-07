// name: ForStatement2.mo
// keywords:
// status: correct
//
//

model ForStatement2
  Real x[5];
  constant Integer s = 5;
algorithm
  for i in 1:s loop
    x[i] := i;
  end for;
end ForStatement2;

// Result:
// Error processing file: ForStatement2.mo
// Error: Class ForStatement2.mo not found in scope <top>.
// Error: Error occurred while flattening model ForStatement2.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
