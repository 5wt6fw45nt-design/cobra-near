// Cobra's conversation: voice/text → invoice draft → payment link (any crypto in, USDC on NEAR / Arbitrum or BCH out), payment alerts, reminders, monthly totals.

import { T, esc, draftCard, mainKeyboard, total, describe, shareUrl, payoutLabel } from './render.js';
import { message } from './telegram.js';
import { transcribe, understand, applyFix, writeReminder } from './ai.js';
import { newPayToken } from './payments.js';
import { PAYOUTS, isPayoutAddress, normalizePayoutAddress } from './intents.js';
import { CURRENCIES } from './config.js';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ymd = (ms) => new Date(ms).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);
const firstName = (name) => String(name).split(' ')[0];

export function createBot({ api, db, cfg, payments, intents, concordium = null, ai = null, clock = Date.now, http = (...a) => fetch(...a), stt = transcribe, nlu = understand, fixer = applyFix, reminderWriter = writeReminder, token = newPayToken }) {
  const reply = (chatId, text, extra = {}) => api.call('sendMessage', message(chatId, text, extra));
  const edit = (chatId, messageId, text, extra = {}) => (messageId
    ? api.call('editMessageText', { chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML', link_preview_options: { is_disabled: true }, ...extra })
      .catch(() => reply(chatId, text, extra))
    : reply(chatId, text, extra));
  const ctxOf = async (u, now) => ({ today: ymd(now), currency: u.currency, lang: u.lang, clients: await db.clientNames(u.id) });
  const kb = (rows) => ({ reply_markup: { inline_keyboard: rows } });

  // Buttons on the persistent keyboard, in both languages
  const BUTTONS = new Map();
  for (const lang of ['en', 'es']) {
    const t = T(lang);
    BUTTONS.set(t.btnOwed, 'owed'); BUTTONS.set(t.btnMonth, 'month'); BUTTONS.set(t.btnHelp, 'help'); BUTTONS.set(t.btnSettings, 'settings');
  }

  // --- drafts ---

  const draftButtons = (lang, id) => {
    const t = T(lang);
    return kb([[{ text: t.btnSend, callback_data: `send:${id}` }], [{ text: t.btnFix, callback_data: `fix:${id}` }, { text: t.btnCancel, callback_data: `x:${id}` }]]);
  };

  /** Fills a missing email from the client book (optional here), then shows the draft. */
  async function showDraft(chatId, u, draft, heard, now, statusId = null) {
    const t = T(u.lang);
    const say = (text, extra) => edit(chatId, statusId, text, extra);
    if (!draft.client_name) return say(t.noClient);
    if (!draft.items.length) return say(t.noAmount(draft.client_name));
    const known = await db.findClient(u.id, draft.client_name);
    if (known) { draft.client_name = known.name; draft.client_email = draft.client_email || known.email; }
    await db.pruneDrafts(u.id, now - 7 * DAY);
    const id = await db.addDraft(u.id, draft, heard, now);
    await db.setPending(u.id, null);
    return say(draftCard(draft, u.lang, u.payout_chain), draftButtons(u.lang, id));
  }

  async function refreshDraft(chatId, u, draftId, data) {
    await db.updateDraft(draftId, data);
    await db.setPending(u.id, null);
    return reply(chatId, draftCard(data, u.lang, u.payout_chain), draftButtons(u.lang, draftId));
  }

  /** Turns a draft into an invoice with its own payment page. */
  async function sendDraft(chatId, messageId, u, draftId, now) {
    const t = T(u.lang);
    const dr = await db.getDraft(draftId, u.id);
    if (!dr) return edit(chatId, messageId, t.gone);
    if (!cfg.publicUrl) return reply(chatId, t.notConfigured);
    if (!u.payout_address) return askPayout(chatId, u, draftId);
    const d = dr.data;
    if (total(d.items) > cfg.maxAmount * 100) return reply(chatId, t.tooMuch(cfg.maxAmount), draftButtons(u.lang, draftId));
    const payToken = token();
    const inv = {
      user_id: u.id, pay_token: payToken, number: String((await db.countInvoices(u.id)) + 1).padStart(4, '0'),
      client_name: d.client_name, client_email: d.client_email, description: describe(d.items), amount_cents: total(d.items), currency: d.currency,
      payout_chain: u.payout_chain, payout_address: u.payout_address, due_date: d.due_date, pay_url: `${cfg.publicUrl}/pay/${payToken}`, created_at: now,
    };
    const id = await db.addInvoice(inv);
    await db.saveClient(u.id, d.client_name, d.client_email, now);
    await db.deleteDraft(draftId);
    return edit(chatId, messageId, t.sent(inv, u.lang), kb([
      [{ text: t.btnShare, url: shareUrl(inv.pay_url, t.shareText(inv, u.lang)) }],
      [{ text: t.btnPayLink, url: inv.pay_url }, { text: t.btnInPerson, callback_data: `qr:${id}` }],
    ]));
  }

  // --- invoices ---

  /** Asks 1Click about pending payments of these invoices (in case the clock has not run yet). */
  async function syncUnpaid(list) {
    const still = [];
    for (const inv of list.slice(0, 10)) {
      const now = await payments.refreshInvoice(inv);
      if (now?.status === 'SENT') still.push(now);
    }
    return still.concat(list.slice(10));
  }

  async function sendOwed(chatId, u, now) {
    const t = T(u.lang);
    const list = await syncUnpaid(await db.unpaid(u.id));
    if (!list.length) return reply(chatId, t.noneOwed, { reply_markup: mainKeyboard(u.lang) });
    const today = ymd(now);
    const lines = [t.owedTitle(list.length), ''];
    const rows = [];
    for (const inv of list) {
      const d = inv.due_date ? daysBetween(today, inv.due_date) : null;
      const when = d === null ? '' : d < 0 ? ` · ${t.overdue(-d)}` : ` · ${t.dueIn(d)}`;
      lines.push(`• <b>${esc(inv.client_name)}</b> · ${new Intl.NumberFormat(u.lang === 'es' ? 'es-ES' : 'en-US', { style: 'currency', currency: inv.currency }).format(inv.amount_cents / 100)} · ${esc(inv.description)}${when}${inv.reminded_at ? ` · 🔔 ${t.reminded}` : ''}`);
      if (rows.length < 8) rows.push([{ text: t.btnRemind(firstName(inv.client_name)), callback_data: `rem:${inv.id}` }, { text: '📱', callback_data: `qr:${inv.id}` }]);
    }
    return reply(chatId, lines.join('\n'), kb(rows));
  }

  async function sendMonth(chatId, u, now) {
    const start = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), 1);
    const rows = await db.totals(u.id, start);
    const unpaid = (await db.unpaid(u.id)).length;
    return reply(chatId, T(u.lang).month(rows.filter((r) => r.billed_n || r.paid_n), unpaid, u.lang), { reply_markup: mainKeyboard(u.lang) });
  }

  /** The AI writes the reminder; the freelancer forwards it (with the payment link) to the chat where the client is. */
  async function sendReminder(chatId, u, invId, now) {
    const t = T(u.lang);
    let inv = await db.getInvoice(invId, u.id);
    if (inv?.status === 'SENT') inv = await payments.refreshInvoice(inv);
    if (!inv || inv.status !== 'SENT') return reply(chatId, inv ? t.alreadyPaid(inv) : t.gone);
    const days = inv.due_date ? Math.max(0, daysBetween(inv.due_date, ymd(now))) : 0;
    const note = await reminderWriter(ai, { ...inv, days_overdue: days }, u.lang);
    await db.markReminded(inv.id, now);
    return reply(chatId, t.reminderPreview(inv, note), kb([[{ text: t.btnSendReminder, url: shareUrl(inv.pay_url, note) }]]));
  }

  async function sendInPerson(chatId, u, invId) {
    const t = T(u.lang);
    const inv = await db.getInvoice(invId, u.id);
    if (!inv) return reply(chatId, t.gone);
    if (inv.status !== 'SENT') return reply(chatId, t.alreadyPaid(inv));
    return reply(chatId, t.inPerson(inv, u.lang), kb([[{ text: t.btnPayLink, url: inv.pay_url }]]));
  }

  // --- settings ---

  async function sendSettings(chatId, u, messageId = null) {
    const t = T(u.lang);
    const rows = [
      [{ text: t.btnLang, callback_data: `lang:${u.lang === 'es' ? 'en' : 'es'}` }],
      CURRENCIES.map((c) => ({ text: c === u.currency ? `• ${c}` : c, callback_data: `cur:${c}` })),
      [{ text: t.btnPayout, callback_data: 'po' }],
      [{ text: t.btnBusiness, callback_data: 'biz' }],
    ];
    return edit(chatId, messageId, t.settings(u), kb(rows));
  }

  /** Where the freelancer gets paid: one button per network; `draftId` resumes that invoice afterwards. */
  function askPayout(chatId, u, draftId = 0) {
    return reply(chatId, T(u.lang).askPayout, kb(Object.keys(PAYOUTS).map((chain) => [{ text: payoutLabel(chain), callback_data: `po:${chain}:${draftId}` }])));
  }

  /** Saves the payout address and, if it was asked while creating an invoice, finishes that invoice. */
  async function setPayoutAddress(chatId, u, chain, text, draftId, now) {
    const t = T(u.lang);
    const address = normalizePayoutAddress(chain, text);
    const onChain = { near: () => intents.accountExists(address), ccd: () => concordium.accountExists(address) }[chain];
    const ok = isPayoutAddress(chain, address) && (!onChain || await onChain().catch(() => false));
    if (!ok) return reply(chatId, t.badAddress(chain));
    await db.setPayout(u.id, chain, address);
    await db.setPending(u.id, null);
    await reply(chatId, t.payoutSaved(chain, address));
    if (draftId && await db.getDraft(draftId, u.id)) return sendDraft(chatId, null, { ...u, payout_chain: chain, payout_address: address }, draftId, now);
    return null;
  }

  // --- input ---

  /** Everything the user says (typed or transcribed) ends here. */
  async function handleText(chatId, u, text, now, statusId = null) {
    let t = T(u.lang);
    const say = (s, extra) => edit(chatId, statusId, s, extra);
    const drop = () => (statusId ? api.call('deleteMessage', { chat_id: chatId, message_id: statusId }).catch(() => {}) : null);

    // Answers to a question we asked
    const [kind, ref, ref2] = String(u.pending || '').split(':');
    if (kind === 'addr' && PAYOUTS[ref]) {
      if (/^\S+$/.test(text.trim())) {
        await drop();
        return setPayoutAddress(chatId, u, ref, text, Number(ref2), now);
      }
      await db.setPending(u.id, null); // a sentence: they moved on, treat it as a new message
    } else if (kind === 'fix') {
      const dr = await db.getDraft(Number(ref), u.id);
      if (dr) {
        const fixed = await fixer(ai, dr.data, text, await ctxOf(u, now));
        if (!fixed) return say(t.aiFail);
        await drop();
        return refreshDraft(chatId, u, dr.id, fixed);
      }
      await db.setPending(u.id, null);
    } else if (kind === 'business') {
      await db.setBusiness(u.id, text.trim().slice(0, 80));
      await db.setPending(u.id, null);
      return say(t.saved);
    }

    const a = await nlu(ai, text, await ctxOf(u, now));
    if (!a) return say(t.aiFail);
    // Answer in the language they just used, and keep it for alerts and buttons
    if (a.lang && a.lang !== u.lang) {
      await db.setLang(u.id, a.lang);
      u = { ...u, lang: a.lang };
      t = T(a.lang);
    }
    if (a.intent === 'invoice') return showDraft(chatId, u, a.draft, text, now, statusId);
    await drop();
    if (a.intent === 'debtors') return sendOwed(chatId, u, now);
    if (a.intent === 'summary') return sendMonth(chatId, u, now);
    if (a.intent === 'help') return reply(chatId, t.help, { reply_markup: mainKeyboard(u.lang) });
    return reply(chatId, esc(a.reply || t.help), { reply_markup: mainKeyboard(u.lang) });
  }

  async function handleVoice(msg, u, now) {
    const t = T(u.lang);
    const chatId = msg.chat.id;
    const v = msg.voice || msg.audio || msg.video_note;
    if ((v.duration || 0) > cfg.maxAudioSeconds) return reply(chatId, t.tooLong(cfg.maxAudioSeconds));
    const key = `secs:${u.id}:${ymd(now)}`;
    const used = Number(await db.kvGet(key)) || 0;
    if (used >= cfg.audioSecondsPerDay) return reply(chatId, t.quota);
    const status = await reply(chatId, t.thinking);
    try {
      const file = await api.call('getFile', { file_id: v.file_id });
      const bytes = await (await http(api.fileUrl(file.file_path))).arrayBuffer();
      const heard = await stt(ai, bytes);
      await db.kvSet(key, used + Math.max(1, heard.seconds || v.duration || 1));
      if (!heard.text) return edit(chatId, status.message_id, t.aiFail);
      return handleText(chatId, u, heard.text, now, status.message_id);
    } catch (e) {
      console.error('[voice]', e.message);
      return edit(chatId, status.message_id, t.aiFail);
    }
  }

  async function handleCallback(q, now) {
    const chatId = q.message?.chat?.id;
    const messageId = q.message?.message_id;
    await api.call('answerCallbackQuery', { callback_query_id: q.id }).catch(() => {});
    if (!chatId) return;
    let u = await db.upsertUser(q.from, now);
    const t = T(u.lang);
    const [cmd, arg, arg2] = String(q.data || '').split(':');
    const id = Number(arg);
    switch (cmd) {
      case 'send': return sendDraft(chatId, messageId, u, id, now);
      case 'fix': {
        if (!(await db.getDraft(id, u.id))) return edit(chatId, messageId, t.gone);
        await db.setPending(u.id, `fix:${id}`);
        return reply(chatId, t.askFix);
      }
      case 'x': {
        await db.deleteDraft(id);
        await db.setPending(u.id, null);
        return edit(chatId, messageId, t.cancelled);
      }
      case 'rem': return sendReminder(chatId, u, id, now);
      case 'qr': return sendInPerson(chatId, u, id);
      case 'lang': {
        await db.setLang(u.id, arg === 'es' ? 'es' : 'en');
        u = await db.getUser(u.id);
        await reply(chatId, T(u.lang).saved, { reply_markup: mainKeyboard(u.lang) });
        return sendSettings(chatId, u, messageId);
      }
      case 'cur': {
        if (CURRENCIES.includes(arg)) await db.setCurrency(u.id, arg);
        return sendSettings(chatId, await db.getUser(u.id), messageId);
      }
      case 'po': {
        if (!PAYOUTS[arg]) return askPayout(chatId, u);
        await db.setPending(u.id, `addr:${arg}:${Number(arg2) || 0}`);
        return reply(chatId, t.askAddress(arg));
      }
      case 'biz': {
        await db.setPending(u.id, 'business');
        return reply(chatId, t.askBusiness);
      }
      default: return null;
    }
  }

  async function handleMessage(msg, now) {
    if (msg.chat?.type !== 'private' || !msg.from) return;
    const chatId = msg.chat.id;
    const u = await db.upsertUser(msg.from, now);
    const t = T(u.lang);
    if (msg.voice || msg.audio || msg.video_note) return handleVoice(msg, u, now);
    const text = String(msg.text || '').trim();
    if (!text) return reply(chatId, t.help, { reply_markup: mainKeyboard(u.lang) });
    if (/^\/start\b/.test(text)) {
      await db.setPending(u.id, null);
      return reply(chatId, t.welcome(msg.from.first_name), { reply_markup: mainKeyboard(u.lang) });
    }
    const action = BUTTONS.get(text) || { '/owed': 'owed', '/month': 'month', '/help': 'help', '/settings': 'settings' }[text.split(/[\s@]/)[0]];
    if (action) {
      await db.setPending(u.id, null);
      if (action === 'owed') return sendOwed(chatId, u, now);
      if (action === 'month') return sendMonth(chatId, u, now);
      if (action === 'settings') return sendSettings(chatId, u);
      return reply(chatId, t.help, { reply_markup: mainKeyboard(u.lang) });
    }
    return handleText(chatId, u, text, now);
  }

  /** Called every minute by the clock: follows live payments; once an hour, warns once about each overdue invoice. */
  async function tick(now) {
    const checked = await payments.sweep(now);
    const slot = String(Math.floor(now / HOUR));
    if (await db.kvGet('tick:slot') === slot) return checked ? `payments:${checked}` : 'idle';
    await db.kvSet('tick:slot', slot);
    const today = ymd(now);
    for (const inv of await db.openInvoices(30)) {
      if (!inv.due_date || inv.due_date >= today || await db.kvGet(`overdue:${inv.id}`)) continue;
      await db.kvSet(`overdue:${inv.id}`, today);
      const u = await db.getUser(inv.user_id);
      const t = T(u?.lang);
      await reply(inv.user_id, t.overdueAlert(inv, u?.lang), kb([[{ text: t.btnRemind(firstName(inv.client_name)), callback_data: `rem:${inv.id}` }]])).catch((e) => console.error('[tick]', e.message));
    }
    return 'done';
  }

  return {
    tick,
    async handleUpdate(update) {
      const now = clock();
      if (update.message) return handleMessage(update.message, now);
      if (update.callback_query) return handleCallback(update.callback_query, now);
      return null;
    },
    commands: [
      { command: 'owed', description: 'Who owes me / Quién me debe' },
      { command: 'month', description: 'This month / Este mes' },
      { command: 'settings', description: 'Settings / Ajustes' },
      { command: 'help', description: 'How it works / Cómo funciona' },
    ],
  };
}
