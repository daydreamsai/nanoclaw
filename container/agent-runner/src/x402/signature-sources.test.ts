import { describe, expect, it } from 'vitest';

import {
  normalizePrivateKey,
  resolveX402SigningSource,
} from './signature-sources.js';

describe('normalizePrivateKey', () => {
  it('normalizes uppercase 0X keys', () => {
    const key = '0X' + 'a'.repeat(64);
    expect(normalizePrivateKey(key)).toBe('0x' + 'a'.repeat(64));
  });

  it('rejects invalid private key format', () => {
    expect(normalizePrivateKey('0x1234')).toBeNull();
    expect(normalizePrivateKey('')).toBeNull();
  });
});

describe('resolveX402SigningSource', () => {
  it('returns static header source when mode is static_header', () => {
    const source = resolveX402SigningSource({
      signerMode: 'static_header',
      paymentHeader: 'PAYMENT-SIGNATURE',
      secrets: {
        X402_STATIC_PAYMENT_HEADER: 'signed-static-header',
      },
    });

    expect(source.mode).toBe('static_header');
    if (source.mode !== 'static_header') {
      throw new Error('expected static mode');
    }
    expect(source.headerName).toBe('PAYMENT-SIGNATURE');
    expect(source.headerValue).toBe('signed-static-header');
  });
});
