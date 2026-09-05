// name:     ModifyConstant4
// keywords: scoping,modification
// status:   incorrect
//
// Only members may be modified.
//

class A
  constant Real c = 1.0;
end A;

class B
  A a(A.c = 2.0);
end B;

class C
  A a;
end C;

class ModifyConstant4
  B b;
  C c;
  annotation(__OpenModelica_commandLineOptions="-d=-newInst");
end ModifyConstant4;
// Result:
// Error processing file: ModifyConstant4.mo
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// [OpenModelica/flattening/modelica/modification/ModifyConstant4.mo:13:7-13:16:writable] Error: Modified element A.c not found in class A.
// Error: Error occurred while flattening model ModifyConstant4
//
// Execution failed!
// endResult
