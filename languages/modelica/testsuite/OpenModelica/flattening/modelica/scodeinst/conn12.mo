// name: conn12.mo
// keywords:
// status: correct
//
// FAILREASON: Expandable connector checks are not perfect yet.
//

connector C
  input Real ir;
end C;

expandable connector EC end EC;

model M1
  C c1;
  EC ec;
equation
  connect(c1.ir, ec.ir);
end M1;

model M2
  C c2;
  EC ec;
equation
  connect(c2.ir, ec.ir);
end M2;

model M3
  EC ec;
  M1 m1;
  M2 m2;
equation
  connect(m1.ec, ec);
  connect(m2.ec, ec);
end M3;

// Result:
// Error processing file: conn12.mo
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// [OpenModelica/flattening/modelica/scodeinst/conn12.mo:18:3-18:24:writable] Error: m1.c1.ir is not a valid connector.
//
// Execution failed!
// endResult
