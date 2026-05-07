
// name:     ConnectInner2
// keywords: connect,dynamic scoping
// status:   correct
//
// The inner connector must be declared 'inner'. Generate a warning.
//
connector C
  Real e;
  flow Real f;
end C;
model A
  outer C global;
  C my;
equation
  connect(global,my);
  my.f=10+my.e;
end A;
model B
  A a;
end B;

model ConnectInner2
  C global;
  B b;
  A a;
equation
  global.e=10;
end ConnectInner2;


// Result:
// Error processing file: ConnectInner2.mo
// [OpenModelica/flattening/modelica/connectors/ConnectInner2.mo:24:3-24:11:writable] Notification: From here:
// [OpenModelica/flattening/modelica/connectors/ConnectInner2.mo:13:3-13:17:writable] Error: An inner declaration for outer element 'global' could not be found, and could not be automatically generated due to an existing declaration of that name.
// Error: Error occurred while flattening model ConnectInner2
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
