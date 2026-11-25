(* Conveyor Batch Counter with Pneumatic Diverter Actuation *)
PROGRAM ConveyorBatchControl
  VAR_INPUT
    ConveyorEnable : BOOL;
    PhotoEyeSensor : BOOL;
    ManualReset : BOOL;
    BatchTarget : INT := 12;
  END_VAR
  VAR_OUTPUT
    BeltDriveRun : BOOL := FALSE;
    DiverterValve : BOOL := FALSE;
    BatchReadyLamp : BOOL := FALSE;
    PartsCounted : INT := 0;
  END_VAR
  VAR
    PartEdge : R_TRIG;
    BatchCounter : CTU;
    DiverterTimer : TON;
    PartPulse : BOOL := FALSE;
    BatchReached : BOOL := FALSE;
    DiverterDone : BOOL := FALSE;
    AutoResetPulse : BOOL := FALSE;
  END_VAR

  BeltDriveRun := ConveyorEnable;

  (* Rising-edge detection on optical part sensor *)
  PartEdge(CLK := PhotoEyeSensor AND BeltDriveRun, Q => PartPulse);

  (* Count parts up to BatchTarget *)
  AutoResetPulse := ManualReset OR DiverterDone;
  BatchCounter(
    CU := PartPulse,
    R := AutoResetPulse,
    PV := BatchTarget,
    Q => BatchReached,
    CV => PartsCounted
  );

  (* Hold pneumatic diverter extended for 2.5 seconds once batch is full *)
  DiverterTimer(IN := BatchReached, PT := T#2500ms, Q => DiverterDone);

  DiverterValve := BatchReached AND NOT DiverterDone;
  BatchReadyLamp := BatchReached;
END_PROGRAM
