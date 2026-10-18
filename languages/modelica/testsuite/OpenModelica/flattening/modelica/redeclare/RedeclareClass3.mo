// name:     RedeclareClass3
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

  redeclare replaceable model M2
    Real r;
  end M2;
end P2;

package P3
  extends P2;

  redeclare model M2
    extends P2.M2;
    Real r2;
  end M2;
end P3;

model RedeclareClass3
  P3.M1 m1;
equation
  m1.r = 1.0;
  m2.r2 = 2.0;
  annotation(__OpenModelica_commandLineOptions="-d=-newInst");
end RedeclareClass3;

// Result:
// Error processing file: RedeclareClass3.mo
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// [OpenModelica/flattening/modelica/redeclare/RedeclareClass3.mo:37:3-37:13:writable] Error: Variable m1.r not found in scope RedeclareClass3.
// Error: Error occurred while flattening model RedeclareClass3
//
// Execution failed!
// endResult
