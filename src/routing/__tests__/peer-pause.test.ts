import { describe, it, expect } from 'vitest';
import { createPeerPauseStore } from '../peer-pause.js';

describe('PeerPauseStore — basic shape', () => {
  it('starts empty and reports unpaused for unknown peers', () => {
    const store = createPeerPauseStore({ filePath: ':memory:' });
    expect(store.list()).toEqual([]);
    const result = store.isPaused('amina', 'whatsapp:business:37120000@s.whatsapp.net');
    expect(result.paused).toBe(false);
    expect(result.entry).toBeUndefined();
  });
});
