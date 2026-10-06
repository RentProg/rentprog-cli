// src/cli.js — skeleton; the full file comes in Task 8
import { VERSION } from "./version.js";
export async function main(argv, io) {
  if (argv[0] === "--version" || argv[0] === "-v") { io.stdout.write(`${VERSION}\n`); return 0; }
  io.stderr.write("usage: rentprog <command> [flags]\n");
  return 2;
}
