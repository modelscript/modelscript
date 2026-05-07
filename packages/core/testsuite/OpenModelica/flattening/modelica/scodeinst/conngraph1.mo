// name: conngraph1.mo
// keywords:
// status: incorrect
//

model A
  connector RealInput = input Real;

  RealInput ri;
equation
  Connections.root(ri);
end A;

// Result:
// Error processing file: conngraph1.mo
// [<interactive>:11:3-11:23:writable] Error: The first argument 'ri' of Connections.root must have the form A.R, where A is a connector and R an over-determined type/record.
// Error: Error occurred while flattening model A
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
