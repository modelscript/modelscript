// name: FunctionUnitialized4
// keywords:
// status: correct
//
//

model FunctionUnitialized4
  partial function pf
    input Real x;
    output Real y;
  end pf;

  function f
    extends pf;
  end f;

  Real x = f(time);
end FunctionUnitialized4;

// Result:
// function FunctionUnitialized4.f
//   input Real x;
//   output Real y;
// end FunctionUnitialized4.f;
//
// class FunctionUnitialized4
//   Real x = FunctionUnitialized4.f(time);
// end FunctionUnitialized4;
// endResult
