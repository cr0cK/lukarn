import { stopStorages } from '../storages/backends.js';

/**
 * What outlives the run, and has to be taken down by name.
 *
 * The instance under `packages/e2e/.tmp` does not: `prepareInstance` deletes it on the
 * way in, so a run always starts from nothing whatever the last one left behind. The
 * containers are different — they are not children of any process here, so nothing
 * ends them when the run does, and three of them would go on holding their ports.
 *
 * A `globalTeardown` rather than a signal handler in `serve.ts`, which is where this
 * first went: Playwright ends its web servers by killing the process tree, and a
 * handler racing that shutdown stopped the containers on some runs and not others.
 */
export default function teardown(): void {
  stopStorages();
}
