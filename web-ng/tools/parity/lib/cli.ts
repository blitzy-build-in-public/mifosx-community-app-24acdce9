/// <reference types="node" />
import process from 'node:process';
// The informational path every parity CLI shares (finding 406f-F02): an operator asks a command what it would do with `--help`, which prints the effect and the environment variables it reads, named and never echoed (Rule 1 clause 9).
/** What one command says about itself when it is asked for usage (finding 406f-F02); every field is printed verbatim, a variable named and never echoed. */
export interface CliUsage {
  /** Command name as an operator invokes it, e.g. the npm script `check:endpoints`. */
  readonly name: string;
  readonly summary: string;
  readonly effects: readonly string[];
  readonly environment: readonly string[];
  readonly examples: readonly string[];}
/** What {@link resolveCliIntent} decided: run the command, or answer the arguments and stop with `exitCode` without running anything. */
export type CliIntent = | { readonly kind: 'run' } | { readonly kind: 'handled'; readonly exitCode: number };
const HELP_ARGUMENTS: readonly string[] = ['--help', '-h'];
function renderUsage(usage: CliUsage): string {
  return [`usage: ${usage.name} [--help]`,
    '',
    usage.summary,
    '',
    'what it does:',...usage.effects.map((effect) => `  - ${effect}`),
    '',
    'environment variables it reads:',...usage.environment.map((variable) => `  - ${variable}`),
    '',
    'examples:',...usage.examples.map((example) => `  ${example}`),
    '',
  ].join('\n');
}
/** Decides the invocation before the command reads a file, opens a socket or writes anything (finding 406f-F02): no argument runs it, `--help`/`-h` prints the usage block at exit code 0, and any other argument is a usage error naming it at exit code 2. */
export function resolveCliIntent(usage: CliUsage, args: readonly string[]): CliIntent {
  if (args.length === 0) {
    return { kind: 'run' };
  }
  if (args.some((argument) => HELP_ARGUMENTS.includes(argument))) {
    process.stdout.write(renderUsage(usage));
    return { kind: 'handled', exitCode: 0 };
  }
  const rejected = args[0];
  process.stderr.write(`usage: unrecognised argument "${rejected}"\n${renderUsage(usage)}`);
  return { kind: 'handled', exitCode: 2 };
}
