import { describe, expect, it } from 'vitest';
import { readJoinCode } from '../pages/LoginPage';

describe('readJoinCode (typed code or scanned QR on the sign-in page)', () => {
  it('reads a live game link', () => {
    expect(readJoinCode('https://openqz.example.org/live/123456')).toEqual({ kind: 'live', code: '123456' });
  });
  it('reads a room link, with or without a query', () => {
    expect(readJoinCode('https://openqz.example.org/join/654321')).toEqual({ kind: 'room', code: '654321' });
    expect(readJoinCode('http://localhost:8088/join/654321?x=1')).toEqual({ kind: 'room', code: '654321' });
  });
  it('reads a bare code, spaced or not', () => {
    expect(readJoinCode(' 123 456 ')).toEqual({ kind: 'code', code: '123456' });
  });
  it('refuses anything else', () => {
    expect(readJoinCode('https://example.org/')).toBeNull();
    expect(readJoinCode('12345')).toBeNull();
    expect(readJoinCode('https://openqz.example.org/join/1234567')).toBeNull();
    expect(readJoinCode('WIFI:S:campus;T:WPA;P:secret;;')).toBeNull();
  });
});
