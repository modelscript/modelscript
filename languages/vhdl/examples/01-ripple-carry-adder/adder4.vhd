-- IEEE VHDL-93 4-Bit Combinational Ripple-Carry Adder
library ieee;
use ieee.std_logic_1164.all;

entity adder4 is
  port (
    a    : in  std_logic_vector(3 downto 0);
    b    : in  std_logic_vector(3 downto 0);
    cin  : in  std_logic;
    sum  : out std_logic_vector(3 downto 0);
    cout : out std_logic
  );
end entity adder4;

architecture rtl of adder4 is
  signal c1 : std_logic;
  signal c2 : std_logic;
  signal c3 : std_logic;
begin
  sum(0) <= a(0) xor b(0) xor cin;
  c1     <= (a(0) and b(0)) or (cin and (a(0) xor b(0)));

  sum(1) <= a(1) xor b(1) xor c1;
  c2     <= (a(1) and b(1)) or (c1 and (a(1) xor b(1)));

  sum(2) <= a(2) xor b(2) xor c2;
  c3     <= (a(2) and b(2)) or (c2 and (a(2) xor b(2)));

  sum(3) <= a(3) xor b(3) xor c3;
  cout   <= (a(3) and b(3)) or (c3 and (a(3) xor b(3)));
end architecture rtl;
