// name: BuiltinAttribute23
// keywords:
// status: correct
//

model BuiltinAttribute23
  parameter Real x0 = 0;
  type T = Real[3] (each start = x0);
  T t;
end BuiltinAttribute23;

// Result:
// class BuiltinAttribute23
//   parameter Real x0 = 0.0;
//   Real t[1](start = x0);
//   Real t[2](start = x0);
//   Real t[3](start = x0);
// end BuiltinAttribute23;
// endResult
