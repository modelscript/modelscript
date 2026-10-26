// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import {
  parsePlcopen,
  parsePlcopenXml,
  parseStructuredTextFile,
  parseStructuredTextStatements,
  tokenizeStructuredText,
} from "../src/parser/index.js";

describe("PLCopen & Structured Text Parser", () => {
  it("tokenizes Structured Text keywords, operators, and literals", () => {
    const code = `
      VAR
        Start : BOOL := TRUE;
        Timer1 : TON;
        Count : INT := 10;
        Preset : TIME := T#5s;
      END_VAR
      IF Start THEN
        Count := Count + 1;
      END_IF;
    `;
    const tokens = tokenizeStructuredText(code);
    assert(tokens.length > 10);
    assert(tokens.some((t) => t.value === "var"));
    assert(tokens.some((t) => t.value === "Start"));
    assert(tokens.some((t) => t.value === ":="));
    assert(tokens.some((t) => t.value === "T#5s"));
  });

  it("parses Structured Text statements: IF, FOR, CASE, and Call", () => {
    const code = `
      IF Temperature > 100.0 THEN
        Alarm := TRUE;
        FanSpeed := 100;
      ELSIF Temperature > 75.0 THEN
        Alarm := FALSE;
        FanSpeed := 50;
      ELSE
        Alarm := FALSE;
        FanSpeed := 0;
      END_IF;

      FOR i := 1 TO 5 BY 1 DO
        Total := Total + i;
      END_FOR;

      TON_1(IN := Alarm, PT := T#2500ms, Q => PumpTrip);
    `;
    const st = parseStructuredTextStatements(code);
    assert.strictEqual(st.statements.length, 3);
    assert.strictEqual(st.statements[0]?.kind, "if");
    assert.strictEqual(st.statements[1]?.kind, "for");
    assert.strictEqual(st.statements[2]?.kind, "call");
    const callStmt = st.statements[2];
    if (callStmt.kind === "call") {
      assert.strictEqual(callStmt.callee, "TON_1");
      assert.strictEqual(callStmt.args.length, 3);
    }
  });

  it("parses standalone Structured Text file (.st) with PROGRAM and VAR blocks", () => {
    const code = `
      PROGRAM ConveyorControl
        VAR_INPUT
          Sensor1 : BOOL;
          Sensor2 : BOOL;
        END_VAR
        VAR_OUTPUT
          MotorRun : BOOL;
          Speed : REAL := 1.5;
        END_VAR
        VAR
          CycleCount : INT := 0;
        END_VAR

        MotorRun := Sensor1 AND NOT Sensor2;
      END_PROGRAM
    `;
    const project = parseStructuredTextFile(code, "conveyor.st");
    assert.strictEqual(project.pous.length, 1);
    const pou = project.pous[0]!;
    assert.strictEqual(pou.name, "ConveyorControl");
    assert.strictEqual(pou.pouType, "program");
    assert.strictEqual(pou.variables.length, 5);

    const s1 = pou.variables.find((v) => v.name === "Sensor1");
    assert(s1 !== undefined);
    assert.strictEqual(s1.scope, "input");
    assert.strictEqual(s1.dataType, "BOOL");

    const motor = pou.variables.find((v) => v.name === "MotorRun");
    assert(motor !== undefined);
    assert.strictEqual(motor.scope, "output");

    assert(pou.body.st !== undefined);
    assert.strictEqual(pou.body.st.statements.length, 1);
    assert.strictEqual(pou.body.st.statements[0]?.kind, "assignment");
  });

  it("parses standard PLCopen TC6 XML project document", () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
      <project xmlns="http://www.plcopen.org/xml/tc6_0201">
        <fileHeader companyName="Acme Industrial" productName="ModelScript PLC" />
        <contentHeader name="FactoryCell" version="1.0" />
        <types>
          <pous>
            <pou name="DrillStation" pouType="program">
              <interface>
                <inputVars>
                  <variable name="PartPresent" address="%IX0.0">
                    <type><BOOL/></type>
                  </variable>
                  <variable name="SafetyGuard" address="%IX0.1">
                    <type><BOOL/></type>
                  </variable>
                </inputVars>
                <outputVars>
                  <variable name="DrillMotor" address="%QX0.0">
                    <type><BOOL/></type>
                    <initialValue><simpleValue value="false"/></initialValue>
                  </variable>
                </outputVars>
                <localVars>
                  <variable name="CycleTimer">
                    <type><derived name="TON"/></type>
                  </variable>
                </localVars>
              </interface>
              <body>
                <ST>
                  DrillMotor := PartPresent AND SafetyGuard;
                  CycleTimer(IN := DrillMotor, PT := T#5s);
                </ST>
              </body>
            </pou>
          </pous>
        </types>
        <instances>
          <configurations>
            <configuration name="MainConfig">
              <resource name="PLC_Rack1">
                <task name="FastTask" priority="1" interval="T#10ms">
                  <pouInstance name="InstDrill" typeName="DrillStation"/>
                </task>
              </resource>
            </configuration>
          </configurations>
        </instances>
      </project>
    `;

    const project = parsePlcopenXml(xml);
    assert.strictEqual(project.fileHeader?.companyName, "Acme Industrial");
    assert.strictEqual(project.contentHeader?.name, "FactoryCell");
    assert.strictEqual(project.pous.length, 1);

    const pou = project.pous[0]!;
    assert.strictEqual(pou.name, "DrillStation");
    assert.strictEqual(pou.variables.length, 4);

    const partVar = pou.variables.find((v) => v.name === "PartPresent");
    assert.strictEqual(partVar?.address, "%IX0.0");
    assert.strictEqual(partVar?.scope, "input");

    const motorVar = pou.variables.find((v) => v.name === "DrillMotor");
    assert.strictEqual(motorVar?.address, "%QX0.0");
    assert.strictEqual(motorVar?.initialValue, false);

    assert(pou.body.st !== undefined);
    assert.strictEqual(pou.body.st.statements.length, 2);

    assert.strictEqual(project.configurations.length, 1);
    const config = project.configurations[0]!;
    assert.strictEqual(config.resources.length, 1);
    const res = config.resources[0]!;
    assert.strictEqual(res.tasks.length, 1);
    const task = res.tasks[0]!;
    assert.strictEqual(task.name, "FastTask");
    assert.strictEqual(task.intervalMs, 10);
    assert.strictEqual(res.instances.length, 1);
    assert.strictEqual(res.instances[0]!.typeName, "DrillStation");
  });

  it("detects and routes XML vs Structured Text automatically via parsePlcopen", () => {
    const stSource = `PROGRAM Main VAR X: INT; END_VAR X := 1; END_PROGRAM`;
    const xmlSource = `<project><contentHeader name="Demo"/><types><pous/></types></project>`;

    const p1 = parsePlcopen(stSource, "main.st");
    assert.strictEqual(p1.pous.length, 1);
    assert.strictEqual(p1.pous[0]?.name, "Main");

    const p2 = parsePlcopen(xmlSource, "project.xml");
    assert.strictEqual(p2.contentHeader?.name, "Demo");
  });
});
