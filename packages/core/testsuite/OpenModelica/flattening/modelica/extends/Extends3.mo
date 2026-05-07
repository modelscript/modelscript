// name:     Extends3
// keywords: extends basictype operators
// status:   correct
//
// Testing extending basic type and matrix multiplication operators (MC bug #643)

connector RealSignal
  replaceable type SignalType = Real;
  extends SignalType;
end RealSignal;

connector RealInput = input RealSignal;
connector RealOutput = output RealSignal;

block SS
  RealInput u[nin];
  RealOutput y[nout];
  parameter Integer nin=1;
  parameter Integer nout=2;
  parameter Real B[2,1] = {{1},{2}};
equation
  y = B*u;
end SS;



// Result:
// Error processing file: Extends3.mo
// [<interactive>:8:15-8:37:writable] Notification: From here:
// [<interactive>:9:3-9:21:writable] Error: Class 'SignalType' in 'extends SignalType' is replaceable, the base class name must be transitively non-replaceable.
// Error: Error occurred while flattening model SS
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
