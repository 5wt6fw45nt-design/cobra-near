// Lightning payouts to the freelancer's own Lightning address (LUD-16), so Cobra never holds sats: for each invoice
// Cobra asks the address for a BOLT11 invoice (LNURL-pay, LUD-06) and, when the wallet supports it, checks
// settlement with the LUD-21 verify URL. Cashu wallets such as Minibits or npub.cash give such addresses without KYC.

/** user@domain → https://domain/.well-known/lnurlp/user (onion and plain-http hosts are not supported). */
export function lnurlpUrl(address) {
  const m = /^([a-z0-9._+-]+)@([a-z0-9.-]+\.[a-z]{2,})$/i.exec(String(address || '').trim());
  return m ? `https://${m[2].toLowerCase()}/.well-known/lnurlp/${m[1].toLowerCase()}` : null;
}

export const isLightningAddress = (s) => Boolean(lnurlpUrl(s));

/** Amount in msat from a BOLT11 human-readable part (lnbc2500u… → 250000000), or null if it carries none. */
export function bolt11Msat(pr) {
  const m = /^ln(?:bc|tb|bcrt)(\d+)([munp]?)1/i.exec(String(pr || ''));
  if (!m) return null;
  const n = BigInt(m[1]);
  const per = { '': 100_000_000_000n, m: 100_000_000n, u: 100_000n, n: 100n, p: 0n }[m[2].toLowerCase()];
  return m[2].toLowerCase() === 'p' ? Number(n / 10n) : Number(n * per);
}

export function createLightning(fetchFn = (...a) => fetch(...a)) {
  const getJson = async (url) => {
    const res = await fetchFn(url, { headers: { accept: 'application/json' } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.status === 'ERROR') throw new Error(body.reason || `${new URL(url).host} ${res.status}`);
    return body;
  };

  return {
    /** The address's pay endpoint, or null if it does not answer as LNURL-pay. */
    async resolve(address) {
      const url = lnurlpUrl(address);
      if (!url) return null;
      const p = await getJson(url).catch(() => null);
      return p?.tag === 'payRequest' && p.callback ? p : null;
    },

    /** A BOLT11 invoice for `sats` from the address: { pr, verify, msat }. The amount is checked against what was asked. */
    async invoice(address, sats, comment = '') {
      const p = await this.resolve(address);
      if (!p) throw new Error('not a Lightning address');
      const msat = sats * 1000;
      if (msat < p.minSendable || msat > p.maxSendable) throw new Error(`amount outside ${p.minSendable / 1000}-${p.maxSendable / 1000} sats`);
      const cb = new URL(p.callback);
      cb.searchParams.set('amount', String(msat));
      if (comment && p.commentAllowed) cb.searchParams.set('comment', comment.slice(0, p.commentAllowed));
      const r = await getJson(cb.href);
      if (!r.pr || bolt11Msat(r.pr) !== msat) throw new Error('the wallet returned an invoice for another amount');
      return { pr: r.pr, verify: r.verify || null, msat };
    },

    /** LUD-21: true once the invoice is paid. */
    async settled(verifyUrl) {
      const r = await getJson(verifyUrl);
      return r.settled === true;
    },
  };
}
