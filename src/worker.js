// Cloudflare Worker: Telegram calls /webhook, clients open /pay/<token>, a clock calls /tick every minute.

import { loadConfig } from './config.js';
import { createDb } from './db.js';
import { createApi } from './telegram.js';
import { createIntents, IntentsError } from './intents.js';
import { createPayments, PayError } from './payments.js';
import { createMezo, MUSD_ASSET } from './mezo.js';
import { createConcordium, CCD_ASSET, parsePaymentHeader } from './concordium.js';
import { createBot } from './bot.js';
import { budgetedAi } from './ai.js';
import { MINI_APP } from './miniapp.js';
import { payPage, publicInvoice } from './paypage.js';
import { verifyInitData, toRow, toCsv } from './webapp.js';

export function build(env, deps = {}) {
  const cfg = loadConfig(env);
  const db = createDb(env.DB);
  const api = deps.api || createApi(cfg.token);
  const intents = deps.intents || createIntents(cfg.intents);
  const mezo = deps.mezo || createMezo(cfg.mezoNetwork);
  const concordium = deps.concordium || createConcordium(cfg.concordiumNetwork);
  const payments = createPayments({ db, intents, mezo, concordium, api, cfg, clock: deps.clock });
  const bot = createBot({ api, db, cfg, payments, intents, concordium, ai: budgetedAi(env.AI, db, cfg.aiCallsPerDay), clock: deps.clock });
  return { cfg, db, api, intents, mezo, concordium, payments, bot };
}

const secretOk = (env, url) => env.WEBHOOK_SECRET && url.searchParams.get('secret') === env.WEBHOOK_SECRET;
const html = (body, status = 200) => new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'x-robots-tag': 'noindex', 'referrer-policy': 'no-referrer' } });

/** The agent's Verified by Concordium badge, checked live against the Agent Registry and cached ten minutes. */
async function badgeOf(cfg, db, concordium) {
  if (!cfg.concordiumBadge) return null;
  const cached = JSON.parse((await db.kvGet('badge')) || 'null');
  if (cached?.token === cfg.concordiumBadge && Date.now() - cached.at < 600_000) return cached;
  const r = await concordium.checkBadge(cfg.concordiumBadge);
  const badge = { at: Date.now(), token: cfg.concordiumBadge, valid: r.valid, url: r.url };
  await db.kvSet('badge', JSON.stringify(badge));
  return badge;
}

const b64json = (x) => btoa(unescape(encodeURIComponent(JSON.stringify(x))));

/**
 * x402 for Concordium invoices: GET /x402/<token> answers 402 with the payment requirements; the agent sends the CCD
 * transfer and repeats the request with X-PAYMENT (base64 JSON carrying the transaction hash). Cobra verifies it on chain,
 * settles the invoice, alerts the freelancer and answers 200 with X-PAYMENT-RESPONSE.
 */
async function handleX402(req, env, url, deps) {
  const token = url.pathname.split('/')[2] || '';
  const { db, concordium, payments } = build(env, deps);
  const inv = /^[A-Za-z0-9_-]{16,40}$/.test(token) ? await db.invoiceByToken(token) : null;
  if (!inv || inv.payout_chain !== 'ccd') return Response.json({ error: 'not found' }, { status: 404 });
  const invoice = { number: inv.number, description: inv.description, amount: inv.amount_cents / 100, currency: inv.currency };
  if (inv.status === 'PAID') return Response.json({ paid: true, invoice, tx: inv.paid_tx });
  if (inv.status !== 'SENT') return Response.json({ error: 'invoice closed' }, { status: 410 });

  const d = await payments.startPayment(inv, { assetId: CCD_ASSET });
  const requirements = {
    scheme: 'exact', network: concordium.net.x402, maxAmountRequired: d.direct.micro, asset: 'CCD', payTo: d.address,
    resource: url.origin + url.pathname, description: `Invoice ${inv.number}: ${inv.description}`, mimeType: 'application/json', maxTimeoutSeconds: 600,
    extra: { decimals: 6, invoice, proof: 'X-PAYMENT = base64 JSON {"x402Version":1,"scheme":"exact","network":"' + concordium.net.x402 + '","payload":{"txHash":"<hash of a CCD transfer of exactly maxAmountRequired microCCD to payTo>"}}' },
  };
  const required = (error, status = 402) => new Response(JSON.stringify({ x402Version: 1, error, accepts: [requirements] }), {
    status, headers: { 'content-type': 'application/json', 'payment-required': b64json({ x402Version: 1, accepts: [requirements] }) },
  });

  const header = req.headers.get('x-payment');
  if (!header) return required('X-PAYMENT header is required');
  const hash = parsePaymentHeader(header);
  if (!hash) return required('X-PAYMENT must be base64 JSON with payload.txHash');
  const r = await payments.settleX402(inv, hash);
  if (!r.ok) return required(r.why);
  const receipt = { success: true, transaction: hash, network: concordium.net.x402, payer: r.payer || null };
  return new Response(JSON.stringify({ paid: true, invoice, tx: r.tx }), { headers: { 'content-type': 'application/json', 'x-payment-response': b64json(receipt) } });
}

