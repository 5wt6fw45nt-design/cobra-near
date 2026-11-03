// Paying an invoice with Cashu ecash: the client pastes a token, Cobra melts it at the token's own mint into the
// freelancer's Lightning invoice (NUT-05) and hands back any change as a new token. Nothing is stored: the proofs
// only live for the duration of the request, and if anything fails they go back to the client.
// Library: @cashu/cashu-ts (https://github.com/cashubtc/cashu-ts)

import { Wallet, getTokenMetadata, getEncodedToken } from '@cashu/cashu-ts';

const num = (x) => (typeof x?.toNumber === 'function' ? x.toNumber() : Number(x)); // cashu-ts v4 amounts are Amount objects
const sum = (proofs) => proofs.reduce((s, p) => s + num(p.amount), 0);

/** Decodes a cashuA/cashuB token: { mint, unit, amount } or null. */
export function inspectToken(token) {
  try {
    const t = getTokenMetadata(String(token || '').trim());
    return { mint: t.mint, unit: t.unit || 'sat', amount: num(t.amount) };
  } catch {
    return null;
  }
}

/**
 * Melts `token` into the BOLT11 `pr`. Returns { paid, change, preimage, fee, why }: `change` is a token with whatever
 * was left (or everything, if the payment did not go through), to show back to the client.
 */
export async function payWithToken(token, pr, makeWallet = (mint, unit) => new Wallet(mint, { unit })) {
  const meta = inspectToken(token);
  if (!meta) return { paid: false, why: 'not a Cashu token' };
  if (meta.unit !== 'sat') return { paid: false, why: 'only sat tokens' };
  const wallet = makeWallet(meta.mint, 'sat');
  const back = (proofs) => (proofs.length ? getEncodedToken({ mint: meta.mint, unit: 'sat', proofs }) : null);
  let held = [];
  try {
    await wallet.loadMint();
    held = wallet.decodeToken(String(token).trim()).proofs; // v4 needs the mint's keysets to decode; from here on, failures give these back
    const quote = await wallet.createMeltQuoteBolt11(pr);
    const need = quote.amount.add(quote.fee_reserve);
    if (sum(held) < num(need)) return { paid: false, why: `the token holds ${sum(held)} sats, ${need} needed (invoice + routing reserve)`, change: back(held) };
    const { keep, send } = await wallet.send(need, held, { includeFees: true });
    held = [...keep, ...send];
    const res = await wallet.meltProofsBolt11(quote, send);
    const ok = res.quote?.state === 'PAID' || res.quote?.paid === true;
    if (!ok) return { paid: false, why: 'the mint could not pay the invoice', change: back(held) };
    return { paid: true, preimage: res.quote?.payment_preimage || null, change: back([...keep, ...(res.change || [])]), fee: num(need) - num(quote.amount) };
  } catch (e) {
    // A spent or invalid token fails here; anything we may have swapped is returned
    return { paid: false, why: e.message, change: back(held) };
  }
}
