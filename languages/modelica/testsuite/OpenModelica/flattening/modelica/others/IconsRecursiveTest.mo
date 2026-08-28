// name:     RecursiveSelfReference
// keywords: Instantiation
// status:   correct
// cflags: -d=-newInst
//
// Testing fixes for bug: 179 (http://openmodelica.ida.liu.se/bugzilla/show_bug.cgi?id=179)
// the previous compiler failed to instantiate this model with Stack Overflow
//

  package BaseClasses
   extends Icons.BaseLibrary;
   package Icons
    extends Icons.BaseLibrary;
     model BaseLibrary "Icon for base library"
       parameter Real p = 1;
     end BaseLibrary;
   end Icons;
  end BaseClasses;

// Result:
// Error processing file: IconsRecursiveTest.mo
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// [OpenModelica/flattening/modelica/others/IconsRecursiveTest.mo:10:3-18:18:writable] Error: Cannot instantiate BaseClasses due to class specialization package.
//
// Execution failed!
// endResult
