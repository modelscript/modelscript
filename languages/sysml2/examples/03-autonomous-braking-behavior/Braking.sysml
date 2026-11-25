package AutonomousBraking {
  attribute def Real;

  port def RadarTrackPort {
    attribute timeToCollisionS : Real;
    attribute relativeSpeedMps : Real;
  }

  port def HydraulicCommandPort {
    attribute targetDecelMps2 : Real;
    attribute linePressureBar : Real;
  }

  action def SenseObstacle {
    attribute rangeM : Real;
    attribute ttcS : Real;
  }

  action def ComputeDeceleration {
    attribute decelCmdMps2 : Real;
  }

  state def AebControllerStates {
    state Standby;
    state Warning;
    state PartialBraking;
    state FullEmergencyBraking;
  }

  part def RadarSensor {
    port trackOut : RadarTrackPort;
  }

  part def BrakeActuator {
    attribute maxPressureBar : Real = 180.0;
    port cmdIn : HydraulicCommandPort;
  }

  part def AebController {
    attribute warningTtcS : Real = 2.4;
    attribute emergencyTtcS : Real = 1.1;
    port trackIn : RadarTrackPort;
    port brakeOut : HydraulicCommandPort;
  }

  part def AebSystem {
    part radar : RadarSensor;
    part ecu : AebController;
    part actuator : BrakeActuator;
    connection sensorLink connect radar.trackOut to ecu.trackIn;
    connection brakeLink connect ecu.brakeOut to actuator.cmdIn;
  }
}
