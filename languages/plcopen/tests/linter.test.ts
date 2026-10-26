// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { lintPlcProject } from "../src/lints/rules.js";
import { parsePlcopen } from "../src/parser/index.js";

describe("PLCopen Pre-Flight Linter Rules", () => {
  it("emits M7704 on hardware I/O address collision", () => {
    const xml = `
      <project>
        <types>
          <pous>
            <pou name="MotorControl" pouType="program">
              <interface>
                <outputVars>
                  <variable name="Motor1" address="%QX0.0"><type><BOOL/></type></variable>
                  <variable name="Motor2" address="%QX0.0"><type><BOOL/></type></variable>
                </outputVars>
              </interface>
              <body><ST></ST></body>
            </pou>
          </pous>
        </types>
      </project>
    `;
    const project = parsePlcopen(xml);
    const diags = lintPlcProject(project);
    assert(diags.some((d) => d.code === "M7704"));
    const d = diags.find((x) => x.code === "M7704")!;
    assert.strictEqual(d.severity, "error");
    assert(d.message.includes("Hardware I/O address collision at '%QX0.0'"));
  });

  it("emits M7701 on unassigned local variable read", () => {
    const st = `
      PROGRAM BadRead
        VAR
          UnassignedVal : INT;
          Result : INT := 0;
        END_VAR

        Result := UnassignedVal + 10;
      END_PROGRAM
    `;
    const project = parsePlcopen(st);
    const diags = lintPlcProject(project);
    assert(diags.some((d) => d.code === "M7701"));
    const d = diags.find((x) => x.code === "M7701")!;
    assert(d.message.includes("Variable 'UnassignedVal' is read before being assigned"));
  });

  it("emits M7703 on recursive POU invocation", () => {
    const st = `
      FUNCTION RecurseDemo : INT
        VAR_INPUT N : INT; END_VAR
        IF N > 0 THEN
          RecurseDemo(N := N - 1);
        END_IF;
      END_FUNCTION
    `;
    const project = parsePlcopen(st);
    const diags = lintPlcProject(project);
    assert(diags.some((d) => d.code === "M7703"));
    const d = diags.find((x) => x.code === "M7703")!;
    assert(d.message.includes("Recursive invocation of POU 'RecurseDemo' detected"));
  });

  it("emits M7706 on negative timer preset duration", () => {
    const st = `
      PROGRAM TimerCheck
        VAR
          T1 : TON;
          Start : BOOL := TRUE;
        END_VAR

        T1(IN := Start, PT := T#-5s);
      END_PROGRAM
    `;
    const project = parsePlcopen(st);
    const diags = lintPlcProject(project);
    assert(diags.some((d) => d.code === "M7706"));
    const d = diags.find((x) => x.code === "M7706")!;
    assert(d.message.includes("Timer preset time 'T#-5s' for 'T1' cannot be negative."));
  });

  it("emits M7707 on unbounded infinite while loop", () => {
    const st = `
      PROGRAM InfiniteLoop
        VAR X : INT := 0; END_VAR
        WHILE TRUE DO
          X := X + 1;
        END_WHILE;
      END_PROGRAM
    `;
    const project = parsePlcopen(st);
    const diags = lintPlcProject(project);
    assert(diags.some((d) => d.code === "M7707"));
    const d = diags.find((x) => x.code === "M7707")!;
    assert.strictEqual(d.severity, "warning");
    assert(
      d.message.includes("Loop in POU 'InfiniteLoop' does not have a deterministic bounded termination condition."),
    );
  });

  it("emits M7708 on unknown or unresolvable POU instance", () => {
    const xml = `
      <project>
        <types><pous/></types>
        <instances>
          <configurations>
            <configuration name="Config1">
              <resource name="Res1">
                <pouInstance name="Inst1" typeName="NonExistentPouType"/>
              </resource>
            </configuration>
          </configurations>
        </instances>
      </project>
    `;
    const project = parsePlcopen(xml);
    const diags = lintPlcProject(project);
    assert(diags.some((d) => d.code === "M7708"));
    const d = diags.find((x) => x.code === "M7708")!;
    assert(d.message.includes("Unknown or unresolvable POU or function block type 'NonExistentPouType'"));
  });

  it("emits M7709 on unreachable statements after RETURN or EXIT", () => {
    const st = `
      PROGRAM DeadCode
        VAR A : INT := 1; B : INT := 2; END_VAR
        RETURN;
        A := B + 10;
      END_PROGRAM
    `;
    const project = parsePlcopen(st);
    const diags = lintPlcProject(project);
    assert(diags.some((d) => d.code === "M7709"));
    const d = diags.find((x) => x.code === "M7709")!;
    assert.strictEqual(d.severity, "warning");
    assert(d.message.includes("Unreachable code detected after 'return' statement in POU 'DeadCode'."));
  });

  it("emits M7705 on incompatible type assignment", () => {
    const st = `
      PROGRAM BadType
        VAR Flag : BOOL := FALSE; END_VAR
        Flag := 123;
      END_PROGRAM
    `;
    const project = parsePlcopen(st);
    const diags = lintPlcProject(project);
    assert(diags.some((d) => d.code === "M7705"));
    const d = diags.find((x) => x.code === "M7705")!;
    assert(d.message.includes("Type mismatch in assignment to 'Flag': expected 'BOOL', got 'number'."));
  });
});
