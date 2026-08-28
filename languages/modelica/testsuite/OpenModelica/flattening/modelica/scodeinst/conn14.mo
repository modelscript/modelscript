// name: conn14.mo
// keywords:
// status: correct
//
// FAILREASON: Maybe no correct, see Modelica issue #768.
//

connector C
  Real e;
  flow Real f;
end C;

model A
  parameter C ri1, ri2;
equation
  connect(ri1, ri2);
end A;

// Result:
// Error processing file: conn14.mo
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// [OpenModelica/flattening/modelica/scodeinst/conn14.mo:14:3-14:23:writable] Error: Invalid variability parameter on connector 'ri1'.
//
// Execution failed!
// endResult
