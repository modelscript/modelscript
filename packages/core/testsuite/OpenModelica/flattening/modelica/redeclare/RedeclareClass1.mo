// name:     RedeclareClass2
// keywords: redeclare class
// status:   correct
//
// Tests simple redeclaration of inherited classes.
//

package P1
  replaceable model M
  end M;
end P1;

package P2
  extends P1;

  redeclare model M
    Real r;
  end M;
end P2;

model RedeclareClass1
  P1.M m1;
  P2.M m2;
equation
  m2.r = 1.0;
end RedeclareClass1;

// Result:
// Error processing file: RedeclareClass1.mo
// Error: Failed to load package RedeclareClass2 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class RedeclareClass2 not found in scope <top>.
// Error: Error occurred while flattening model RedeclareClass2
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
