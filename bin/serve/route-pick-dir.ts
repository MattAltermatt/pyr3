// POST /api/pick-dir — show a native OS folder picker and return the chosen
// absolute path. Used by the /v1/animate Export modal so the user can pick
// an output directory instead of typing one (#212 follow-up).
//
// Browser File System Access API would seem natural here, but it hides
// absolute paths from JS by design — and we need a path the *backend* can
// resolve, since the SSE stream writes PNGs server-side. Routing the picker
// through pyr3 serve solves that: backend has FS + native dialog access,
// browser just gets a string back to prefill the form.
//
// Per-platform picker:
//   macOS   — osascript "choose folder" (built-in)
//   Linux   — zenity --file-selection --directory (optional dep; returns
//             a graceful 501 if not installed)
//   Windows — PowerShell FolderBrowserDialog (built-in)
//
// Response shape:
//   { path: "/abs/path" }     — user picked a folder
//   { path: null }            — user dismissed the dialog
//   { error: "..." }          — picker unavailable on this OS / shell

import type { IncomingMessage, ServerResponse } from 'node:http';
import { execFile } from 'node:child_process';
import { platform } from 'node:os';

interface PickResult {
  path?: string | null;
  error?: string;
}

function reply(res: ServerResponse, body: PickResult, status = 200): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function execAndCapture(cmd: string, args: string[]): Promise<{
  code: number;
  stdout: string;
  stderr: string;
  spawnError?: NodeJS.ErrnoException;
}> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 10 * 60 * 1000 }, (err, stdout, stderr) => {
      if (err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
        resolve({ code: -1, stdout: '', stderr: '', spawnError: err as NodeJS.ErrnoException });
        return;
      }
      const code = err && typeof (err as { code?: number }).code === 'number'
        ? (err as { code: number }).code
        : err ? 1 : 0;
      resolve({ code, stdout: stdout ?? '', stderr: stderr ?? '' });
    });
  });
}

export async function handlePickDir(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  const p = platform();

  if (p === 'darwin') {
    // `choose folder` is a built-in AppleScript dialog. Wrap in a frontmost
    // tell so the dialog reliably comes to the foreground (handy when the
    // browser tab has focus). User cancel surfaces as exit code 1 with
    // stderr containing "User canceled." — surface as { path: null }.
    const script =
      'tell application "System Events" to activate\n'
      + 'POSIX path of (choose folder with prompt "Select pyr3 export folder")';
    const result = await execAndCapture('osascript', ['-e', script]);
    if (result.spawnError) {
      reply(res, { error: 'osascript not available' }, 501);
      return;
    }
    if (result.code === 0) {
      // POSIX path returns `/Users/foo/Desktop/` with trailing slash; strip
      // for clean comparisons.
      const path = result.stdout.trim().replace(/\/$/, '');
      reply(res, { path });
    } else if (/canceled|User canceled/i.test(result.stderr)) {
      reply(res, { path: null });
    } else {
      reply(res, { error: result.stderr.trim() || 'osascript failed' }, 500);
    }
    return;
  }

  if (p === 'linux') {
    const result = await execAndCapture('zenity', ['--file-selection', '--directory', '--title=Select pyr3 export folder']);
    if (result.spawnError) {
      reply(res, { error: 'zenity not installed — pick a folder via the text input instead' }, 501);
      return;
    }
    if (result.code === 0) {
      reply(res, { path: result.stdout.trim() });
    } else {
      // zenity returns exit code 1 on cancel, no stderr noise.
      reply(res, { path: null });
    }
    return;
  }

  if (p === 'win32') {
    const ps =
      "Add-Type -AssemblyName System.Windows.Forms;"
      + " $d = New-Object System.Windows.Forms.FolderBrowserDialog;"
      + " $d.Description = 'Select pyr3 export folder';"
      + " if ($d.ShowDialog() -eq 'OK') { Write-Output $d.SelectedPath }";
    const result = await execAndCapture('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps]);
    if (result.spawnError) {
      reply(res, { error: 'powershell not available' }, 501);
      return;
    }
    if (result.code === 0) {
      const path = result.stdout.trim();
      reply(res, { path: path.length > 0 ? path : null });
    } else {
      reply(res, { error: result.stderr.trim() || 'picker failed' }, 500);
    }
    return;
  }

  reply(res, { error: `native folder picker not supported on platform "${p}"` }, 501);
}
