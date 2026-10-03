import { describe, expect, it } from 'vitest';
import { realtimeUrl } from './realtime-probe.js';

describe('realtimeUrl', () => {
  it('uses wss for https and ws for http, the realtime path and the engine.io query', () => {
    expect(realtimeUrl('https://api.example.com')).toBe('wss://api.example.com/realtime/?EIO=4&transport=websocket');
    expect(realtimeUrl('http://api:3000')).toBe('ws://api:3000/realtime/?EIO=4&transport=websocket');
  });
});
