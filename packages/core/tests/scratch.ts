import Modelica from "@modelscript/modelica/parser";
import Parser from "tree-sitter";
import { Context } from "../src/compiler/context.js";
import { NodeFileSystem } from "./node-filesystem.js";

const parser = new Parser();
parser.setLanguage(Modelica);
Context.registerParser(".mo", parser);

const bouncingBall = `
model BouncingBall
  parameter Real e = 0.7 "coefficient of restitution";
  parameter Real g = 9.81 "gravity acceleration";
  Real h(start = 1) "height of ball";
  Real v(start = 0) "velocity of ball";
equation
  der(h) = v;
  der(v) = -g;
  when h <= 0 then
    reinit(v, -e*pre(v));
  end when;
end BouncingBall;
`;

const ctx = new Context(new NodeFileSystem());
ctx.load(bouncingBall, "bouncing-ball.mo");

console.log("flattenArena:", !!ctx.flattenArena("BouncingBall"));
