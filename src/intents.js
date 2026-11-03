// NEAR Intents 1Click API: the client pays with any token on any chain, the freelancer receives USDC on NEAR.
// Docs: https://docs.near-intents.org/near-intents/integration/distribution-channels/1click-api

export const USDC = 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1'; // USDC on NEAR, 6 decimals
const EURE = { symbol: 'EURe', blockchain: 'gnosis' }; // its USD price gives us the euro rate
export const FINAL = ['SUCCESS', 'REFUNDED', 'FAILED'];

/** What the payment page offers, in this order. Anything not live in /v0/tokens is skipped. */
export const PAY_WITH = [
  ['USDC', 'near'], ['USDT', 'near'], ['USDC', 'base'], ['USDC', 'arb'], ['USDC', 'sol'], ['USDC', 'eth'],
  ['USDT', 'tron'], ['USDT', 'eth'], ['USDT', 'sol'], ['USDT', 'bsc'],
  ['BTC', 'btc'], ['ETH', 'eth'], ['ETH', 'base'], ['ETH', 'arb'], ['SOL', 'sol'], ['wNEAR', 'near'],
  ['ZEC', 'zec'], ['BCH', 'bch'], ['LTC', 'ltc'], ['DOGE', 'doge'], ['XRP', 'xrp'], ['TRX', 'tron'],
];

export const CHAIN_NAMES = {
  near: 'NEAR', base: 'Base', arb: 'Arbitrum', sol: 'Solana', eth: 'Ethereum', tron: 'Tron', bsc: 'BNB Chain',
  btc: 'Bitcoin', zec: 'Zcash', bch: 'Bitcoin Cash', ltc: 'Litecoin', doge: 'Dogecoin', xrp: 'XRP Ledger',
};

const STABLE = new Set(['USDC', 'USDT']);

export class IntentsError extends Error {
  constructor(status, body) {
    super(`1Click ${status}: ${body?.message || 'error'}`);
    this.status = status;
    this.detail = String(body?.message || '');
  }
}

/** Named NEAR accounts (alice.near), implicit ones (64 hex) and ETH-implicit (0x + 40 hex). */
export const isNearAccount = (s) => {
  const a = String(s || '').trim().toLowerCase();
  if (/^[0-9a-f]{64}$/.test(a) || /^0x[0-9a-f]{40}$/.test(a)) return true;
  return a.length >= 2 && a.length <= 64 && /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/.test(a);
};

export function createIntents({ base, apiKey, rpc }, fetchFn = (...a) => fetch(...a)) {
  let tokenCache = null; // { at, list } per isolate

  async function request(method, path, payload) {
    const headers = { 'content-type': 'application/json' };
    if (apiKey) headers['x-api-key'] = apiKey; // without a key 1Click still works, with a slightly higher fee
    const res = await fetchFn(`${base}${path}`, { method, headers, body: payload === undefined ? undefined : JSON.stringify(payload) });
    const text = await res.text();
    let body = {};
    try { body = text ? JSON.parse(text) : {}; } catch { body = { message: text.slice(0, 200) }; }
    if (!res.ok) throw new IntentsError(res.status, body);
    return body;
  }

  async function tokens(now = Date.now()) {
    if (tokenCache && now - tokenCache.at < 300_000) return tokenCache.list;
    const list = await request('GET', '/v0/tokens');
    tokenCache = { at: now, list };
    return list;
  }

  /** The curated list for the payment page: [{ assetId, symbol, chain, chainName }]. */
  async function payOptions() {
    const list = await tokens();
    const out = [];
    for (const [symbol, chain] of PAY_WITH) {
      const t = list.find((x) => x.symbol === symbol && x.blockchain === chain);
      if (t) out.push({ assetId: t.assetId, symbol, chain, chainName: CHAIN_NAMES[chain] || chain });
    }
    return out;
  }

  /** Invoice amount (cents in EUR or USD) → USDC base units (6 decimals). Euros use the live EURe price. */
  async function usdcUnits(cents, currency) {
    let rate = 1;
    if (currency === 'EUR') {
      const eure = (await tokens()).find((x) => x.symbol === EURE.symbol && x.blockchain === EURE.blockchain);
      if (!eure?.price) throw new IntentsError(503, { message: 'no EUR rate' });
      rate = eure.price;
    }
    return String(Math.ceil(Number((cents * rate * 10_000).toFixed(6)))); // toFixed: 35000 × 1.12 must not round up to …001
  }

  return {
    tokens,
    payOptions,
    usdcUnits,

    /**
     * A real quote with a deposit address. The client sends `amountIn` of `originAsset` there;
     * exactly `usdc` units reach `recipient` on NEAR, any excess goes back to `refundTo`.
     */
    async quote({ originAsset, symbol, usdc, recipient, refundTo, deadline, dry = false }) {
      const out = await request('POST', '/v0/quote', {
        dry,
        swapType: 'EXACT_OUTPUT',
        slippageTolerance: STABLE.has(symbol) ? 10 : 100,
        originAsset,
        depositType: 'ORIGIN_CHAIN',
        destinationAsset: USDC,
        amount: usdc,
        recipient,
        recipientType: 'DESTINATION_CHAIN',
        refundTo,
        refundType: 'ORIGIN_CHAIN',
        deadline: new Date(deadline).toISOString(),
        referral: 'cobra',
      });
      return { ...out.quote, signature: out.signature, correlationId: out.correlationId };
    },

    status: (depositAddress, memo) => request('GET', `/v0/status?depositAddress=${encodeURIComponent(depositAddress)}${memo ? `&depositMemo=${encodeURIComponent(memo)}` : ''}`),

    /** Optional: tells 1Click about the deposit transaction so it is picked up sooner. */
    submit: (depositAddress, txHash) => request('POST', '/v0/deposit/submit', { depositAddress, txHash }),

    /** True if the account exists on NEAR mainnet (implicit accounts always count: they exist once funded). */
    async accountExists(id) {
      const a = String(id || '').trim().toLowerCase();
      if (!isNearAccount(a)) return false;
      if (!a.includes('.') && a.length >= 40) return true;
      const res = await fetchFn(rpc, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 'cobra', method: 'query', params: { request_type: 'view_account', finality: 'final', account_id: a } }),
      });
      const body = await res.json().catch(() => ({}));
      return Boolean(body?.result?.amount !== undefined);
    },
  };
}
