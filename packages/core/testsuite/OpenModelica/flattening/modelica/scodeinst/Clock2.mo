// name: Clock2
// keywords:
// status: incorrect
//

model Clock
  Real t;
end Clock;

model Clock2
  Clock c;
end Clock2;

// Result:
// function R "Automatically generated record constructor for R"
//   input Real[:] x;
//   output R res;
// end R;
//
// function f
//   input Real x;
//   output R r;
// end f;
//
// class DimUnknown14
//   parameter Real y(fixed = false);
//   parameter Real r.x[1](fixed = false);
//   parameter Real r.x[2](fixed = false);
//   parameter Real r.x[3](fixed = false);
//   Real x[1];
//   Real x[2];
//   Real x[3];
// initial equation
//   r = f(y);
// equation
//   x = r.x;
// end DimUnknown14;
// endResult
