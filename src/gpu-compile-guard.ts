// #263 — shared compile-error guard for the *.gpu.test.ts finite-output smokes.
//
// Why this exists (the #259 false-positive, generalized): a `*.gpu.test.ts`
// smoke that hand-assembles a WGSL shader from a sliced region + prelude and
// then asserts only `Number.isFinite(output)` will SILENTLY PASS on a shader
// that fails to compile. `createShaderModule` never throws on a bad shader —
// Dawn defers the error — so an invalid module makes the compute dispatch a
// no-op, the output buffer reads back zero-initialized, and `isFinite(0)` is
// true for every case. #259 found `issue121-Lall{,-tail}.gpu.test.ts` had been
// exactly this: 12+ undefined helper symbols, zero real GPU coverage for all 62
// V152-V219 variations, a green test the whole time.
//
// THE CONVENTION: a finite-assert GPU smoke MUST pair with a compile-error
// guard, else it is a test that cannot fail. Use this helper as the drop-in
// replacement for `dev.createShaderModule({ code })` so the assertion is
// impossible to forget.

/**
 * Create a shader module and assert it compiles without any error-severity
 * messages. Drop-in for `dev.createShaderModule({ code })` in finite-output
 * GPU smokes — returns the module so the call site keeps using it for the
 * pipeline, but throws (failing the test) the instant the WGSL is invalid.
 *
 * @param dev   the GPUDevice
 * @param code  the assembled WGSL source
 * @param label optional label, surfaced in the thrown error for triage
 */
export async function compileChecked(
  dev: GPUDevice,
  code: string,
  label?: string,
): Promise<GPUShaderModule> {
  const mod = dev.createShaderModule(label ? { code, label } : { code });
  const info = await mod.getCompilationInfo();
  const errors = info.messages.filter((m) => m.type === 'error');
  if (errors.length > 0) {
    const detail = errors
      .map((m) => `  ${m.lineNum}:${m.linePos} ${m.message}`)
      .join('\n');
    throw new Error(
      `WGSL compile error${label ? ` in "${label}"` : ''} (#263 compile guard) — ` +
        `a finite-output smoke on this shader would silently pass on the resulting ` +
        `no-op dispatch. Errors:\n${detail}`,
    );
  }
  return mod;
}