/** /pay/<token>, /pay/<token>/quote, /pay/<token>/status */
async function handlePay(req, env, url, deps) {
  const [, , token, action] = url.pathname.split('/');
  if (!/^[A-Za-z0-9_-]{16,40}$/.test(token || '')) return html('Not found', 404);
  const { cfg, db, intents, mezo, concordium, payments } = build(env, deps);
  const inv = await db.invoiceByToken(token);
  if (!inv) return html('Not found', 404);

  if (!action && req.method === 'GET') {
    const owner = await db.getUser(inv.user_id);
    const direct = {
      mezo: [{ assetId: MUSD_ASSET, symbol: 'MUSD', chain: 'mezo', chainName: mezo.net.name, direct: true }],
      ccd: [{ assetId: CCD_ASSET, symbol: 'CCD', chain: 'ccd', chainName: concordium.net.name, direct: true }],
    }[inv.payout_chain];
    const options = inv.status !== 'SENT' ? [] : direct || await intents.payOptions().catch(() => []);
    const badge = await badgeOf(cfg, db, concordium);
    return html(payPage({ token, invoice: publicInvoice(inv, owner), options, lang: owner?.lang, badge }));
  }

  if (action === 'quote' && req.method === 'POST') {
    const body = await req.json().catch(() => ({}));
    try {
      return Response.json(await payments.startPayment(inv, { assetId: body.assetId, refundTo: body.refundTo }));
    } catch (e) {
      if (e instanceof PayError) return Response.json({ error: e.code }, { status: 400 });
      if (e instanceof IntentsError && e.status < 500) return Response.json({ error: 'intents', detail: e.detail }, { status: 400 });
      console.error('[quote]', e.message);
      return Response.json({ error: 'unavailable' }, { status: 503 });
    }
  }

  if (action === 'status' && req.method === 'GET') {
    const address = url.searchParams.get('d');
    const dep = address ? await db.getDeposit(address) : null;
    if (dep && dep.invoice_id === inv.id && Date.now() - dep.checked_at > 4000) await payments.refresh(dep);
    const fresh = await db.invoiceByToken(token);
    const latest = dep && dep.invoice_id === inv.id ? await db.getDeposit(address) : null;
    return Response.json({ invoice: publicInvoice(fresh), deposit: latest ? payments.view(latest, fresh) : null });
  }

  return html('Not found', 404);
}

