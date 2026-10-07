# RentProg CLI

RentProg in the terminal for AI agents and scripts. Every tool of your RentProg MCP catalog becomes a command:
bookings, cars, clients, CRM, money, staff — exactly what your key allows.

Made for agents that run shell commands — above all ChatGPT agent mode, which cannot connect an MCP server with a
key — and for your own scripts. Requires Node.js 20.18 or newer.

## Connect

In RentProg open **Profile → AI agent keys**, create a key and copy the CLI command from the key window. It already
contains your key and the server address of your region:

```bash
npx -y @rentprog/cli@0 login rpa_… --url https://…/mcp
```

The command checks the key, prints whose key it is and what it may do, and saves it for the next commands
(`~/.config/rentprog/config.json`, readable only by you). Install globally to type `rentprog` instead of the `npx` prefix:

```bash
npm i -g @rentprog/cli
```

Other ways to pass the key: `rentprog login --key-stdin --url …` (key from stdin), a hidden prompt in a terminal, or the
`RENTPROG_API_KEY` and `RENTPROG_MCP_URL` environment variables (nothing is saved). `rentprog logout` removes the saved key.

## Use

```bash
rentprog tools                     # what this key can do; --read, --write, --grep <text>
rentprog help list_bookings        # arguments of a tool and how to pass them
rentprog whoami                    # owner of the key and its levels
rentprog list_bookings --active --per-page 50
rentprog list_bookings --all --format csv > bookings.csv
```

- Flags come from the tool arguments: `per_page` → `--per-page`, booleans `--x` / `--no-x`, lists `--kinds a,b` or a repeated
  flag (text lists only by repeating), objects and mixed types as JSON, any argument also in `--args '<json>'` or
  `--args @file.json`.
- Output: a table in a terminal, JSON otherwise; `--format json|table|csv` or `RENTPROG_FORMAT`.
- `--all` reads every page of a paged list (up to `--max-pages`, 20 by default) into one result.

## Writes

Writes follow the level of your key. On the preview level the CLI shows what would change and applies only on
confirmation: `y` in a terminal, or `--yes`. Without confirmation it prints how to apply the same preview later
(`--idempotency-key K --preview-token T` added to the same command). Every write carries an idempotency key: repeat a
failed write only with the same `--idempotency-key`. When the change needs approval in RentProg, `--wait [seconds]`
waits for the decision (120 seconds by default); to wait later, use `rentprog operation_status --operation-id N --wait`.

## Exit codes

| Code | Meaning | What to do |
|---|---|---|
| 0 | done | — |
| 2 | wrong command, flag or argument; not connected | fix the command (`rentprog help <tool>`) |
| 3 | refused: key, role, validation, rejected | do not repeat as is |
| 4 | not done: network before sending, rate limit, temporary error | repeat later; a write — with the same `--idempotency-key` |
| 5 | the write may have been applied | check the result before repeating, then repeat only with the same key |
| 6 | preview expired or data changed | start a new preview |
| 10 | waiting for approval or still running | `rentprog operation_status --operation-id … --wait` (do not rerun the write) |
| 11 | preview shown, nothing applied | confirm with `--yes` or the printed continuation |

Errors go to stderr as JSON (`error`, `message`, `details`, `exit_code`) unless both stdin and stdout are a terminal; `--no-input`
or `RENTPROG_NO_INPUT=1` forces JSON and never asks questions.

## Agent sandboxes

- **Any agent:** set `RENTPROG_NO_INPUT=1` (or pass `--no-input`) so the CLI never waits for a y/N answer, even in a
  pseudo-terminal; confirm previews with `--yes` or the printed continuation.
- **ChatGPT agent mode** — works as is; the CLI uses the sandbox proxy from `HTTPS_PROXY`.
- **Codex CLI** — its default sandbox has no network: run `login` outside the sandbox once and allow network for the
  commands (cloud Codex: allow `registry.npmjs.org` and your MCP address).
- Behind a corporate proxy set `HTTPS_PROXY` (and `NO_PROXY`); extra root certificates — `NODE_EXTRA_CA_CERTS`.

## Security

The key is sent only to RentProg servers and to `localhost`; another address is refused unless you pass `--allow-host`
together with `RENTPROG_API_KEY` (and only over https). The saved key is
never sent to a different address than the one it was checked against. The CLI prints only the last 4 characters of a key.

## License

MIT
