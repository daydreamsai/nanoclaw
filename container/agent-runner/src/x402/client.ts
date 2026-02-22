import {
  createPaymentHeaderFactory,
  type HeaderFactory,
  type RouterConfig,
  type SignatureFn,
} from './header-factory.js';

interface ErrorResponse {
  code?: string;
  error?: string;
  message?: string;
}

interface PaymentRequiredExtra {
  name?: string;
  version?: string;
  maxAmount?: string;
  max_amount?: string;
  maxAmountRequired?: string;
  max_amount_required?: string;
}

interface PaymentRequirement {
  scheme?: string;
  network?: string;
  asset?: string;
  amount?: string;
  payTo?: string;
  pay_to?: string;
  extra?: PaymentRequiredExtra;
}

interface PaymentRequiredHeader {
  accepts?: PaymentRequirement[];
}

interface RouterConfigResponse {
  networks?: Array<{
    network_id?: string;
    asset?: {
      address?: string;
    };
    pay_to?: string;
  }>;
  payment_header?: string;
  eip712_config?: {
    domain_name?: string;
    domain_version?: string;
  };
}

const DEFAULT_USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

function normalizeErrorText(error?: string, message?: string): string {
  return `${error ?? ''} ${message ?? ''}`.toLowerCase();
}

function isCapExhausted(error: ErrorResponse): boolean {
  if (!error) return false;
  if (error.code === 'cap_exhausted') return true;
  const text = normalizeErrorText(error.error, error.message);
  return text.includes('cap exhausted');
}

function isSessionClosed(error: ErrorResponse): boolean {
  if (!error) return false;
  if (error.code === 'session_closed') return true;
  const text = normalizeErrorText(error.error, error.message);
  return text.includes('session closed');
}

function isSettlementBlocked(error: ErrorResponse): boolean {
  if (!error) return false;
  if (error.code === 'settlement_blocked') return true;
  const text = normalizeErrorText(error.error, error.message);
  return text.includes('settlement blocked') || text.includes('blocked after previous settlement');
}

function shouldInvalidatePermit(error: ErrorResponse): boolean {
  return isCapExhausted(error) || isSessionClosed(error) || isSettlementBlocked(error);
}

function parseErrorResponse(data: unknown): ErrorResponse | null {
  if (!data || typeof data !== 'object') return null;
  const record = data as Record<string, unknown>;
  if (typeof record.code === 'string' || typeof record.error === 'string') {
    return {
      code: typeof record.code === 'string' ? record.code : undefined,
      error:
        typeof record.error === 'string'
          ? record.error
          : typeof record.message === 'string'
            ? record.message
            : undefined,
      message: typeof record.message === 'string' ? record.message : undefined,
    };
  }
  const nested = record.error;
  if (nested && typeof nested === 'object') {
    const nestedRecord = nested as Record<string, unknown>;
    return {
      code:
        typeof nestedRecord.code === 'string'
          ? nestedRecord.code
          : typeof nestedRecord.type === 'string'
            ? nestedRecord.type
            : undefined,
      error:
        typeof nestedRecord.message === 'string'
          ? nestedRecord.message
          : typeof nestedRecord.error === 'string'
            ? nestedRecord.error
            : undefined,
      message: typeof nestedRecord.message === 'string' ? nestedRecord.message : undefined,
    };
  }
  return null;
}

async function extractErrorResponse(response: Response): Promise<ErrorResponse | null> {
  try {
    return parseErrorResponse(await response.clone().json());
  } catch {
    return null;
  }
}

function decodePaymentRequiredHeader(value: string): PaymentRequiredHeader | null {
  try {
    const decoded = Buffer.from(value, 'base64').toString('utf8');
    const parsed = JSON.parse(decoded);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed as PaymentRequiredHeader;
  } catch {
    return null;
  }
}

function getRequirementPayTo(requirement?: PaymentRequirement): string | null {
  if (!requirement) return null;
  return requirement.payTo || requirement.pay_to || null;
}

function getRequirementMaxAmountRequired(
  requirement?: PaymentRequirement,
): string | undefined {
  if (!requirement) return undefined;
  return (
    requirement.extra?.maxAmountRequired ||
    requirement.extra?.max_amount_required ||
    requirement.extra?.maxAmount ||
    requirement.extra?.max_amount ||
    requirement.amount
  );
}

function applyPaymentRequirement(
  config: RouterConfig,
  requirement?: PaymentRequirement,
): RouterConfig {
  if (!requirement) return config;
  const payTo = getRequirementPayTo(requirement) || config.payTo;
  return {
    ...config,
    network: requirement.network || config.network,
    asset: requirement.asset || config.asset,
    payTo,
    facilitatorSigner: payTo || config.facilitatorSigner,
    tokenName: requirement.extra?.name || config.tokenName,
    tokenVersion: requirement.extra?.version || config.tokenVersion,
  };
}

