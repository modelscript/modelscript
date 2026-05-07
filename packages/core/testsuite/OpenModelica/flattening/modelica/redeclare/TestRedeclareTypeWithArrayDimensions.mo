// name:     TestRedeclareTypeWithArrayDimensions.mo [BUG: #2418]
// keywords: redeclare,type
// status:   correct
//
// Redeclaration with array dimensions
//

package RedeclareTypeWithArrayDimensions

  model foo
    replaceable type paramType = Real;
    input paramType u;
    output paramType y;
  equation
    y = sin(u);
  end foo;

  model bar
    parameter Real x[:,2] = [0, 1];
    foo bletch(u=x, redeclare type paramType = Real[size(x,1),2]);
  end bar;
end RedeclareTypeWithArrayDimensions;

model TestRedeclareTypeWithArrayDimensions
  extends RedeclareTypeWithArrayDimensions.bar;
end TestRedeclareTypeWithArrayDimensions;

// Result:
// Error processing file: TestRedeclareTypeWithArrayDimensions.mo
// Error: Failed to load package RedeclareNoCC1 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class RedeclareNoCC1 not found in scope <top>.
// Error: Error occurred while flattening model TestRedeclareTypeWithArrayDimensions.mo [BUG: #2418]
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
