// name: WhenNestedEquation
// keywords: when, nested, equation
// status: incorrect
//
// Test detection of nested when-equations, which are not allowed.
// Fix for bug 1189: http://openmodelica.ida.liu.se:8080/cb/issue/1189
//

model ErrorNestedWhen
  Real x,y1,y2;
equation
  when x > 2 then
    when y1 > 3 then
      y2=sin(x);
    end when;
  end when;
end ErrorNestedWhen;

// Result:
// Error processing file: WhenNestedEquation.mo
// Error: Failed to load package WhenNestedEquation (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class WhenNestedEquation not found in scope <top>.
// Error: Error occurred while flattening model WhenNestedEquation
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
