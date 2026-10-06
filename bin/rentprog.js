#!/usr/bin/env node
// bin/rentprog.js
import { main } from "../src/cli.js";
// stdout closed by the reader (`| head`): stop quietly, the reader already has what it wanted
process.stdout.on("error", (e) => { if (e.code === "EPIPE") process.exit(0); throw e; });
const code = await main(process.argv.slice(2), { env: process.env, stdin: process.stdin, stdout: process.stdout, stderr: process.stderr, argv0: process.env.npm_command === "exec" ? "npx -y @rentprog/cli@0" : "rentprog" });
process.exitCode = code;