function parseRouterConfigResponse(data: RouterConfigResponse): RouterConfig {
  const network = data.networks?.[0];
  const payTo = network?.pay_to || '';
  return {
    network: network?.network_id || 'eip155:8453',
    asset: network?.asset?.address || DEFAULT_USDC_BASE,
    payTo,
    facilitatorSigner: payTo,
    tokenName: data.eip712_config?.domain_name || 'USD Coin',
    tokenVersion: data.eip712_config?.domain_version || '2',
    paymentHeader: data.payment_header || 'PAYMENT-SIGNATURE',
  };
}

async function fetchRouterConfig(
  baseFetch: typeof fetch,
  routerUrl: string,
): Promise<RouterConfig> {
  const response = await baseFetch(`${routerUrl}/v1/config`);
  if (!response.ok) {
    throw new Error(`Failed to fetch router config: ${response.status}`);
  }
  const data = (await response.json()) as RouterConfigResponse;
  return parseRouterConfigResponse(data);
}

function getDefaultConfig(network: string): RouterConfig {
  return {
    network,
    asset: DEFAULT_USDC_BASE,
    payTo: '',
    facilitatorSigner: '',
    tokenName: 'USD Coin',
    tokenVersion: '2',
    paymentHeader: 'PAYMENT-SIGNATURE',
  };
}

interface X402FetchInput {
  routerUrl: string;
  permitCap: string;
  signatureFn?: SignatureFn;
  baseFetch?: typeof fetch;
  initialConfig?: RouterConfig;
  network?: string;
  staticHeaderName?: string;
  staticHeaderValue?: string;
}

export function createX402Fetch(input: X402FetchInput): typeof fetch {
  const baseFetch = input.baseFetch || fetch;
  const routerOrigin = new URL(input.routerUrl).origin;
  const routerBase = input.routerUrl.replace(/\/+$/, '');

  let configPromise: Promise<RouterConfig> | null = input.initialConfig
    ? Promise.resolve(input.initialConfig)
    : null;
  let headerFactoryPromise: Promise<HeaderFactory> | null = null;

  const getConfig = async (): Promise<RouterConfig> => {
    if (!configPromise) {
      configPromise = fetchRouterConfig(baseFetch, routerBase).catch(() => {
        return getDefaultConfig(input.network || 'eip155:8453');
      });
    }
    return configPromise;
  };

  const getFactory = async (): Promise<HeaderFactory> => {
    if (!input.signatureFn) {
      throw new Error('signatureFn is required when static header mode is not enabled');
    }
    if (!headerFactoryPromise) {
      headerFactoryPromise = getConfig().then((config) =>
        createPaymentHeaderFactory({
          config,
          permitCap: input.permitCap,
          signatureFn: input.signatureFn!,
        }),
      );
    }
    return headerFactoryPromise;
  };

  const wrappedFetch: typeof fetch = async (
    requestInfo: RequestInfo | URL,
    requestInit?: RequestInit,
  ): Promise<Response> => {
    const rawUrl =
      typeof requestInfo === 'string'
        ? requestInfo
        : requestInfo instanceof URL
          ? requestInfo.toString()
          : requestInfo.url;

    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      parsed = new URL(rawUrl, routerOrigin);
    }

    const pathname = parsed.pathname;
    const isConfigPath = pathname.endsWith('/v1/config') || pathname.endsWith('/config');
    const isModelsPath = pathname.endsWith('/v1/models') || pathname.endsWith('/models');
    const isRouterRequest = parsed.origin === routerOrigin;

    if (!isRouterRequest || isConfigPath || isModelsPath) {
      return baseFetch(requestInfo, requestInit);
    }

    const staticHeaderName = input.staticHeaderName || 'PAYMENT-SIGNATURE';
    const staticHeaderValue = input.staticHeaderValue;
    const factory = staticHeaderValue ? null : await getFactory();

    const sendWithPermit = async (
      capOverride?: string,
      minDeadlineExclusive?: number,
    ): Promise<{ response: Response; deadline?: number }> => {
      const headers = new Headers(requestInit?.headers);
      if (staticHeaderValue) {
        headers.set(staticHeaderName, staticHeaderValue);
        const response = await baseFetch(requestInfo, { ...requestInit, headers });
        return { response };
      }

      const header = await factory!.getHeader({ capOverride, minDeadlineExclusive });
      headers.set(header.headerName, header.headerValue);
      const response = await baseFetch(requestInfo, { ...requestInit, headers });
      return { response, deadline: header.deadline };
    };

    const initial = await sendWithPermit();
    if (initial.response.status !== 401 && initial.response.status !== 402) {
      return initial.response;
    }

    const error = await extractErrorResponse(initial.response);
    const paymentRequired = initial.response.headers.get('PAYMENT-REQUIRED');
    const decoded = paymentRequired
      ? decodePaymentRequiredHeader(paymentRequired)
      : null;
    const requirement = decoded?.accepts?.[0];

    if (requirement && factory) {
      factory.updateConfig(applyPaymentRequirement(factory.getConfig(), requirement));
    }

    if (!error || !shouldInvalidatePermit(error) || !factory) {
      return initial.response;
    }

    factory.invalidate();
    const maxAmount = getRequirementMaxAmountRequired(requirement);
    const refreshed = await sendWithPermit(maxAmount, initial.deadline);
    return refreshed.response;
  };

  return wrappedFetch;
}
