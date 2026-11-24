/// <reference types="node" />
import process from 'node:process';

// The informational path every parity CLI shares (finding 406f-F02). A gate and the seed are invoked
// through `npm run` and by `web-ng/e2e/reset-db.sh`, never interactively, so an argument is the only
// way an operator can ask a command what it would do: `--help` prints the effect, the environment
// variables the command reads and how to run it, and prints nothing about the values those variables
// hold (Rule 1 clause 9). This module only renders text — it opens no file, sends no request and
// starts no work — so answering an argument can never have the side effect the help exists to avoid.

/**
 * What one command says about itself when it is asked for usage (finding 406f-F02). Every field is
 * printed verbatim; a variable is named, never echoed, so a usage block carries no credential.
 */
export interface CliUsage {
  /** Command name as an operator invokes it, e.g. the npm script `check:endpoints`. */
  readonly name: string;
  /** One sentence stating what running the command does or proves. */
  readonly summary: string;
  /** What the command does when it runs, one line per effect; a command that writes says so here. */
  readonly effects: readonly string[];
  /** The environment variables the command reads, one line per variable or alias pair, named only. */
  readonly environment: readonly string[];
  /** One example invocation per entry, in the form the operator would type it. */
  readonly examples: readonly string[];
}

/**
 * What {@link resolveCliIntent} decided about the current invocation (finding 406f-F02): run the
 * command, or answer the arguments and stop with `exitCode` without running anything.
 */
export type CliIntent =
  | { readonly kind: 'run' }
  | { readonly kind: 'handled'; readonly exitCode: number };

/** The arguments that ask for usage rather than for work. */
const HELP_ARGUMENTS: readonly string[] = ['--help', '-h'];

/**
 * Renders one usage block: the invocation line and the summary, then the effects, the environment
 * variables and the examples, each entry on a line of its own. Both the `--help` path and the
 * rejected-argument path print through here, so the two blocks can never drift apart.
 */
function renderUsage(usage: CliUsage): string {
  return [
    `usage: ${usage.name} [--help]`,
    '',
    usage.summary,
    '',
    'what it does:',
    ...usage.effects.map((effect) => `  - ${effect}`),
    '',
    'environment variables it reads:',
    ...usage.environment.map((variable) => `  - ${variable}`),
    '',
    'examples:',
    ...usage.examples.map((example) => `  ${example}`),
    '',
  ].join('\n');
}

/**
 * Inspects a command's arguments before it reads a file, opens a socket or writes anything
 * (finding 406f-F02), so a state-changing command such as the seed can be inspected without being
 * triggered. No argument runs the command. `--help` or `-h`, alone or beside other arguments, prints
 * the usage block to stdout and answers exit code 0. Any other argument is a usage error: one line
 * naming it and the same block go to stderr, and the answer is exit code 2.
 *
 * @param usage What the command says about itself.
 * @param args The command's arguments, i.e. `process.argv.slice(2)`.
 * @returns `{kind: 'run'}` when the command should proceed; otherwise `{kind: 'handled'}` with the
 * exit code the caller sets on `process.exitCode`, so no piped output is lost to `process.exit()`.
 */
export function resolveCliIntent(usage: CliUsage, args: readonly string[]): CliIntent {
  if (args.length === 0) {
    return { kind: 'run' };
  }
  if (args.some((argument) => HELP_ARGUMENTS.includes(argument))) {
    process.stdout.write(renderUsage(usage));
    return { kind: 'handled', exitCode: 0 };
  }
  // Past the branch above no argument is a help flag, so the first one is the argument to name.
  const rejected = args[0];
  process.stderr.write(`usage: unrecognised argument "${rejected}"\n${renderUsage(usage)}`);
  return { kind: 'handled', exitCode: 2 };
}
