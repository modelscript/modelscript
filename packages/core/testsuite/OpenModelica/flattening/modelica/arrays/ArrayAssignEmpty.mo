// name: ArrayAssignEmpty.mo [BUG: #1907, #2300]
// keywords: Empty arrays used in algorithm
// status:   correct
// #1907

model ArrayAssignEmpty
  function f
    input Real r;
    output Real o[0];
  end f;
  Real r[0];
algorithm
  r := f(time);
end ArrayAssignEmpty;

// Result:
// class Xpowers3
//   parameter Real x = 10.0;
//   Real xpowers[1];
//   Real xpowers[2];
//   Real xpowers[3];
//   Real xpowers[4];
//   Real xpowers[5];
//   Real xpowers[6];
//   final parameter Integer n = 5;
// equation
//   xpowers[1] = 1.0;
//   xpowers[2] = xpowers[1] * x;
//   xpowers[3] = xpowers[2] * x;
//   xpowers[4] = xpowers[3] * x;
//   xpowers[5] = xpowers[4] * x;
//   xpowers[6] = xpowers[5] * x;
// end Xpowers3;
// endResult
