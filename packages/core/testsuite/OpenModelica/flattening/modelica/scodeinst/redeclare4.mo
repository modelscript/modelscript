// name: redeclare4.mo
// keywords:
// status: correct
//


type T1 = Real(start = 1.0);
type T2 = Real(start = 2.0);

model A
  replaceable T1 x;
  replaceable T1 y;
end A;

model B
  A a(redeclare T2 x, y);
end B;

model C
  extends B(a.x = 3);
end C;

// Result:
// Error processing file: redeclare4.mo
// Error: Failed to load package redeclare4 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class redeclare4.mo not found in scope <top>.
// Error: Error occurred while flattening model redeclare4.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
