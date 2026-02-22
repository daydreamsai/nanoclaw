import {
  createPublicClient,
  createWalletClient,
  http,
  type Account,
  type Chain,
  type WalletClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base, baseSepolia, mainnet } from 'viem/chains';

import type { SignatureFn } from './header-factory.js';

const PRIVATE_KEY_REGEX = /^0x[0-9a-fA-F]{64}$/;
const DEFAULT_VALIDITY_SECONDS = 3600;

const CHAINS: Record<string, Chain> = {
  'eip155:8453': base,
  'eip155:84532': baseSepolia,
  'eip155:1': mainnet,
};

const PERMIT_TYPES = {
  Permit: [
    { name: 'owner', type: 'address' },
    { name: 'spender', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const;

const ERC2612_NONCES_ABI = [
  {
    type: 'function',
    name: 'nonces',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ name: 'nonce', type: 'uint256' }],
  },
] as const;

export function normalizePrivateKey(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  const normalized = trimmed.startsWith('0X') ? `0x${trimmed.slice(2)}` : trimmed;
  return PRIVATE_KEY_REGEX.test(normalized) ? normalized : null;
}

async function fetchPermitNonce(
  chain: Chain,
  token: `0x${string}`,
  owner: `0x${string}`,
): Promise<bigint> {
  const publicClient = createPublicClient({
    chain,
    transport: http(),
  });

  return await publicClient.readContract({
    address: token,
    abi: ERC2612_NONCES_ABI,
    functionName: 'nonces',
    args: [owner],
  });
}

export function createEnvPrivateKeySignatureFn(privateKey: `0x${string}`): SignatureFn {
  return async (input) => {
    const chain = CHAINS[input.network] || base;
    const chainId = parseInt(input.network.split(':')[1], 10);
    const account = privateKeyToAccount(privateKey);

    const wallet: WalletClient = createWalletClient({
      account,
      chain,
      transport: http(),
    });

    let deadline = Math.floor(Date.now() / 1000) + DEFAULT_VALIDITY_SECONDS;
    if (input.minDeadlineExclusive !== undefined && deadline <= input.minDeadlineExclusive) {
      deadline = input.minDeadlineExclusive + 1;
    }

    const nonceValue = await fetchPermitNonce(
      chain,
      input.asset as `0x${string}`,
      account.address as `0x${string}`,
    );
    const nonce = nonceValue.toString();

    const signature = await wallet.signTypedData({
      account: account as Account,
      domain: {
        name: input.tokenName,
        version: input.tokenVersion,
        chainId,
        verifyingContract: input.asset as `0x${string}`,
      },
      types: PERMIT_TYPES,
      primaryType: 'Permit',
      message: {
        owner: account.address,
        spender: input.facilitatorSigner as `0x${string}`,
        value: BigInt(input.permitCap),
        nonce: BigInt(nonce),
        deadline: BigInt(deadline),
      },
    });

    return {
      signature,
      nonce,
      deadline: deadline.toString(),
      accountAddress: account.address,
    };
  };
}

type SigningMode = 'env_pk' | 'static_header';

type X402SigningSource =
  | {
      mode: 'signature';
      signatureFn: SignatureFn;
    }
  | {
      mode: 'static_header';
      headerName: string;
      headerValue: string;
    };

export function resolveX402SigningSource(input: {
  signerMode?: SigningMode;
  paymentHeader?: string;
  secrets: Record<string, string | undefined>;
}): X402SigningSource {
  const mode = input.signerMode || 'env_pk';
  if (mode === 'static_header') {
    const headerValue = input.secrets.X402_STATIC_PAYMENT_HEADER?.trim();
    if (!headerValue) {
      throw new Error('X402_STATIC_PAYMENT_HEADER is required for static_header mode');
    }
    return {
      mode: 'static_header',
      headerName: input.paymentHeader || 'PAYMENT-SIGNATURE',
      headerValue,
    };
  }

  const normalized = normalizePrivateKey(input.secrets.X402_PRIVATE_KEY);
  if (!normalized) {
    throw new Error('X402_PRIVATE_KEY is missing or invalid for env_pk mode');
  }
  return {
    mode: 'signature',
    signatureFn: createEnvPrivateKeySignatureFn(normalized as `0x${string}`),
  };
}
