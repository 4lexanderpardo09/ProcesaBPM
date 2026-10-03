import { cleanUp } from './smoke-cleanup.js';
import { loadSmokeConfig } from './smoke-config.js';
import { SmokeRun } from './smoke-run.js';

/**
 * Smoke test of a deployment (docs/despliegue.md §9, run by `deploy/verify.sh`): it drives the real API through the same
 * path a customer takes, from the first administrator to a closed ticket and a downloaded file, prints OK or FAIL for each
 * step and removes everything it created. Exit code 1 if any step failed (the cleanup is attempted either way).
 */
async function main(): Promise<void> {
  const config = loadSmokeConfig(process.env);
  const run = new SmokeRun(config);
  const steps: Array<[string, () => Promise<void>]> = [
    ['health and readiness', () => run.health()],
    ['platform administrator: password link, MFA enrollment, platform session', () => run.platformAdmin()],
    ['create an organization', () => run.organization()],
    ['owner invitation e-mail (outbox, worker, SMTP) and sign-in', () => run.ownerInvitation()],
    ['build and publish a workflow', () => run.workflow()],
    ['upload a file with a presigned URL and confirm it', () => run.upload()],
    ['create, advance and close a ticket', () => run.ticketFlow()],
    ['download the file with a presigned URL', () => run.download()],
    ['realtime: WebSocket through the proxy, origin and token checks', () => run.realtime()],
    ['report', () => run.report()],
  ];

  let failed = false;
  for (const [name, step] of steps) {
    if (failed) {
      console.log(`SKIP  ${name}`);
      continue;
    }
    const started = Date.now();
    try {
      await step();
      console.log(`OK    ${name} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
    } catch (error) {
      failed = true;
      console.log(`FAIL  ${name}\n      ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  try {
    const removed = await cleanUp(config, run.state);
    console.log(`OK    clean up (${removed.tenants} organization(s), ${removed.objects} file(s) removed)`);
  } catch (error) {
    failed = true;
    console.log(`FAIL  clean up\n      ${error instanceof Error ? error.message : String(error)}\n      Remove by hand: organizations named "Smoke test (delete me)" and users smoke-*@smoke.invalid`);
  }
  console.log(failed ? 'SMOKE TEST FAILED' : 'SMOKE TEST PASSED');
  process.exitCode = failed ? 1 : 0;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
