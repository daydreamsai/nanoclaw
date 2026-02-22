import { describe, expect, it, vi } from 'vitest';

import {
  createPaymentHeaderFactory,
  decodePaymentPayload,
  type SignatureFn,
} from './header-factory.js';

const baseConfig = {
  network: 'eip155:8453',
  asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  payTo: '0x1234567890abcdef1234567890abcdef12345678',
  facilitatorSigner: '0x1234567890abcdef1234567890abcdef12345678',
  tokenName: 'USD Coin',
  tokenVersion: '2',
  paymentHeader: 'PAYMENT-SIGNATURE',
};

describe('createPaymentHeaderFactory', () => {
  it('builds x402 header with injected signature function', async () => {
    const signatureFn: SignatureFn = vi.fn().mockResolvedValue({
      signature: '0xabc123',
      nonce: '7',
      deadline: '1700000123',
    });

    const factory = createPaymentHeaderFactory({
      config: baseConfig,
      permitCap: '1000000',
      signatureFn,
    });

    const header = await factory.getHeader();
    const decoded = decodePaymentPayload(header.headerValue);

    expect(signatureFn).toHaveBeenCalledTimes(1);
    expect(header.headerName).toBe('PAYMENT-SIGNATURE');
    expect(decoded.payload.authorization.value).toBe('1000000');
    expect(decoded.payload.authorization.nonce).toBe('7');
    expect(decoded.payload.authorization.validBefore).toBe('1700000123');
  });

  it('caches header payload until invalidated', async () => {
    const signatureFn: SignatureFn = vi.fn().mockResolvedValue({
      signature: '0xabc123',
      nonce: '7',
      deadline: `${Math.floor(Date.now() / 1000) + 600}`,
    });

    const factory = createPaymentHeaderFactory({
      config: baseConfig,
      permitCap: '1000000',
      signatureFn,
    });

    const first = await factory.getHeader();
    const second = await factory.getHeader();

    expect(first.headerValue).toBe(second.headerValue);
    expect(signatureFn).toHaveBeenCalledTimes(1);

    factory.invalidate();
    await factory.getHeader();
    expect(signatureFn).toHaveBeenCalledTimes(2);
  });
});
