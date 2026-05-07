// status: correct

model SpliceUnknownDest

  function getVariableNameTable
    extends modelInExpressionBase;
  public
    input Integer indexModel ;
    input Integer dim;
    output String variableNameTable[dim] ;
  algorithm
     if indexModel == 1 then   // model1
      variableNameTable[1:size(model2,1)]  := model1[:];
     elseif indexModel == 2 then  // model2
      variableNameTable [1:size(model2,1)]:= model2[:];
     end if;
  end getVariableNameTable;

  function modelInExpressionBase
  protected
      final constant String model1[8] =    {"a", "b", "c", "d", "e", "f", "g","h"};
      final constant String model2[8] = {"a", "b", "c", "d", "e", "f", "g", "i"};
  end modelInExpressionBase;

  String tab[8];
equation
  tab=getVariableNameTable(2,8);
end SpliceUnknownDest;

// Result:
// Error processing file: SpliceUnknownDest.mo
// Error: Failed to load package modelInExpressionBase (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class modelInExpressionBase not found in scope <top>.
// Error: Error occurred while flattening model modelInExpressionBase
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
