// name: DimSize5
// keywords:
// status: correct
//

record A
  parameter B b;
end A;

record B
  parameter Integer n;
  parameter Real[:] x;
end B;

model DimCyclic5
  parameter A a(b = B(n = 3, x = x));
  parameter Integer n = a.b.n;
  final parameter Real[n] x = {i for i in 1:n};
end DimCyclic5;

// Result:
// Error processing file: DimSize5.mo
// Error: Failed to load package DimSize5 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class DimSize5 not found in scope <top>.
// Error: Error occurred while flattening model DimSize5
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
