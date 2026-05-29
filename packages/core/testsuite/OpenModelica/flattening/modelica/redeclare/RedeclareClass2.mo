// name:     RedeclareClass2
// keywords: redeclare class
// status:   correct
//
// Tests simple redeclaration of inherited classes.
//

package P1
  model M1
    M2 m;
  end M1;

  replaceable model M2
  end M2;
end P1;

package P2
  extends P1;

  redeclare model M2
    Real r;
  end M2;
end P2;

model RedeclareClass2
  P2.M1 m1;
equation
  m1.r = 1.0;
  annotation(__OpenModelica_commandLineOptions="-d=-newInst");
end RedeclareClass2;

// Result:
// Error processing file: RedeclareClass2.mo
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// [OpenModelica/flattening/modelica/redeclare/RedeclareClass2.mo:28:3-28:13:writable] Error: Variable m1.r not found in scope RedeclareClass2.
// Error: Error occurred while flattening model RedeclareClass2
//
// Execution failed!
// endResult
