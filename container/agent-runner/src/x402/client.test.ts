import { describe, expect, it, vi } from 'vitest';

import { createX402Fetch } from './client.js';
import { decodePaymentPayload, type SignatureFn } from './header-factory.js';

const baseConfig = {
  network: 'eip155:8453',
  asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  payTo: '0x1234567890abcdef1234567890abcdef12345678',
  facilitatorSigner: '0x1234567890abcdef1234567890abcdef12345678',
  tokenName: 'USD Coin',
  tokenVersion: '2',
  paymentHeader: 'PAYMENT-SIGNATURE',
};

function getHeaderValue(init: RequestInit | undefined, headerName: string): string | null {
  const headers = new Headers(init?.headers);
  return headers.get(headerName);
}

function encodePaymentRequired(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
}

describe('createX402Fetch', () => {
  it('injects payment header for router requests and skips config endpoint', async () => {
    const baseFetch = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const signatureFn: SignatureFn = vi.fn().mockResolvedValue({
      signature: '0xsig',
      nonce: '1',
      deadline: `${Math.floor(Date.now() / 1000) + 600}`,
      accountAddress: '0x9999999999999999999999999999999999999999',
    });

    const wrapped = createX402Fetch({
      baseFetch,
      routerUrl: 'https://router.example.com',
      permitCap: '1000000',
      signatureFn,
      initialConfig: baseConfig,
    });

    await wrapped('https://router.example.com/v1/config', {});
    expect(signatureFn).toHaveBeenCalledTimes(0);

    await wrapped('https://router.example.com/v1/chat/completions', {
      method: 'POST',
      body: '{}',
    });

    expect(signatureFn).toHaveBeenCalledTimes(1);
    const calls = baseFetch.mock.calls as unknown as Array<[RequestInfo | URL, RequestInit | undefined]>;
    const header = getHeaderValue(calls[1]?.[1], 'PAYMENT-SIGNATURE');
    expect(header).toBeTruthy();
    const decoded = decodePaymentPayload(header!);
    expect(decoded.payload.authorization.nonce).toBe('1');
  });

  it('retries once on invalidating 402 errors using refreshed permit', async () => {
    const baseFetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 'cap_exhausted' }), {
          status: 402,
          headers: {
            'PAYMENT-REQUIRED': encodePaymentRequired({
              accepts: [{
                scheme: 'upto',
                network: 'eip155:8453',
                asset: baseConfig.asset,
                payTo: baseConfig.payTo,
                extra: { name: 'USD Coin', version: '2', maxAmountRequired: '500000' },
              }],
            }),
          },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'ok' }), { status: 200 }),
      );

    const signatureFn: SignatureFn = vi
      .fn()
      .mockResolvedValueOnce({
        signature: '0xaaa',
        nonce: '1',
        deadline: `${Math.floor(Date.now() / 1000) + 600}`,
        accountAddress: '0x9999999999999999999999999999999999999999',
      })
      .mockResolvedValueOnce({
        signature: '0xbbb',
        nonce: '2',
        deadline: `${Math.floor(Date.now() / 1000) + 601}`,
        accountAddress: '0x9999999999999999999999999999999999999999',
      });

    const wrapped = createX402Fetch({
      baseFetch,
      routerUrl: 'https://router.example.com',
      permitCap: '1000000',
      signatureFn,
      initialConfig: baseConfig,
    });

    const response = await wrapped('https://router.example.com/v1/chat/completions', {
      method: 'POST',
      body: '{}',
    });

    expect(response.status).toBe(200);
    expect(baseFetch).toHaveBeenCalledTimes(2);
    expect(signatureFn).toHaveBeenCalledTimes(2);

    const calls = baseFetch.mock.calls as unknown as Array<[RequestInfo | URL, RequestInit | undefined]>;
    const firstHeader = getHeaderValue(calls[0]?.[1], 'PAYMENT-SIGNATURE');
    const secondHeader = getHeaderValue(calls[1]?.[1], 'PAYMENT-SIGNATURE');
    expect(firstHeader).toBeTruthy();
    expect(secondHeader).toBeTruthy();
    expect(firstHeader).not.toBe(secondHeader);

    const firstDecoded = decodePaymentPayload(firstHeader!);
    const secondDecoded = decodePaymentPayload(secondHeader!);
    expect(firstDecoded.payload.authorization.nonce).toBe('1');
    expect(secondDecoded.payload.authorization.nonce).toBe('2');
    expect(secondDecoded.payload.authorization.value).toBe('500000');
  });
});
