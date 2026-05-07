// name: VectorizeBindings1
// keywords:
// status: correct
//

model M
  parameter Real p = 1;
  parameter Real q = 2;
end M;

model VectorizeBindings1
  parameter Real p = 2;
  M m[2,3](each p = 2*p);
end VectorizeBindings1;

// Result:
// class VectorizeBindings1
//   parameter Real p = 2.0;
//   parameter Real m[1,1].p = 2.0 * p;
//   parameter Real m[1,1].q = 2.0;
//   parameter Real m[1,2].p = 2.0 * p;
//   parameter Real m[1,2].q = 2.0;
//   parameter Real m[1,3].p = 2.0 * p;
//   parameter Real m[1,3].q = 2.0;
//   parameter Real m[2,1].p = 2.0 * p;
//   parameter Real m[2,1].q = 2.0;
//   parameter Real m[2,2].p = 2.0 * p;
//   parameter Real m[2,2].q = 2.0;
//   parameter Real m[2,3].p = 2.0 * p;
//   parameter Real m[2,3].q = 2.0;
// end VectorizeBindings1;
// endResult
