// In-memory job tracker for `pyr3 serve`. Each `/api/render` request
// allocates an AbortController stored under a `crypto.randomUUID()` key;
// `/api/cancel/:id` looks it up and aborts. Server restart drops the
// table — the right semantic for an interactive local tool.

import { randomUUID } from 'node:crypto';

const jobs = new Map<string, AbortController>();

export interface Job {
  id: string;
  controller: AbortController;
}

export function createJob(): Job {
  const id = randomUUID();
  const controller = new AbortController();
  jobs.set(id, controller);
  return { id, controller };
}

export function cancelJob(id: string): boolean {
  const ctrl = jobs.get(id);
  if (!ctrl) return false;
  ctrl.abort();
  jobs.delete(id);
  return true;
}

export function clearJob(id: string): void {
  jobs.delete(id);
}

export function activeJobCount(): number {
  return jobs.size;
}
