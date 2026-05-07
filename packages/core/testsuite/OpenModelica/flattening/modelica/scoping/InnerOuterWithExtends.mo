// name:     InnerOuterWithExtends
// keywords: dynamic scope, lookup
// status:   correct
//
//  components with inner prefix references an outer component with
//  the same name and one variable is generated for all of them.
//  checks for bug: https://openmodelica.org:8443/cb/issue/1285?navigation=true
//

package InnerOuterWithExtends

  model C1
    extends CBase;
    model S1
      extends SBase;
    end S1;

    S1 s1;
  end C1;

  partial model CBase
    inner Real V=1;
  end CBase;

  partial model SBase
    outer Real V;
  end SBase;
end InnerOuterWithExtends;

model InnerOuterWithExtendsTest
  import InnerOuterWithExtends.*;
  extends C1;
end InnerOuterWithExtendsTest;


// Result:
// Error processing file: InnerOuterWithExtends.mo
// [OpenModelica/flattening/modelica/scoping/InnerOuterWithExtends.mo:10:1-29:26:writable] Error: Cannot instantiate InnerOuterWithExtends due to class specialization package.
// Error: Error occurred while flattening model InnerOuterWithExtends
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
