// name:     ModifyConstant6
// keywords: scoping,modification
// status:   incorrect
//
// Finalized constants can not be modified.
//

class A
  final constant Real c = 1.0;
end A;

class B
  A a(c = 2.0);
end B;

class C
  A a;
end C;

class ModifyConstant6
  B b;
  C c;
  annotation(__OpenModelica_commandLineOptions="-d=-newInst");
end ModifyConstant6;


// Result:
// Error processing file: ModifyConstant6.mo
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// [OpenModelica/flattening/modelica/modification/ModifyConstant6.mo:9:3-9:30:writable] Notification: From here:
// [OpenModelica/flattening/modelica/modification/ModifyConstant6.mo:13:7-13:14:writable] Error: Trying to override final element c with modifier ' = 2.0'.
// Error: Error occurred while flattening model ModifyConstant6
//
// Execution failed!
// endResult
