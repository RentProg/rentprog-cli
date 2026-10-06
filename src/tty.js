// src/tty.js
import readline from "node:readline/promises";
export const interactive = ({ stdin, stdout, cli, env }) => !!(stdin.isTTY && stdout.isTTY) && !cli.noInput && env.RENTPROG_NO_INPUT !== "1";
export async function ask(question, { stdin, stderr }) {
  const rl = readline.createInterface({ input: stdin, output: stderr });
  try { return /^y(es)?$/i.test((await rl.question(question)).trim()); } finally { rl.close(); }
}
// Скрытый ввод ключа (только в интерактиве): эхо выключено, вставка приходит пачкой символов.
export function askSecret(question, { stdin, stderr }) {
  return new Promise((resolve) => {
    stderr.write(question);
    let buf = "";
    stdin.setRawMode(true); stdin.setEncoding("utf8"); stdin.resume();
    const done = (value) => { stdin.setRawMode(false); stdin.pause(); stdin.off("data", onData); stderr.write("\n"); resolve(value); };
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n" || ch === "\u0004") return done(buf.trim());
        if (ch === "\u0003") return done("");
        if (ch === "\u007f") buf = buf.slice(0, -1); else buf += ch;
      }
    };
    stdin.on("data", onData);
  });
}
