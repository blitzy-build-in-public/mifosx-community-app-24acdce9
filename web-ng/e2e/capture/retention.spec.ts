/** The harness's own tests for `e2e/capture/retention.ts` — the per-run purge that stops a run's captures and parity report, which keep client data masked only of credentials, from accreting run after run (AAP 0.10.2, AAP 0.10.4, Rule 1 clause 9). */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { PACKAGE_ROOT_DIR, RUN_ARTEFACT_PATHS, main, purgeRunArtefacts } from './retention';

const temporaryRoots: string[] = [];

function makePackageRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'web-ng-retention-'));
  temporaryRoots.push(root);
  return root;
}

function artefactsOf(packageRoot: string): string[] {
  return [
    join(packageRoot, 'e2e', '.captures'),
    join(packageRoot, 'parity-report.md'),
    join(packageRoot, 'parity-report.json'),
  ];
}

/** Writes one run's artefacts under a package root — a capture tree with both writers' subdirectories, plus the markdown and JSON reports — and answers their paths. */
function writeOneRun(packageRoot: string): string[] {
  const artefacts = artefactsOf(packageRoot);
  mkdirSync(join(artefacts[0], 'network'), { recursive: true });
  writeFileSync(join(artefacts[0], 'network', 'legacy__W2.json'), '{"exchanges":[]}\n', 'utf8');
  mkdirSync(join(artefacts[0], 'state'), { recursive: true });
  writeFileSync(join(artefacts[0], 'state', 'next__W2.json'), '{"client":{"status":"Active"}}\n', 'utf8');
  writeFileSync(artefacts[1], '# parity report\n', 'utf8');
  writeFileSync(artefacts[2], '{"workflows":[]}\n', 'utf8');
  return artefacts;
}

function printed(spy: { mock: { calls: unknown[][] } }): string {
  return spy.mock.calls.map((call: unknown[]): string => call.join(' ')).join('\n');
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('RUN_ARTEFACT_PATHS', () => {
  it('names the captures and both report files from its own location under web-ng', () => {
    expect(RUN_ARTEFACT_PATHS).toHaveLength(3);
    expect(RUN_ARTEFACT_PATHS[0].endsWith(join('web-ng', 'e2e', '.captures'))).toBe(true);
    expect(RUN_ARTEFACT_PATHS[1].endsWith(join('web-ng', 'parity-report.md'))).toBe(true);
    expect(RUN_ARTEFACT_PATHS[2].endsWith(join('web-ng', 'parity-report.json'))).toBe(true);
    expect(PACKAGE_ROOT_DIR.endsWith(join('web-ng'))).toBe(true);
  });
});

describe('purgeRunArtefacts', () => {
  it('removes every artefact a previous run left behind', () => {
    const packageRoot = makePackageRoot();
    const artefacts = writeOneRun(packageRoot);

    const removed = purgeRunArtefacts(artefacts, packageRoot);

    expect(removed).toEqual(artefacts.map((artefact: string): string => resolve(artefact)));
    for (const artefact of artefacts) {
      expect(existsSync(artefact)).toBe(false);
    }
  });

  it('accepts a run that left nothing behind', () => {
    const packageRoot = makePackageRoot();

    const removed = purgeRunArtefacts(artefactsOf(packageRoot), packageRoot);

    expect(removed).toEqual([]);
  });

  it.each([
    'the package root itself',
    'a parent of the package root',
    'an artefact beside the package root',
  ])('refuses %s and leaves it on disk', (refused: string) => {
    const root = makePackageRoot();
    const packageRoot = join(root, 'web-ng');
    mkdirSync(packageRoot, { recursive: true });
    const beside = join(root, 'parity-report.md');
    writeFileSync(beside, '# parity report\n', 'utf8');
    const targets: Record<string, string> = {
      'the package root itself': packageRoot,
      'a parent of the package root': root,
      'an artefact beside the package root': beside,
    };
    const target = targets[refused];

    expect(() => purgeRunArtefacts([target], packageRoot)).toThrow(/not inside the .*package root/);
    expect(existsSync(target)).toBe(true);
  });

  it('deletes nothing at all when one target is refused', () => {
    const root = makePackageRoot();
    const packageRoot = join(root, 'web-ng');
    const artefacts = writeOneRun(packageRoot);
    const beside = join(root, 'parity-report.json');
    writeFileSync(beside, '{"workflows":[]}\n', 'utf8');

    expect(() => purgeRunArtefacts([...artefacts, beside], packageRoot)).toThrow(/not inside the .*package root/);

    expect(existsSync(artefacts[0])).toBe(true);
    expect(existsSync(artefacts[1])).toBe(true);
    expect(existsSync(beside)).toBe(true);
  });
});

describe('main', () => {
  it('prints a line per artefact and answers 0 once they are gone', () => {
    const packageRoot = makePackageRoot();
    const artefacts = writeOneRun(packageRoot);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const code = main(artefacts, packageRoot);
    const output = printed(log);

    expect(code).toBe(0);
    for (const artefact of artefacts) {
      expect(output).toContain(`removed ${resolve(artefact)}`);
    }
    expect(output).toContain('3 removed, 0 absent');
  });

  it('answers 0 on a second run over the now absent artefacts', () => {
    const packageRoot = makePackageRoot();
    const artefacts = writeOneRun(packageRoot);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    expect(main(artefacts, packageRoot)).toBe(0);
    const code = main(artefacts, packageRoot);

    expect(code).toBe(0);
    expect(printed(log)).toContain('0 removed, 3 absent');
  });

  it('answers 1 with the refusal on stderr when a target is outside the package root', () => {
    const root = makePackageRoot();
    const packageRoot = join(root, 'web-ng');
    mkdirSync(packageRoot, { recursive: true });
    const outside = join(root, 'parity-report.md');
    writeFileSync(outside, '# parity report\n', 'utf8');
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const code = main([outside], packageRoot);

    expect(code).toBe(1);
    expect(printed(error)).toContain('not inside the');
    expect(log.mock.calls).toHaveLength(0);
    expect(existsSync(outside)).toBe(true);
  });
});
