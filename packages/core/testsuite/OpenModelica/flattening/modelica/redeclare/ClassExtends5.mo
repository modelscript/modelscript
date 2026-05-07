// name: ClassExtends4
// keywords: class, extends
// status: correct
//
// Checks that repeated class extends are handled correctly.
//

class P1
  replaceable class C Real r1; end C;
  C c1;
end P1;

class P2
  extends P1;
  redeclare replaceable class extends C Real r2; end C;
  C c2;
end P2;

class P3
  extends P2;
  redeclare class extends C Real r3; end C;

  C c3;
end P3;

// Result:
// Error processing file: ClassExtends5.mo
// Error: Failed to load package ClassExtends4 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class ClassExtends4 not found in scope <top>.
// Error: Error occurred while flattening model ClassExtends4
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
