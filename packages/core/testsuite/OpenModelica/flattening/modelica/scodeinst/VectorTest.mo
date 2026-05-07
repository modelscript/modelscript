// name: VectorTest
// keywords:
// status: correct
//

package VectorTest  
  constant Integer n = 10;

  function mysum  
    input Real[:] u;
    output Real y;
  algorithm
    y := sum(u);
  end mysum;

  function myfor  
    input Real[:] u;
    input Real[size(u, 1)] previous_x;
    output Real[size(u, 1)] x;
  algorithm
    for i in 1:size(u, 1) loop
      x[i] := previous_x[i] + u[i];
    end for;
  end myfor;

  model m  
    input Real[n] u(each start = 1);
    Real[size(u, 1)] x1;
    Real[size(u, 1)] x2;
    output Real y0;
    output Real y1;
    output Real y2;
  equation
    when Clock() then
      for i in 1:size(u, 1) loop
        x1[i] = previous(x1[i]) + u[i];
      end for;
      x2 = myfor(u, previous(x2));
    end when;
    y0 = sum(u);
    y1 = mysum(u);
    y2 = mysum(x2);
  end m;
end VectorTest;

model VT 
  extends VectorTest.m;
end VT;


// Result:
// function VectorTest.myfor
//   input Real[:] u;
//   input Real[size(u, 1)] previous_x;
//   output Real[size(u, 1)] x;
// algorithm
//   for i in 1:size(u, 1) loop
//     x[i] := previous_x[i] + u[i];
//   end for;
// end VectorTest.myfor;
//
// function VectorTest.mysum
//   input Real[:] u;
//   output Real y;
// algorithm
//   y := sum(u);
// end VectorTest.mysum;
//
// class VT
//   input Real u[1](start = 1.0);
//   input Real u[2](start = 1.0);
//   input Real u[3](start = 1.0);
//   input Real u[4](start = 1.0);
//   input Real u[5](start = 1.0);
//   input Real u[6](start = 1.0);
//   input Real u[7](start = 1.0);
//   input Real u[8](start = 1.0);
//   input Real u[9](start = 1.0);
//   input Real u[10](start = 1.0);
//   Real x1[1];
//   Real x1[2];
//   Real x1[3];
//   Real x1[4];
//   Real x1[5];
//   Real x1[6];
//   Real x1[7];
//   Real x1[8];
//   Real x1[9];
//   Real x1[10];
//   Real x2[1];
//   Real x2[2];
//   Real x2[3];
//   Real x2[4];
//   Real x2[5];
//   Real x2[6];
//   Real x2[7];
//   Real x2[8];
//   Real x2[9];
//   Real x2[10];
//   output Real y0;
//   output Real y1;
//   output Real y2;
// equation
//   when Clock() then
//     x1[1] = previous(x1[1]) + u[1];
//     x1[2] = previous(x1[2]) + u[2];
//     x1[3] = previous(x1[3]) + u[3];
//     x1[4] = previous(x1[4]) + u[4];
//     x1[5] = previous(x1[5]) + u[5];
//     x1[6] = previous(x1[6]) + u[6];
//     x1[7] = previous(x1[7]) + u[7];
//     x1[8] = previous(x1[8]) + u[8];
//     x1[9] = previous(x1[9]) + u[9];
//     x1[10] = previous(x1[10]) + u[10];
//     x2 = VectorTest.myfor(u, array(previous(x2[$i0]) for $i0 in 1:10));
//   end when;
//   y0 = u[1] + u[2] + u[3] + u[4] + u[5] + u[6] + u[7] + u[8] + u[9] + u[10];
//   y1 = VectorTest.mysum(u);
//   y2 = VectorTest.mysum(x2);
// end VT;
// endResult
