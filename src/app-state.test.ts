import { describe, it, expect, beforeEach } from 'vitest';
import { setCurrentFlame, getCurrentFlame, clearCurrentFlame } from './app-state';

describe('app-state.currentFlame', () => {
  beforeEach(() => clearCurrentFlame());

  it('stores and retrieves the current flame', () => {
    const genome = { name: 'test', xforms: [] } as any;
    setCurrentFlame({ genome, corpusId: { gen: 198, id: 7372 } });
    const current = getCurrentFlame();
    expect(current?.genome.name).toBe('test');
    expect(current?.corpusId?.gen).toBe(198);
  });

  it('returns null when nothing is set', () => {
    expect(getCurrentFlame()).toBeNull();
  });

  it('clears the current flame', () => {
    setCurrentFlame({ genome: { name: 'x' } as any });
    clearCurrentFlame();
    expect(getCurrentFlame()).toBeNull();
  });
});
