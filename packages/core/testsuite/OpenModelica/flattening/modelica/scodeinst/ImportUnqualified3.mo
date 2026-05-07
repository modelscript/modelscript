// name: ImportUnqualified3.mo
// status: correct

package A
  package B
    function f
      input Real x;
      output Real y;
    algorithm
      y := x;
    end f;
  end B;
end A;

model ImportUnqualified3
  import A.B.*;
  parameter Real x = f(100);
end ImportUnqualified3;


// Result:
// Error processing file: ImportUnqualified3.mo
// Error: Class ImportUnqualified3.mo not found in scope <top>.
// Error: Error occurred while flattening model ImportUnqualified3.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
