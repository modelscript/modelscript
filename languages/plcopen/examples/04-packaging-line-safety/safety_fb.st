FUNCTION_BLOCK SafetyGateInterlock
  VAR_INPUT
    EStopChannelA : BOOL := TRUE;
    EStopChannelB : BOOL := TRUE;
    DoorSwitch : BOOL := TRUE;
    ResetPulse : BOOL := FALSE;
  END_VAR
  VAR_OUTPUT
    SafeToOperate : BOOL := FALSE;
    FaultLatched : BOOL := FALSE;
  END_VAR

  IF NOT (EStopChannelA AND EStopChannelB AND DoorSwitch) THEN
    SafeToOperate := FALSE;
    FaultLatched := TRUE;
  ELSIF ResetPulse THEN
    FaultLatched := FALSE;
    SafeToOperate := TRUE;
  END_IF;
END_FUNCTION_BLOCK
