// name: CevalIf2
// keywords:
// status: correct
//
//

pure function getTable2DValue
  input ExternalCombiTable2D tableID;
  output Real y;
  external "C" y = ext(tableID);
end getTable2DValue;

class ExternalCombiTable2D
  extends ExternalObject;

  function constructor
    input String tableName;
    output ExternalCombiTable2D externalCombiTable2D;
    external "C" externalCombiTable2D = ext(tableName);
  end constructor;

  function destructor
    input ExternalCombiTable2D externalCombiTable2D;
    external "C" ModelicaStandardTables_CombiTable2D_close(externalCombiTable2D);
  end destructor;
end ExternalCombiTable2D;

model FlowControlled_m_flow
  parameter Real m_flow_nominal;
equation
  if m_flow_nominal > 0 then
  end if;
end FlowControlled_m_flow;

record GenericHeatPump
  parameter Real mEva_flow_nominal = getTable2DValue(tableID_QCon_flow);
  final parameter ExternalCombiTable2D tableID_QCon_flow = ExternalCombiTable2D("NoName");
end GenericHeatPump;

model HeatPumpModular
  parameter GenericHeatPump dat;
  FlowControlled_m_flow pumEva(final m_flow_nominal = dat.mEva_flow_nominal);
end HeatPumpModular;

model CevalIf2
  HeatPumpModular ets(dat = datHeaPum);
  parameter GenericHeatPump datHeaPum;
end CevalIf2;

// Result:
// Error processing file: CevalIf2.mo
// [OpenModelica/flattening/modelica/scodeinst/CevalIf2.mo:35:1-38:20:writable] Warning: Pure function 'GenericHeatPump' contains a call to impure function 'ExternalCombiTable2D.constructor'.
// [/var/lib/jenkins/ws/LINUX_BUILDS/tmp.build/openmodelica-1.26.3~1-g7583224/OMCompiler/Compiler/NFFrontEnd/NFCeval.mo:1806:9-1807:99:writable] Error: Internal error NFCeval.evalRelationGreater failed to evaluate ‘datHeaPum.mEva_flow_nominal > 0.0‘
// Error: Error occurred while flattening model CevalIf2
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
