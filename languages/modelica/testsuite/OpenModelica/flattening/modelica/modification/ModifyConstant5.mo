// name:     ModifyConstant5
// keywords: scoping,modification
// status:   incorrect
//
// Finalized members can not be redeclared.
//

class A
  final constant Real c = 1.0;
end A;

class B
  A a(redeclare constant Real c = 2.0);
end B;

class C
  A a;
end C;

class ModifyConstant5
  B b;
  C c;
  annotation(__OpenModelica_commandLineOptions="-d=-newInst");
end ModifyConstant5;

// Result:
// Error processing file: ModifyConstant5.mo
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// [OpenModelica/flattening/modelica/modification/ModifyConstant5.mo:13:3-13:39:writable] Notification: From here:
// [OpenModelica/flattening/modelica/modification/ModifyConstant5.mo:9:3-9:30:writable] Error: Redeclaration of final component c is not allowed.
// [OpenModelica/flattening/modelica/modification/ModifyConstant5.mo:13:3-13:39:writable] Notification: From here:
// [OpenModelica/flattening/modelica/modification/ModifyConstant5.mo:9:3-9:30:writable] Error: Redeclaration of constant component c is not allowed.
// Error: Error occurred while flattening model ModifyConstant5
//
// Execution failed!
// endResult
