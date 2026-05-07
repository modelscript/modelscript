// name:     DerConstant2
// keywords: derivative
// status:   incorrect
//
// The argument to der must be a subtype of Real, even when constant.
//

class DerConstant2
  constant Integer pa = 1;
  Real a = der(pa);
end DerConstant2;

// Result:
// class DerConstant2
//   constant Integer pa = 1;
//   Real a = 0.0;
// end DerConstant2;
// [OpenModelica/flattening/modelica/built-in-functions/DerConstant2.mo:9:3-9:26:writable] Warning: Components are deprecated in class.
// [OpenModelica/flattening/modelica/built-in-functions/DerConstant2.mo:10:3-10:19:writable] Warning: Components are deprecated in class.
// endResult
