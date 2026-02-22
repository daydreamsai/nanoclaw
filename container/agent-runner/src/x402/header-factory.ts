export interface RouterConfig {
  network: string;
  asset: string;
  payTo: string;
  facilitatorSigner: string;
  tokenName: string;
  tokenVersion: string;
  paymentHeader?: string;
}

export interface PaymentPayload {
  x402Version: 2;
  accepted: {
    scheme: 'upto';
    network: string;
    asset: string;
    payTo: string;
    extra: {
      name: string;
      version: string;
    };
  };
  payload: {
    authorization: {
      from: string;
      to: string;
      value: string;
      validBefore: string;
      nonce: string;
    };
    signature: string;
  };
}

export interface SignatureInput {
  network: string;
  asset: string;
  payTo: string;
  facilitatorSigner: string;
  tokenName: string;
  tokenVersion: string;
  permitCap: string;
  minDeadlineExclusive?: number;
}

export interface SignatureOutput {
  signature: string;
  nonce: string;
  deadline: string;
  accountAddress: string;
}

export type SignatureFn = (input: SignatureInput) => Promise<SignatureOutput>;

interface CachedHeader {
  value: string;
  deadline: number;
  maxValue: string;
  network: string;
  asset: string;
  payTo: string;
}

export interface HeaderResult {
  headerName: string;
  headerValue: string;
  deadline: number;
}

export interface HeaderFactory {
  getHeader(options?: {
    capOverride?: string;
    minDeadlineExclusive?: number;
  }): Promise<HeaderResult>;
  invalidate(): void;
  updateConfig(nextConfig: RouterConfig): void;
  getConfig(): RouterConfig;
}

const PRE_INVALIDATE_WINDOW_SECONDS = 60;

function encodePaymentPayload(payload: PaymentPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
}

export function decodePaymentPayload(encoded: string): PaymentPayload {
  const decoded = Buffer.from(encoded, 'base64').toString('utf8');
  return JSON.parse(decoded) as PaymentPayload;
}

function buildPaymentPayload(input: {
  config: RouterConfig;
  accountAddress: string;
  permitCap: string;
  signature: string;
  nonce: string;
  deadline: string;
}): PaymentPayload {
  return {
    x402Version: 2,
    accepted: {
      scheme: 'upto',
      network: input.config.network,
      asset: input.config.asset,
      payTo: input.config.payTo,
      extra: {
        name: input.config.tokenName,
        version: input.config.tokenVersion,
      },
    },
    payload: {
      authorization: {
        from: input.accountAddress,
        to: input.config.facilitatorSigner,
        value: input.permitCap,
        validBefore: input.deadline,
        nonce: input.nonce,
      },
      signature: input.signature,
    },
  };
}

function isNearDeadline(deadline: number): boolean {
  const now = Math.floor(Date.now() / 1000);
  return deadline - now <= PRE_INVALIDATE_WINDOW_SECONDS;
}

export function createPaymentHeaderFactory(input: {
  config: RouterConfig;
  permitCap: string;
  signatureFn: SignatureFn;
}): HeaderFactory {
  let config = input.config;
  let cached: CachedHeader | null = null;

  const getHeader: HeaderFactory['getHeader'] = async (options) => {
    const cap = options?.capOverride || input.permitCap;
    const forceRefresh = options?.minDeadlineExclusive !== undefined;

    if (
      cached &&
      !forceRefresh &&
      cached.maxValue === cap &&
      cached.network === config.network &&
      cached.asset === config.asset &&
      cached.payTo === config.payTo &&
      !isNearDeadline(cached.deadline)
    ) {
      return {
        headerName: config.paymentHeader || 'PAYMENT-SIGNATURE',
        headerValue: cached.value,
        deadline: cached.deadline,
      };
    }

    const signature = await input.signatureFn({
      network: config.network,
      asset: config.asset,
      payTo: config.payTo,
      facilitatorSigner: config.facilitatorSigner,
      tokenName: config.tokenName,
      tokenVersion: config.tokenVersion,
      permitCap: cap,
      minDeadlineExclusive: options?.minDeadlineExclusive,
    });

    const payload = buildPaymentPayload({
      config,
      accountAddress: signature.accountAddress,
      permitCap: cap,
      signature: signature.signature,
      nonce: signature.nonce,
      deadline: signature.deadline,
    });
    const encoded = encodePaymentPayload(payload);
    const deadline = parseInt(signature.deadline, 10);

    cached = {
      value: encoded,
      deadline,
      maxValue: cap,
      network: config.network,
      asset: config.asset,
      payTo: config.payTo,
    };

    return {
      headerName: config.paymentHeader || 'PAYMENT-SIGNATURE',
      headerValue: encoded,
      deadline,
    };
  };

  return {
    getHeader,
    invalidate() {
      cached = null;
    },
    updateConfig(nextConfig: RouterConfig) {
      config = nextConfig;
    },
    getConfig() {
      return config;
    },
  };
}
