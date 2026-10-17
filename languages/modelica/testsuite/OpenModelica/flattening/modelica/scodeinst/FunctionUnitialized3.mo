// name: FunctionUnitialized3
// keywords:
// status: correct
//
//

model FunctionUnitialized3
  Real y = f(time);

  function f
    input Real x;
    output Real y;
  end f;
end FunctionUnitialized3;

// Result:
// function FunctionUnitialized3.f
//   input Real x;
//   output Real y;
// end FunctionUnitialized3.f;
//
// class FunctionUnitialized3
//   Real y = FunctionUnitialized3.f(time);
// end FunctionUnitialized3;
// endResult
