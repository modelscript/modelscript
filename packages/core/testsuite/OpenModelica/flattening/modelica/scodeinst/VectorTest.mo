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
// Error processing file: VectorTest.mo
// [OpenModelica/flattening/modelica/scodeinst/VectorTest.mo:6:1-44:15:writable] Error: Cannot instantiate VectorTest due to class specialization package.
// Error: Error occurred while flattening model VectorTest
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
