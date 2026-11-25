-- Shared ALU Opcode and Datapath Width Package
library ieee;
use ieee.std_logic_1164.all;

package alu_pkg is
  constant DATA_WIDTH : integer := 8;
  constant ADDR_WIDTH : integer := 2;
  constant OP_ADD : std_logic_vector(2 downto 0) := "000";
  constant OP_SUB : std_logic_vector(2 downto 0) := "001";
  constant OP_AND : std_logic_vector(2 downto 0) := "010";
  constant OP_OR  : std_logic_vector(2 downto 0) := "011";
  constant OP_XOR : std_logic_vector(2 downto 0) := "100";
end package alu_pkg;
