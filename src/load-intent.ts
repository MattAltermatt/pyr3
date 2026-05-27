// What pyr3 should load when the page boots. Driven entirely by
// the ?flame=<encoded> URL param; absent → "default" (main.ts resolves
// to the hardcoded welcome flame). No other URL params recognized —
// keeps the URL surface area to exactly one share mechanism.

export type LoadIntent =
  | { kind: 'flame'; payload: string }
  | { kind: 'default' };

export function parseLoadIntent(search: string): LoadIntent {
  const params = new URLSearchParams(search);
  const flame = params.get('flame');
  if (flame) return { kind: 'flame', payload: flame };
  return { kind: 'default' };
}
