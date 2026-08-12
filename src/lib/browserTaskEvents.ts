/*
 * In-process notification that a browser task changed.
 *
 * The bus carries only a task id, never state. A subscriber re-reads the task,
 * so what a watcher sees is always what the database holds — the bus makes an
 * update prompt, it does not become a second source of truth.
 *
 * Held on globalThis for the same reason the Prisma client is: the dev server
 * re-evaluates modules, and a fresh Set per reload would strand subscribers on
 * an emitter nobody publishes to.
 *
 * Delivery is best-effort by design. A watcher pairs this with a slow poll, so
 * a missed notification costs latency rather than correctness. That matters:
 * this process can restart mid-task, and the product must not depend on an
 * in-memory subscription surviving.
 */

type Listener = (taskId: string) => void;

const globalForBus = globalThis as unknown as { tripbuddyBrowserTaskBus?: Set<Listener> };

const listeners = (globalForBus.tripbuddyBrowserTaskBus ??= new Set<Listener>());

export function publishBrowserTaskChange(taskId: string) {
  for (const listener of [...listeners]) {
    try {
      listener(taskId);
    } catch {
      /* One broken watcher must not stop the others from being told. */
    }
  }
}

export function subscribeToBrowserTaskChanges(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test seam. */
export function browserTaskListenerCount() {
  return listeners.size;
}
