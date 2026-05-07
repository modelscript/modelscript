// name: mod11.mo
// keywords:
// status: incorrect
//
//

model A
  Real x;
end A;

model B
  extends A(final x);
end B;

model C
  B b(x = 3);
end C;

// Result:
// Error processing file: mod11.mo
// [<interactive>:16:7-16:12:writable] Notification: From here:
// [<interactive>:12:19-12:20:writable] Error: Trying to override final element x with modifier '= 3'.
// Error: Error occurred while flattening model C
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
