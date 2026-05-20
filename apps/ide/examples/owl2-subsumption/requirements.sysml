package ActuatorRequirements {
  requirement def HighVoltageActuatorReq {
    doc /* The system shall use an actuator with supply voltage >= 200V
           and maximum current <= 10A for the main drive. */

    attribute requiredMinVoltage : Real = 200.0;
    attribute requiredMaxCurrent : Real = 10.0;
  }

  part def MainDriveSystem {
    part actuator : HighVoltageActuator;
  }

  part def HighVoltageActuator {
    doc /* An actuator satisfying the high-voltage requirement. */
  }
}
