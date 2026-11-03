// Payments: a deposit address per "pay with X" on the payment page, and what Cobra does when 1Click reports progress.
// MUSD on Mezo and CCD on Concordium are paid directly to the freelancer (see DIRECT) and go through the same lifecycle.

import { CHAIN_NAMES } from './intents.js';
import { MUSD_ASSET, taggedAmount, formatUnits, transferData } from './mezo.js';
import { CCD_ASSET, taggedCcd, formatCcd } from './concordium.js';
import { T } from './render.js';
import { message } from './telegram.js';

export class PayError extends Error {
  constructor(code) {
    super(code);
    this.code = code; // closed | asset | refund | limit
  }
}

const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const newPayToken = () => b64url(crypto.getRandomValues(new Uint8Array(16)));

const MAX_ATTEMPTS = 30; // deposit addresses per invoice
const INCOMING = new Set(['KNOWN_DEPOSIT_TX', 'PROCESSING']);

const DIRECT_DAYS = 30; // a direct payment has no deposit address to expire; watch the invoice this long

export function createPayments({ db, intents, mezo, concordium, api, cfg, clock = Date.now }) {
  const notify = (userId, text, extra = {}) => api.call('sendMessage', message(userId, text, extra)).catch((e) => console.error('[notify]', e.message));
  const kb = (rows) => ({ reply_markup: { inline_keyboard: rows } });

  /**
   * Payouts NEAR Intents cannot route: the client pays the freelancer directly and Cobra watches for the exact,
   * invoice-tagged amount. Each entry knows how to price an invoice, what a wallet needs, and how to find the payment.
   */
  const DIRECT = {
    mezo: {
      asset: MUSD_ASSET, symbol: 'MUSD',
      async open(inv) {
        const wei = taggedAmount(await intents.payoutUnits(inv.amount_cents, inv.currency, 'near'), inv.id);
        return { shown: formatUnits(wei), amount: wei, watch: { to: inv.payout_address, wei, fromBlock: await mezo.blockNumber() } };
      },
      wallet: (q) => ({
        chainName: mezo.net.name,
        direct: { kind: 'evm', chainId: `0x${mezo.net.chainId.toString(16)}`, chainName: mezo.net.name, rpc: mezo.net.rpc, explorer: mezo.net.explorer, token: mezo.net.musd, wei: q.wei, data: transferData(q.to, q.wei) },
      }),
      async find(dep, q) {
        const key = `scan:${dep.address}`;
        const r = await mezo.findTransfer(q.to, q.wei, Number(await db.kvGet(key)) || q.fromBlock);
        await db.kvSet(key, r.scanned + 1);
        return r.found ? { hash: r.found.hash, url: mezo.txUrl(r.found.hash) } : null;
      },
    },
    ccd: {
      asset: CCD_ASSET, symbol: 'CCD',
      async open(inv, now) {
        const micro = taggedCcd(inv.amount_cents, await concordium.price(inv.currency), inv.id);
        return { shown: formatCcd(micro), amount: micro, watch: { to: inv.payout_address, micro, since: now } };
      },
      wallet: (q, inv) => ({
        chainName: concordium.net.name,
        direct: { kind: 'ccd', chainName: concordium.net.name, micro: q.micro, x402: `${cfg.publicUrl}/x402/${inv.pay_token}` },
      }),
      async find(_dep, q) {
        const hit = await concordium.findTransfer(q.to, q.micro, q.since);
        return hit ? { hash: hit.hash, url: concordium.txUrl(hit.hash) } : null;
      },
    },
  };
  const directOf = (dep) => Object.values(DIRECT).find((x) => x.asset === dep.origin_asset);

  /** What the payment page needs to show for a deposit. Direct payments add what a wallet needs to pay. */
  const view = (d, inv = null) => {
    const out = {
      key: d.address, address: d.address, memo: d.memo, symbol: d.symbol, chain: d.chain, chainName: CHAIN_NAMES[d.chain] || d.chain,
      amountIn: d.amount_in, deadline: d.deadline, status: d.status,
    };
    const x = directOf(d);
    if (!x) return out;
    const q = JSON.parse(d.quote);
    return { ...out, address: q.to, ...x.wallet(q, inv || { pay_token: '' }) };
  };

  /** Direct payouts: one watch per invoice for the exact amount, created the first time the client opens it. */
  async function startDirect(inv, assetId, now) {
    const x = DIRECT[inv.payout_chain];
    if (assetId !== x.asset) throw new PayError('asset');
    const existing = (await db.depositsFor(inv.id)).find((d) => d.origin_asset === x.asset);
    if (existing) return view(existing, inv);
    const o = await x.open(inv, now);
    const dep = {
      address: `${x.asset}:${inv.id}`, memo: null, invoice_id: inv.id, origin_asset: x.asset, symbol: x.symbol, chain: inv.payout_chain, refund_to: '-',
      amount_in: o.shown, amount_out: o.amount, quote: JSON.stringify({ direct: true, ...o.watch }), deadline: now + DIRECT_DAYS * 86_400_000, created_at: now,
    };
    await db.addDeposit(dep);
    return view({ ...dep, status: 'PENDING_DEPOSIT' }, inv);
  }

  /** Same shape as a 1Click status, so the rest of the lifecycle does not care how the money moved. */
  const found = (dep, hit) => ({ status: 'SUCCESS', swapDetails: { amountInFormatted: dep.amount_in, destinationChainTxHashes: [{ hash: hit.hash, explorerUrl: hit.url }] } });
  async function directStatus(dep) {
    const hit = await directOf(dep).find(dep, JSON.parse(dep.quote));
    return hit ? found(dep, hit) : { status: 'PENDING_DEPOSIT', swapDetails: {} };
  }

  /**
   * x402 on Concordium: an agent pays the CCD transfer itself and sends its hash in X-PAYMENT. Cobra checks it on chain
   * (finalized, successful, exact tagged amount, to the freelancer), never accepts the same hash twice, and settles.
   * Returns { ok, status, why, tx }.
   */
  async function settleX402(inv, hash) {
    if (!inv || inv.payout_chain !== 'ccd') return { ok: false, why: 'not a Concordium invoice' };
    if (inv.status === 'PAID') return { ok: true, status: 'PAID', tx: inv.paid_tx, already: true };
    const d = await startDirect(inv, CCD_ASSET, clock());
    const dep = await db.getDeposit(d.key);
    const q = JSON.parse(dep.quote);
    if (await db.kvGet(`x402:${hash}`)) return { ok: false, why: 'payment already used' };
    const v = await concordium.verifyTransfer(hash, q.to, q.micro);
    if (!v.ok) return { ok: false, why: v.why, pending: v.pending };
    await db.kvSet(`x402:${hash}`, String(inv.id));
    const url = concordium.txUrl(hash);
    await apply(dep, found(dep, { hash, url }));
    return { ok: true, status: 'PAID', tx: url, payer: v.sender };
  }

  /** Gets (or reuses) a deposit address so the client can pay `inv` with `assetId`. */
  async function startPayment(inv, { assetId, refundTo }) {
    const now = clock();
    if (!inv || inv.status !== 'SENT') throw new PayError('closed');
    if (DIRECT[inv.payout_chain]) return startDirect(inv, assetId, now);
    const opt = (await intents.payOptions()).find((o) => o.assetId === assetId);
    if (!opt) throw new PayError('asset');
    const refund = String(refundTo || '').trim().slice(0, 120);
    if (refund.length < 2) throw new PayError('refund');
    const reuse = await db.reusableDeposit(inv.id, assetId, refund, now + 10 * 60_000);
    if (reuse) return view(reuse);
    if ((await db.depositsFor(inv.id)).length >= MAX_ATTEMPTS) throw new PayError('limit');

    const amount = await intents.payoutUnits(inv.amount_cents, inv.currency, inv.payout_chain);
    const deadline = now + cfg.quoteMinutes * 60_000;
    const q = await intents.quote({ originAsset: assetId, symbol: opt.symbol, amount, payout: inv.payout_chain, recipient: inv.payout_address, refundTo: refund, deadline });
    if (!q.depositAddress) throw new Error('1Click returned no deposit address');
    const dep = {
      address: q.depositAddress, memo: q.depositMemo || null, invoice_id: inv.id, origin_asset: assetId, symbol: opt.symbol, chain: opt.chain,
      refund_to: refund, amount_in: q.amountInFormatted, amount_out: amount, quote: JSON.stringify(q), deadline: Date.parse(q.deadline) || deadline, created_at: now,
    };
    await db.addDeposit(dep);
    return view({ ...dep, status: 'PENDING_DEPOSIT' });
  }

  /** Asks 1Click (or Mezo) how a deposit is going and acts on any change. Returns the status. */
  async function refresh(dep) {
    const now = clock();
    let st;
    try {
      st = directOf(dep) ? await directStatus(dep) : await intents.status(dep.address, dep.memo);
    } catch (e) {
      console.error('[status]', dep.address, e.message);
      await db.setDepositStatus(dep.address, dep.status, now);
      return dep.status;
    }
    return apply(dep, st);
  }

  /** Stores a deposit's new status and tells the freelancer what changed (once per change). Returns the status. */
  async function apply(dep, st) {
    const now = clock();
    const status = String(st?.status || dep.status);
    if (!(await db.setDepositStatus(dep.address, status, now))) return status;

    const inv = await db.invoiceById(dep.invoice_id);
    if (!inv) return status;
    const u = await db.getUser(inv.user_id);
    const t = T(u?.lang);
    const sd = st.swapDetails || {};
    const chain = CHAIN_NAMES[dep.chain] || dep.chain;
    const sentAmount = sd.amountInFormatted || sd.depositedAmountFormatted || dep.amount_in;

    if (status === 'SUCCESS') {
      const tx = sd.destinationChainTxHashes?.[0]?.explorerUrl || null;
      const paidWith = `${sentAmount} ${dep.symbol} · ${chain}`;
      const buttons = tx ? kb([[{ text: t.btnTx, url: tx }]]) : {};
      if (await db.markPaid(inv.id, paidWith, tx, now)) await notify(inv.user_id, t.paid({ ...inv, paid_with: paidWith }, u?.lang), buttons);
      else await notify(inv.user_id, t.paidAgain({ ...inv, paid_with: paidWith }, u?.lang), buttons); // a second payment still reached their account
    } else if (status === 'REFUNDED' || status === 'FAILED') {
      await notify(inv.user_id, t.refundedAttempt(inv, `${sentAmount} ${dep.symbol} · ${chain}`, sd.refundReason));
    } else if (INCOMING.has(status) && !(await db.kvGet(`incoming:${dep.address}`))) {
      await db.kvSet(`incoming:${dep.address}`, '1');
      await notify(inv.user_id, t.incoming(inv, `${sentAmount} ${dep.symbol} · ${chain}`));
    }
    return status;
  }

  /** Refreshes the deposits of one invoice that can still change, and returns the invoice as it is now. */
  async function refreshInvoice(inv, minGapMs = 10_000) {
    const now = clock();
    for (const d of await db.depositsFor(inv.id)) {
      if (['SUCCESS', 'REFUNDED', 'FAILED'].includes(d.status) || d.deadline < now - 6 * 3_600_000 || now - d.checked_at < minGapMs) continue;
      await refresh(d);
    }
    return db.invoiceById(inv.id);
  }

  /** Called every minute: checks the deposits nobody looked at in the last minute. */
  async function sweep(now = clock(), limit = 15) {
    const list = await db.liveDeposits(now, now - 60_000, limit);
    for (const d of list) await refresh(d);
    return list.length;
  }

  return { startPayment, refresh, refreshInvoice, sweep, view, settleX402 };
}
