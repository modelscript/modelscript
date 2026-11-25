(* Companion IEC 61131-3 PLC Logic for BIW Spot-Welding Line *)
PROGRAM BIW_WeldStationPLC
  VAR_INPUT
    CycleStart : BOOL;
    SafetyFenceOK : BOOL;
    inClampedOK : BOOL;
    inWeldDone : BOOL;
    inWeldCurrent : REAL;
  END_VAR
  VAR_OUTPUT
    outClampClose : BOOL := FALSE;
    outWeldStart : BOOL := FALSE;
    QualityFault : BOOL := FALSE;
  END_VAR

  IF NOT SafetyFenceOK THEN
    outClampClose := FALSE;
    outWeldStart := FALSE;
    QualityFault := FALSE;
  ELSE
    outClampClose := CycleStart;
    outWeldStart := CycleStart AND inClampedOK AND NOT inWeldDone;
    QualityFault := inWeldDone AND (inWeldCurrent < 9.5);
  END_IF;
END_PROGRAM
