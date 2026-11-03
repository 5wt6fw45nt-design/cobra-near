// Payments: a deposit address per "pay with X" on the payment page, and what Cobra does when 1Click reports progress.

import { CHAIN_NAMES } from './intents.js';
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

export function createPayments({ db, intents, api, cfg, clock = Date.now }) {
  const notify = (userId, text, extra = {}) => api.call('sendMessage', message(userId, text, extra)).catch((e) => console.error('[notify]', e.message));
  const kb = (rows) => ({ reply_markup: { inline_keyboard: rows } });

  /** What the payment page needs to show for a deposit. */
  const view = (d) => ({
    address: d.address, memo: d.memo, symbol: d.symbol, chain: d.chain, chainName: CHAIN_NAMES[d.chain] || d.chain,
    amountIn: d.amount_in, usdc: (Number(d.usdc) / 1e6).toFixed(2), deadline: d.deadline, status: d.status,
  });

  /** Gets (or reuses) a deposit address so the client can pay `inv` with `assetId`. */
  async function startPayment(inv, { assetId, refundTo }) {
    const now = clock();
    if (!inv || inv.status !== 'SENT') throw new PayError('closed');
    const opt = (await intents.payOptions()).find((o) => o.assetId === assetId);
    if (!opt) throw new PayError('asset');
    const refund = String(refundTo || '').trim().slice(0, 120);
    if (refund.length < 2) throw new PayError('refund');
    const reuse = await db.reusableDeposit(inv.id, assetId, refund, now + 10 * 60_000);
    if (reuse) return view(reuse);
    if ((await db.depositsFor(inv.id)).length >= MAX_ATTEMPTS) throw new PayError('limit');

    const usdc = await intents.usdcUnits(inv.amount_cents, inv.currency);
    const deadline = now + cfg.quoteMinutes * 60_000;
    const q = await intents.quote({ originAsset: assetId, symbol: opt.symbol, usdc, recipient: inv.near_account, refundTo: refund, deadline });
    if (!q.depositAddress) throw new Error('1Click returned no deposit address');
    const dep = {
      address: q.depositAddress, memo: q.depositMemo || null, invoice_id: inv.id, origin_asset: assetId, symbol: opt.symbol, chain: opt.chain,
      refund_to: refund, amount_in: q.amountInFormatted, usdc, quote: JSON.stringify(q), deadline: Date.parse(q.deadline) || deadline, created_at: now,
    };
    await db.addDeposit(dep);
    return view({ ...dep, status: 'PENDING_DEPOSIT' });
  }

  /** Asks 1Click how a deposit is going and acts on any change. Returns the status. */
  async function refresh(dep) {
    const now = clock();
    let st;
    try {
      st = await intents.status(dep.address, dep.memo);
    } catch (e) {
      console.error('[status]', dep.address, e.message);
      await db.setDepositStatus(dep.address, dep.status, now);
      return dep.status;
    }
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

  return { startPayment, refresh, refreshInvoice, sweep, view };
}
