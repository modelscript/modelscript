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
end ModifyConstant5;

// Result:
// class ModifyConstant5
//   constant Real b.a.c = 2.0;
//   final constant Real c.a.c = 1.0;
// end ModifyConstant5;
// [OpenModelica/flattening/modelica/modification/ModifyConstant5.mo:9:3-9:30:writable] Warning: Components are deprecated in class.
// [OpenModelica/flattening/modelica/modification/ModifyConstant5.mo:13:3-13:39:writable] Warning: Components are deprecated in class.
// [OpenModelica/flattening/modelica/modification/ModifyConstant5.mo:9:3-9:30:writable] Warning: Components are deprecated in class.
// [OpenModelica/flattening/modelica/modification/ModifyConstant5.mo:17:3-17:6:writable] Warning: Components are deprecated in class.
// [OpenModelica/flattening/modelica/modification/ModifyConstant5.mo:21:3-21:6:writable] Warning: Components are deprecated in class.
// [OpenModelica/flattening/modelica/modification/ModifyConstant5.mo:22:3-22:6:writable] Warning: Components are deprecated in class.
// endResult
