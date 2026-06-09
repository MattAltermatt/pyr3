// GET /api/capabilities — handshake the viewer fetches on boot. Shape
// locked by the animation architecture spec § "Capability detection".

import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { version as pyr3Version } from '../version';

export interface ServerCapability {
  backend: 'dawn-node';
  pyr3_version: string;
  dawn_version?: string;
  max_quality: null;
  can_write_files: boolean;
  can_render_animation: boolean;
  scratch_dir: string;
  gpu_adapter?: string;
}

export interface CapabilityCtx {
  gpuAdapter?: string;
  dawnVersion?: string;
}

export function buildCapability(ctx: CapabilityCtx): ServerCapability {
  return {
    backend: 'dawn-node',
    pyr3_version: pyr3Version,
    dawn_version: ctx.dawnVersion,
    max_quality: null,
    // P0 ships render only; P4+ wires the file/animation surfaces.
    can_write_files: false,
    can_render_animation: false,
    scratch_dir: join(tmpdir(), 'pyr3-renders'),
    gpu_adapter: ctx.gpuAdapter,
  };
}

export function makeCapabilitiesRoute(ctx: CapabilityCtx) {
  return (_req: IncomingMessage, res: ServerResponse): void => {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(buildCapability(ctx)));
  };
}
