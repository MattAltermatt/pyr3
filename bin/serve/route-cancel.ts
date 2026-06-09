// POST /api/cancel/:id — abort an in-flight render. Idempotent: missing
// jobs respond with cancelled=false but still 200 OK so the client
// doesn't surface noise when the render naturally completed first.

import type { IncomingMessage, ServerResponse } from 'node:http';

import { cancelJob } from './jobs';

export function handleCancel(_req: IncomingMessage, res: ServerResponse, params: Record<string, string>): void {
  const id = params['id'] ?? '';
  const cancelled = cancelJob(id);
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ cancelled }));
}
