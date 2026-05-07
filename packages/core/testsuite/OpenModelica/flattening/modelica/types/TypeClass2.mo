// name: TypeClass2
// keywords: type
// status: incorrect
//
// Tests type declaration from a regular class, should be illegal
//

class IllegalClass
  Integer i;
end IllegalClass;

type IllegalType = IllegalClass;

model TypeClass2
  IllegalType it;
equation
  it.i = 1;
end TypeClass2;
// Result:
// class TypeClass2
// equation
//   it.i = 1;
// end TypeClass2;
// [OpenModelica/flattening/modelica/types/TypeClass2.mo:9:3-9:12:writable] Warning: Components are deprecated in class.
// endResult
