// name: ClassExtends6
// keywords: class, extends
// status: correct
//
// Tests that partial packages may be extended, and functions inside
// redeclared.
//

partial package A
  function usePart
    input Integer a;
    output Integer b;
  algorithm
    b := part(a);
  end usePart;

  replaceable partial function part
    input Integer a;
    output Integer b;
  end part;

  replaceable partial function part2
    input Integer a;
    output Integer b;
  end part2;
end A;

package B
  extends A;

  redeclare function extends part2
  algorithm
    b := a;
  end part2;

  redeclare function extends part
  algorithm
    b := part2(a);
  end part;

  constant Integer b = usePart(100);
end B;

model C
 Integer b = B.b + B.part2(2);
end C;

// Result:
// Error processing file: ClassExtends6.mo
// Error: Failed to load package ClassExtends6 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class ClassExtends6 not found in scope <top>.
// Error: Error occurred while flattening model ClassExtends6
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
