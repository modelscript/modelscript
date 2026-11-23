// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { VhdlSimulator, bitsToUnsigned, resolveStdLogic, unsignedToBits } from "../src/index.js";

describe("@modelscript/vhdl — RTL Simulation Benchmarks", () => {
  it("Benchmark 1: 4-bit structural ripple-carry adder matches exact arithmetic across all 512 input vectors", () => {
    const rca4Vhdl = `
library ieee;
use ieee.std_logic_1164.all;

entity full_adder is
  port (
    a    : in  std_logic;
    b    : in  std_logic;
    cin  : in  std_logic;
    sum  : out std_logic;
    cout : out std_logic
  );
end entity full_adder;

architecture rtl of full_adder is
begin
  sum  <= a xor b xor cin;
  cout <= (a and b) or (cin and (a xor b));
end architecture rtl;

entity ripple_adder_4 is
  port (
    a    : in  std_logic_vector(3 downto 0);
    b    : in  std_logic_vector(3 downto 0);
    cin  : in  std_logic;
    sum  : out std_logic_vector(3 downto 0);
    cout : out std_logic
  );
end entity ripple_adder_4;

architecture structural of ripple_adder_4 is
  signal c1, c2, c3 : std_logic;

  component full_adder is
    port (
      a    : in  std_logic;
      b    : in  std_logic;
      cin  : in  std_logic;
      sum  : out std_logic;
      cout : out std_logic
    );
  end component full_adder;
begin
  fa0 : full_adder port map (a => a(0), b => b(0), cin => cin, sum => sum(0), cout => c1);
  fa1 : full_adder port map (a => a(1), b => b(1), cin => c1,  sum => sum(1), cout => c2);
  fa2 : full_adder port map (a => a(2), b => b(2), cin => c2,  sum => sum(2), cout => c3);
  fa3 : full_adder port map (a => a(3), b => b(3), cin => c3,  sum => sum(3), cout => cout);
end architecture structural;
`;

    const sim = new VhdlSimulator(rca4Vhdl, { entityName: "ripple_adder_4" });

    for (let a = 0; a < 16; a++) {
      for (let b = 0; b < 16; b++) {
        for (let cin = 0; cin <= 1; cin++) {
          sim.step({
            a: unsignedToBits(a, 4),
            b: unsignedToBits(b, 4),
            cin: cin === 1 ? "1" : "0",
          });
          const expected = a + b + cin;
          const gotSum = bitsToUnsigned(String(sim.getSignal("sum")));
          const gotCout = sim.getSignal("cout") === "1" ? 1 : 0;
          assert.equal(gotSum, expected & 0xf, `Sum mismatch for ${a}+${b}+${cin}`);
          assert.equal(gotCout, (expected >> 4) & 1, `Carry mismatch for ${a}+${b}+${cin}`);
        }
      }
    }
  });

  it("Benchmark 2: Synchronous 4-bit counter with reset & wrap-around achieves exact cycle parity", () => {
    const counterVhdl = `
library ieee;
use ieee.std_logic_1164.all;
use ieee.numeric_std.all;

entity sync_counter_4 is
  port (
    clk : in  std_logic;
    rst : in  std_logic;
    en  : in  std_logic;
    q   : out std_logic_vector(3 downto 0)
  );
end entity sync_counter_4;

architecture rtl of sync_counter_4 is
  signal cnt : std_logic_vector(3 downto 0) := "0000";
begin
  p_cnt : process(clk)
  begin
    if rising_edge(clk) then
      if rst = '1' then
        cnt <= "0000";
      elsif en = '1' then
        cnt <= std_logic_vector(unsigned(cnt) + 1);
      end if;
    end if;
  end process p_cnt;

  q <= cnt;
end architecture rtl;
`;

    const sim = new VhdlSimulator(counterVhdl);

    // Cycle 0: synchronous reset
    sim.clockCycle("clk", { rst: "1", en: "1" });
    assert.equal(sim.getSignal("q"), "0000");

    // Cycles 1..16: count 1..15 then wrap to 0
    for (let cycle = 1; cycle <= 16; cycle++) {
      sim.clockCycle("clk", { rst: "0", en: "1" });
      const expected = unsignedToBits(cycle % 16, 4);
      assert.equal(sim.getSignal("q"), expected, `Counter mismatch on cycle ${cycle}`);
    }

    // Hold when en = '0'
    sim.clockCycle("clk", { rst: "0", en: "1" });
    assert.equal(sim.getSignal("q"), "0001");
    sim.clockCycle("clk", { rst: "0", en: "0" });
    assert.equal(sim.getSignal("q"), "0001");

    // Synchronous reset returns immediately to 0000
    sim.clockCycle("clk", { rst: "1", en: "1" });
    assert.equal(sim.getSignal("q"), "0000");
  });

  it("Benchmark 3: Moore FSM traffic-light controller transitions RED -> GREEN -> YELLOW -> RED with exact outputs", () => {
    const fsmVhdl = `
library ieee;
use ieee.std_logic_1164.all;

entity traffic_fsm is
  port (
    clk    : in  std_logic;
    rst    : in  std_logic;
    red    : out std_logic;
    yellow : out std_logic;
    green  : out std_logic
  );
end entity traffic_fsm;

architecture rtl of traffic_fsm is
  type state_t is (S_RED, S_GREEN, S_YELLOW);
  signal state      : state_t := S_RED;
  signal next_state : state_t := S_RED;
begin
  p_reg : process(clk)
  begin
    if rising_edge(clk) then
      if rst = '1' then
        state <= S_RED;
      else
        state <= next_state;
      end if;
    end if;
  end process p_reg;

  p_comb : process(state)
  begin
    red    <= '0';
    yellow <= '0';
    green  <= '0';
    case state is
      when S_RED =>
        red        <= '1';
        next_state <= S_GREEN;
      when S_GREEN =>
        green      <= '1';
        next_state <= S_YELLOW;
      when S_YELLOW =>
        yellow     <= '1';
        next_state <= S_RED;
    end case;
  end process p_comb;
end architecture rtl;
`;

    const sim = new VhdlSimulator(fsmVhdl);

    // Reset to S_RED
    sim.clockCycle("clk", { rst: "1" });
    assert.equal(sim.getSignal("state"), "S_RED");
    assert.equal(sim.getSignal("red"), "1");
    assert.equal(sim.getSignal("green"), "0");
    assert.equal(sim.getSignal("yellow"), "0");

    // Cycle 1: S_GREEN
    sim.clockCycle("clk", { rst: "0" });
    assert.equal(sim.getSignal("state"), "S_GREEN");
    assert.equal(sim.getSignal("red"), "0");
    assert.equal(sim.getSignal("green"), "1");
    assert.equal(sim.getSignal("yellow"), "0");

    // Cycle 2: S_YELLOW
    sim.clockCycle("clk", { rst: "0" });
    assert.equal(sim.getSignal("state"), "S_YELLOW");
    assert.equal(sim.getSignal("red"), "0");
    assert.equal(sim.getSignal("green"), "0");
    assert.equal(sim.getSignal("yellow"), "1");

    // Cycle 3: back to S_RED with zero phase-drift residual
    sim.clockCycle("clk", { rst: "0" });
    assert.equal(sim.getSignal("state"), "S_RED");
    assert.equal(sim.getSignal("red"), "1");
    assert.equal(sim.getSignal("green"), "0");
    assert.equal(sim.getSignal("yellow"), "0");
    const phaseResidual = Math.abs(Number(sim.getSignal("red")) - 1);
    assert.ok(phaseResidual <= 0, `Expected zero residual, got ${phaseResidual}`);
  });

  it("Benchmark 4: D-flip-flop edge timing parity & IEEE 1164 9-value resolution", () => {
    const dffVhdl = `
library ieee;
use ieee.std_logic_1164.all;

entity dff_sync is
  port (
    clk : in  std_logic;
    rst : in  std_logic;
    d   : in  std_logic;
    q   : out std_logic
  );
end entity dff_sync;

architecture rtl of dff_sync is
begin
  p_dff : process(clk)
  begin
    if clk'event and clk = '1' then
      if rst = '1' then
        q <= '0';
      else
        q <= d;
      end if;
    end if;
  end process p_dff;
end architecture rtl;
`;

    const sim = new VhdlSimulator(dffVhdl);

    // Clock low with d = '1' should NOT capture yet
    sim.step({ clk: "0", rst: "0", d: "1" }, 5);
    assert.notEqual(sim.getSignal("q"), "1");

    // Rising edge captures d = '1'
    const rise1 = sim.step({ clk: "1", rst: "0", d: "1" }, 5);
    assert.equal(sim.getSignal("q"), "1");
    assert.equal(rise1.timeNs, 10);

    // Changing d while clk stays high must NOT alter q
    sim.step({ clk: "1", rst: "0", d: "0" }, 5);
    assert.equal(sim.getSignal("q"), "1");

    // Falling edge must NOT alter q
    sim.step({ clk: "0", rst: "0", d: "0" }, 5);
    assert.equal(sim.getSignal("q"), "1");

    // Next rising edge captures d = '0'
    sim.step({ clk: "1", rst: "0", d: "0" }, 5);
    assert.equal(sim.getSignal("q"), "0");

    // Verify IEEE 1164 9-value resolution laws
    assert.equal(resolveStdLogic(["0", "1"]), "X");
    assert.equal(resolveStdLogic(["1", "Z"]), "1");
    assert.equal(resolveStdLogic(["0", "H"]), "0");
    assert.equal(resolveStdLogic(["L", "H"]), "W");
    assert.equal(resolveStdLogic(["U", "1"]), "U");
  });
});
