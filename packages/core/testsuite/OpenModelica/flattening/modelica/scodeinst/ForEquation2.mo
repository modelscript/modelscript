// name: ForEquation2.mo
// keywords:
// status: correct
//

model ForEquation2
  Real x[3,3];
equation
  for i in 1:2 loop
    for j in 1:3 loop
      x[i, j] = i*j;
    end for;
  end for;
end ForEquation2;

// Result:
// Error processing file: ForEquation2.mo
// Error: Class ForEquation2.mo not found in scope <top>.
// Error: Error occurred while flattening model ForEquation2.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
