// name: StaticAssertSuccess
// status: correct
class StaticAssertSuccess
algorithm
  assert(true, "assertion failed :D");
  assert(time < 0.5, "assertion failed :D");
end StaticAssertSuccess;

// Result:
// class StaticAssertSuccess
// algorithm
//   assert(true, "assertion failed :D");
//   assert(time < 0.5, "assertion failed :D");
// end StaticAssertSuccess;
// [OpenModelica/flattening/modelica/asserts/StaticAssertSuccess.mo:5:3-5:38:writable] Warning: Algorithm sections are deprecated in class.
// endResult
