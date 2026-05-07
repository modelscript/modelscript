// name:     ComponentFunctions.mo [BUG: #2854]
// keywords: function calls via component
// status:   correct
//
// function call via component

model N
  constant Real c;
  function x
    input Real r;
    output Real o = r;
  end x;
  function f
    input Real r;
    output Real o = x(sum(c*i for i in r:r+1));
  end f;
end N;

model ComponentFunctions
  N n1(c=1),n2(c=2);
  Real r1 = n1.f(time), r2 = n2.f(time);
end ComponentFunctions;

// Result:
// Error processing file: ComponentFunctions.mo
// [OpenModelica/flattening/modelica/algorithms-functions/Faculty1.mo:8:1-13:13:writable] Error: Cannot instantiate Faculty1 due to class specialization function.
// Error: Error occurred while flattening model ComponentFunctions.mo [BUG: #2854]
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
