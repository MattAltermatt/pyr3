import { describe, it, expect } from 'vitest';
import { groupIdsByChunk, buildChunkObject } from './chunk-emit';

describe('chunk-emit helpers', () => {
  it('groups ids into 256-wide chunk windows (sorted)', () => {
    expect(groupIdsByChunk([300, 0, 256, 1, 255])).toEqual(
      new Map([
        [0, [0, 1, 255]],
        [256, [256, 300]],
      ]),
    );
  });

  it('handles an empty id list', () => {
    expect(groupIdsByChunk([])).toEqual(new Map());
  });

  it('builds an id→json-string chunk object', () => {
    const obj = buildChunkObject([
      { id: 0, json: '{"a":1}' },
      { id: 5, json: '{"b":2}' },
    ]);
    expect(obj['0']).toBe('{"a":1}');
    expect(obj['5']).toBe('{"b":2}');
    expect(Object.keys(obj)).toEqual(['0', '5']);
  });
});
