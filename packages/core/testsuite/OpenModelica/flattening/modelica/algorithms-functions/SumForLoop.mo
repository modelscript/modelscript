// name:     SumForLoop
// keywords: for statment
// status:   correct
//
// for statment handling
//
// Drmodelica: 9.1 for-Statement (p.288)
//
model SumZ
  parameter Integer n = 5;
  parameter Real[n] z = {10, 20, 30, 40, 50};
  Real sum(start = 0);
algorithm
  sum := 0;
  for i in 1:n loop
    sum := sum + z[i];
  end for;
end SumZ;

// Result:
// Error processing file: SumForLoop.mo
// Error: Failed to load package SumForLoop (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class SumForLoop not found in scope <top>.
// Error: Error occurred while flattening model SumForLoop
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
