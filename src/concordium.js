// Concordium: CCD invoices paid by people (Cobra watches the freelancer's account) or by AI agents over x402
// (the agent sends the transfer and proves it with the transaction hash), plus the "Verified by Concordium"
// badge of the agent behind Cobra. Reads go through the public wallet-proxy and the Agent Registry REST API.
// Docs: https://docs.concordium.com/en/mainnet/how-to/integrations/x402-integration.html
//       https://docs.concordium.com/en/mainnet/technical-reference/agent-registry/concordium-badge.html

export const CONCORDIUM_NETWORKS = {
  testnet: {
    name: 'Concordium Testnet', x402: 'concordium:testnet',
    walletProxy: 'https://wallet-proxy.testnet.concordium.com', explorer: 'https://ccdexplorer.io/testnet/transaction/',
  },
  mainnet: {
    name: 'Concordium', x402: 'concordium:mainnet',
    walletProxy: 'https://wallet-proxy.mainnet.concordium.software', explorer: 'https://ccdexplorer.io/mainnet/transaction/',
  },
};

export const CCD_ASSET = 'ccd:direct';
const REGISTRY = 'https://agent-registry-mcp.concordium.com';
const PRICE = 'https://api.coingecko.com/api/v3/simple/price?ids=concordium&vs_currencies=eur,usd';
const TRANSFERS = new Set(['transfer', 'transferWithMemo']);

/** Concordium account addresses are 50 Base58 characters. */
export const isCcdAccount = (s) => /^[1-9A-HJ-NP-Za-km-z]{50}$/.test(String(s || '').trim());

/** 1234567 microCCD → "1.234567". */
export const formatCcd = (micro) => {
  const s = BigInt(micro).toString().padStart(7, '0');
  const frac = s.slice(-6).replace(/0+$/, '');
  return `${s.slice(0, -6)}${frac ? `.${frac}` : ''}`;
};

/** Invoice value in microCCD, plus the invoice id so equal invoices to the same account never collide. */
export const taggedCcd = (cents, ccdPrice, invoiceId) => String(BigInt(Math.ceil((cents / 100 / ccdPrice) * 1e6)) + BigInt(invoiceId));

/** X-PAYMENT header → transaction hash. Accepts {payload:{txHash}} (x402 envelope) or {txHash}. */
export function parsePaymentHeader(header) {
  try {
    const json = JSON.parse(atob(String(header || '').trim()));
    const hash = String(json?.payload?.txHash || json?.payload?.transactionHash || json?.txHash || '').toLowerCase();
    return /^[0-9a-f]{64}$/.test(hash) ? hash : null;
  } catch {
    return null;
  }
}

export function createConcordium(network = 'testnet', fetchFn = (...a) => fetch(...a)) {
  const net = CONCORDIUM_NETWORKS[network] || CONCORDIUM_NETWORKS.testnet;
  const getJson = async (url) => {
    const res = await fetchFn(url, { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`${new URL(url).host} ${res.status}`);
    return res.json();
  };

  return {
    net,
    network,

    /** CCD price in the invoice currency (EUR or USD). */
    async price(currency) {
      const p = (await getJson(PRICE))?.concordium?.[currency.toLowerCase()];
      if (!p) throw new Error('no CCD price');
      return p;
    },

    async accountExists(address) {
      if (!isCcdAccount(address)) return false;
      const b = await getJson(`${net.walletProxy}/v0/accBalance/${address.trim()}`).catch(() => ({}));
      return Boolean(b?.finalizedBalance || b?.currentBalance);
    },

    /** A finalized, successful CCD transfer of exactly `micro` to `to`: { ok, sender } or { ok: false, why }. */
    async verifyTransfer(hash, to, micro) {
      const st = await getJson(`${net.walletProxy}/v0/submissionStatus/${hash}`);
      if (st.status !== 'finalized') return { ok: false, why: st.status === 'absent' ? 'unknown transaction' : 'not final yet', pending: st.status !== 'absent' };
      if (st.outcome !== 'success') return { ok: false, why: 'transaction failed' };
      if (st.to !== to) return { ok: false, why: 'wrong recipient' };
      if (String(st.amount) !== String(micro)) return { ok: false, why: 'wrong amount' };
      return { ok: true, sender: st.sender };
    },

    /** The newest incoming transfer of exactly `micro` to `account` since `sinceMs`, or null. */
    async findTransfer(account, micro, sinceMs) {
      const d = await getJson(`${net.walletProxy}/v1/accTransactions/${account}?limit=50&order=d`);
      const hit = (d.transactions || []).find((t) => TRANSFERS.has(t.details?.type) && t.details.outcome === 'success'
        && t.details.transferDestination === account && String(t.details.transferAmount) === String(micro) && t.blockTime * 1000 >= sinceMs - 60_000);
      return hit ? { hash: hit.transactionHash, sender: hit.details.transferSource } : null;
    },

    txUrl: (hash) => `${net.explorer}${hash}`,

    /** Live verdict of a "Verified by Concordium" badge: { valid, owner } (never throws). */
    async checkBadge(tokenAddress) {
      try {
        const r = await getJson(`${REGISTRY}/v1/check-badge/${encodeURIComponent(tokenAddress)}?network=${network}`);
        const valid = Boolean(r.valid ?? r.ok ?? (r.summary ? r.summary.valid > 0 && !r.summary.invalid : false));
        return { valid, owner: r.owner || r.account || null, url: `${REGISTRY}/v1/check-badge/${encodeURIComponent(tokenAddress)}?network=${network}` };
      } catch {
        return { valid: false, owner: null, url: null };
      }
    },
  };
}