export default {
  async fetch(req, env, ctx, deps = {}) {
    const url = new URL(req.url);

    if (url.pathname === '/webhook' && req.method === 'POST') {
      if (req.headers.get('x-telegram-bot-api-secret-token') !== env.WEBHOOK_SECRET) return new Response('forbidden', { status: 403 });
      const update = await req.json();
      // Answer Telegram at once; the AI and 1Click can take a few seconds.
      ctx.waitUntil(build(env, deps).bot.handleUpdate(update).catch((e) => console.error('[update]', e)));
      return new Response('ok');
    }

    if (url.pathname.startsWith('/pay/')) return handlePay(req, env, url, deps);
    if (url.pathname.startsWith('/x402/')) return handleX402(req, env, url, deps);

    // The Agent Card registered in the Concordium Agent Registry: served byte for byte, so its SHA-256 matches on chain.
    if (url.pathname === '/.well-known/agent-card.json') {
      const card = await createDb(env.DB).kvGet('agentcard');
      return card ? new Response(card, { headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' } }) : Response.json({ error: 'not registered yet' }, { status: 404 });
    }
    if (url.pathname === '/setup/agent-card' && req.method === 'POST') {
      if (!secretOk(env, url)) return new Response('forbidden', { status: 403 });
      const text = await req.text();
      JSON.parse(text); // must be valid JSON
      await createDb(env.DB).kvSet('agentcard', text);
      const sha = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map((b) => b.toString(16).padStart(2, '0')).join('');
      return Response.json({ ok: true, sha256: sha });
    }

    if (url.pathname === '/app') return new Response(MINI_APP, { headers: { 'content-type': 'text/html; charset=utf-8' } });

    if ((url.pathname === '/app/data' || url.pathname === '/app/export') && req.method === 'POST') {
      const body = await req.json().catch(() => null);
      const who = await verifyInitData(body?.initData, env.BOT_TOKEN);
      if (!who) return new Response('forbidden', { status: 403 });
      const { db, api } = build(env, deps);
      const rows = (await db.invoices(who.id)).map(toRow);
      if (url.pathname === '/app/data') return Response.json({ rows, lang: (await db.getUser(who.id))?.lang });
      await api.sendTextFile(who.id, toCsv(rows), `cobra-invoices-${new Date().toISOString().slice(0, 10)}.csv`, '📊 Cobra');
      return new Response('ok');
    }

    // A shared clock Worker calls this every minute through a service binding. Its requests use the
    // made-up host "reloj", which no request from the internet can carry (Cloudflare routes by host).
    if (url.pathname === '/tick' && req.method === 'POST') {
      const viaBinding = url.hostname === 'reloj';
      if (!viaBinding && (!env.RELOJ_SECRET || req.headers.get('x-reloj-secret') !== env.RELOJ_SECRET)) return new Response('forbidden', { status: 403 });
      return new Response(await build(env, deps).bot.tick(Date.now()));
    }

    // The bot's picture: POST a JPG to /setup/photo?secret=WEBHOOK_SECRET
    if (url.pathname === '/setup/photo' && req.method === 'POST') {
      if (!secretOk(env, url)) return new Response('forbidden', { status: 403 });
      try {
        return Response.json({ ok: await build(env, deps).api.setProfilePhoto(await req.arrayBuffer()) });
      } catch (e) {
        return Response.json({ error: e.message }, { status: 502 });
      }
    }

    // Once after each deploy: Telegram webhook, command menu and Mini App button. /setup?secret=WEBHOOK_SECRET
    if (url.pathname === '/setup') {
      if (!secretOk(env, url)) return new Response('forbidden', { status: 403 });
      const { api, bot } = build(env, deps);
      try {
        await api.call('setWebhook', { url: `${url.origin}/webhook`, secret_token: env.WEBHOOK_SECRET, allowed_updates: ['message', 'callback_query'] });
        await api.call('setMyCommands', { commands: bot.commands });
        await api.call('setChatMenuButton', { menu_button: { type: 'web_app', text: '📊 Invoices', web_app: { url: `${url.origin}/app` } } });
      } catch (e) {
        return Response.json({ error: e.message }, { status: 502 });
      }
      return Response.json({ bot: (await api.call('getMe')).username, telegram: await api.call('getWebhookInfo') });
    }

    return new Response('Cobra · talk to Telegram, get paid in any crypto, receive USDC on NEAR', { headers: { 'content-type': 'text/plain; charset=utf-8' } });
  },

  // Fallback clock if no shared clock Worker is bound: wrangler.toml [triggers] crons = ["* * * * *"]
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(build(env).bot.tick(Date.now()));
  },
};
