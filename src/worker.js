// Cloudflare Worker: Telegram calls /webhook, clients open /pay/<token>, a clock calls /tick every minute.

import { loadConfig } from './config.js';
import { createDb } from './db.js';
import { createApi } from './telegram.js';
import { createIntents, IntentsError } from './intents.js';
import { createPayments, PayError } from './payments.js';
import { createMezo, MUSD_ASSET } from './mezo.js';
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
  const payments = createPayments({ db, intents, mezo, api, cfg, clock: deps.clock });
  const bot = createBot({ api, db, cfg, payments, intents, ai: budgetedAi(env.AI, db, cfg.aiCallsPerDay), clock: deps.clock });
  return { cfg, db, api, intents, mezo, payments, bot };
}

const secretOk = (env, url) => env.WEBHOOK_SECRET && url.searchParams.get('secret') === env.WEBHOOK_SECRET;
const html = (body, status = 200) => new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'x-robots-tag': 'noindex', 'referrer-policy': 'no-referrer' } });

/** /pay/<token>, /pay/<token>/quote, /pay/<token>/status */
async function handlePay(req, env, url, deps) {
  const [, , token, action] = url.pathname.split('/');
  if (!/^[A-Za-z0-9_-]{16,40}$/.test(token || '')) return html('Not found', 404);
  const { db, intents, mezo, payments } = build(env, deps);
  const inv = await db.invoiceByToken(token);
  if (!inv) return html('Not found', 404);

  if (!action && req.method === 'GET') {
    const owner = await db.getUser(inv.user_id);
    const direct = [{ assetId: MUSD_ASSET, symbol: 'MUSD', chain: 'mezo', chainName: mezo.net.name, direct: true }];
    const options = inv.status !== 'SENT' ? [] : inv.payout_chain === 'mezo' ? direct : await intents.payOptions().catch(() => []);
    return html(payPage({ token, invoice: publicInvoice(inv, owner), options, lang: owner?.lang }));
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
    return Response.json({ invoice: publicInvoice(fresh), deposit: latest ? payments.view(latest) : null });
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
