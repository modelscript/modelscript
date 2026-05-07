// name: ClassExtends2.mo
// keywords:
// status: correct
//
// Checks that class extends without redeclare works, although with a warning
// since it was deprecated in Modelica 3.4.
//

model A
  replaceable model M1
    Real x;
  end M1;

  replaceable model M2
    Real x;
  end M2;

  M1 m1_a;
  M2 m2_a;
end A;

model ClassExtends2
  extends A;

  model extends M1
    Real y;
  end M1;

  redeclare model extends M2
    Real y;
  end M2;

  M1 m1_b;
  M2 m2_b;
end ClassExtends2;

// Result:
// Error processing file: ClassExtends2.mo
// [OpenModelica/flattening/modelica/scodeinst/ClassExtends2.mo:25:3-27:9:writable] Warning: Missing redeclare prefix on class extends M1, treating like redeclare anyway.
// Error: Class ClassExtends2.mo not found in scope <top>.
// Error: Error occurred while flattening model ClassExtends2.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
