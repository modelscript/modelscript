<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# `@modelscript/verilog`

IEEE 1364 Verilog Hardware Description Language (1984/1995/2001) support for ModelScript — **Beta** tier.

## Features

- **Native WASM GLR Grammar (`src/language.ts`)**: Declarative `@modelscript/dsl` specification compiled to `dist/parser.wasm` + `src-gen/bindings.{js,d.ts}` supporting `module`/`endmodule`, ANSI & non-ANSI port lists, `input`/`output`/`inout`, `wire`/`reg`/`integer`/`parameter`/`localparam`, bit-vectors `[msb:lsb]`, continuous `assign`, `always @(posedge/negedge/*)`, `initial`, `begin`/`end`, `if`/`else`, `case`/`endcase`, blocking (`=`) and non-blocking (`<=`) assignments, IEEE 1364 gate primitives (`and`, `nand`, `or`, `nor`, `xor`, `xnor`, `buf`, `not`, `bufif0`, `bufif1`, `notif0`, `notif1`), module instantiation, sized literals (`4'b1010`, `8'hFF`), and `//` / `/* */` comments.
- **RTL Parser & Diagnostics (`src/parser/`, `src/errors.ts`, `src/lints/`)**: Full Verilog-2001 structural/behavioral parser with `VLOG1001`–`VLOG5006` linting (syntax errors, duplicate ports/nets, undeclared identifiers, blocking assignments in sequential `always @(posedge/negedge ...)` blocks, non-blocking assignments in combinational blocks, assigning to `wire` inside `always`, multiple drivers on non-`tri` nets, and bit-width truncation warnings).
- **4-State (`0/1/X/Z`) Event-Driven RTL Simulator (`src/solver/`)**: Stratified IEEE 1364 active/NBA delta-cycle simulator supporting combinational `assign`, gate primitives (including tri-state `bufif0`/`bufif1`/`notif0`/`notif1`), `initial` blocks, `posedge`/`negedge` flip-flops, `if`/`else`/`case` control flow, hierarchical module instantiation, and waveform recording.
- **Linear-Memory DAE Lowering (`src/dae/`)**: Direct lowering of Verilog parameters, ports, combinational assignments, gate primitives, and clocked registers into `@modelscript/runtime`'s `DAEBuilder`.
- **Cleanroom IEEE 1364 Standard Library (`src/catalog/`, `assets/verilog-std-lib/`)**: Built-in gate primitives (`and`, `nand`, `or`, `nor`, `xor`, `xnor`, `buf`, `not`, `bufif0`, `bufif1`, `notif0`, `notif1`) and standard RTL blocks (`dff`, `dffr`, `dffe`, `dlatch`, `mux2`, `mux4`, `half_adder`, `full_adder`, `alu4`, `shift_reg`, `lfsr7`, `counter`) with parametric SVG icons and AssemblyScript WASM runtime kernels.
- **Cross-Language Projections (`src/projections/`)**: Export Verilog modules to Modelica 3.6 synchronous clocks (`Clock`, `previous`, `when`) and IEEE 1076 VHDL (`entity`/`architecture`, `std_logic`, `std_logic_vector`).
- **Unified Indexing & LSP (`src/indexing.ts`, `src/lsp.ts`)**: Workspace symbol indexing, document symbols, diagnostics, contextual hover, and domain actions.
