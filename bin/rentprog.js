#!/usr/bin/env node
// bin/rentprog.js
import { main } from "../src/cli.js";
const code = await main(process.argv.slice(2), { env: process.env, stdin: process.stdin, stdout: process.stdout, stderr: process.stderr, argv0: process.env.npm_command === "exec" ? "npx -y @rentprog/cli@0" : "rentprog" });
process.exitCode = code;
