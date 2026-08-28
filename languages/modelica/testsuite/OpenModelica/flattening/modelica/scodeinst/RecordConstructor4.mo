// name: RecordConstructor4
// keywords:
// status: correct
//
//

record R
  parameter Real x(start = 1.0);
end R;

model RecordConstructor4
  R r;
equation
  r = R(time);
end RecordConstructor4;

// Result:
// function R "Automatically generated record constructor for R"
//   input Real x;
//   output R res;
// end R;
//
// class RecordConstructor4
//   parameter Real r.x(start = 1.0);
// equation
//   r = R(time);
// end RecordConstructor4;
// endResult
