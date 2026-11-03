// Every text Cobra says, in English and Spanish, plus formatting helpers.

export const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const fmtMoney = (cents, currency, lang) =>
  new Intl.NumberFormat(lang === 'es' ? 'es-ES' : 'en-US', { style: 'currency', currency }).format(cents / 100);

export const fmtDate = (ymd, lang) => (ymd
  ? new Intl.DateTimeFormat(lang === 'es' ? 'es-ES' : 'en-US', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${ymd}T12:00:00Z`))
  : null);

export const total = (items) => items.reduce((s, it) => s + it.cents * it.qty, 0);

export const describe = (items) => items.map((it) => (it.qty > 1 ? `${it.name} ×${it.qty}` : it.name)).join(', ').slice(0, 200);

/** Telegram's share sheet: the freelancer picks the chat (WhatsApp-style) where the client is. */
export const shareUrl = (url, text) => `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;

const EN = {
  btnOwed: '💸 Who owes me',
  btnMonth: '📊 This month',
  btnHelp: '❓ How it works',
  btnSettings: '⚙️ Settings',
  welcome: (name) => `Hi ${esc(name || 'there')}! I'm <b>Cobra</b> 🧾🎙️\n\nI bill your clients and chase payments for you. Your clients pay with <b>any crypto on any chain</b> (USDC, USDT, BTC, ETH, SOL, ZEC…) and you receive <b>USDC on NEAR</b>, thanks to NEAR Intents.\n\nJust send me a voice note or a text like:\n\n<i>“Bill Marta Garcia 350 dollars for the logo design, due in 15 days.”</i>\n\nI'll show you the invoice first. Nothing is created until you tap ✅.`,
  help: `<b>What I do</b>\n\n🎙️ <b>Send a voice note or a text</b> saying who to bill, how much and for what. I prepare the invoice and show it to you.\n✅ Tap <b>Create</b> and you get a <b>payment link</b> to send your client.\n🌐 Your client pays with whatever they have: USDC or USDT on most chains, BTC, ETH, SOL, NEAR, ZEC… NEAR Intents converts it and <b>you receive USDC on NEAR</b>.\n💸 I tell you <b>the moment you're paid</b>, with the transaction.\n🔔 <b>Who owes me</b> lists unpaid invoices; I write a polite reminder you can forward.\n📊 <b>This month</b>: what you billed and collected.\n\nNo wallet connection, no keys: Cobra never holds your money.`,
  thinking: '🎙️ Listening…',
  draftTitle: '🧾 <b>Invoice draft</b>',
  to: 'To',
  totalL: 'Total',
  due: 'Due',
  onReceipt: 'on receipt',
  note: 'Note',
  settles: (lang) => (lang === 'es' ? 'Cobras en USDC en NEAR' : 'You receive USDC on NEAR'),
  btnSend: '✅ Create payment link',
  btnFix: '✏️ Fix',
  btnCancel: '❌ Cancel',
  askNear: 'Which <b>NEAR account</b> should receive the USDC? For example <code>marta.near</code>. You only tell me once.',
  badNear: "I couldn't find that NEAR account. Check it and send it again, e.g. <code>marta.near</code>.",
  nearSaved: (a) => `✅ Payments will go to <code>${esc(a)}</code>.`,
  askFix: 'Tell me what to change (by voice or text), e.g. “make it 400” or “due next Friday”.',
  noClient: 'Who should I bill? Tell me the client\'s name, the amount and what it\'s for.',
  noAmount: (name) => `How much should I bill ${esc(name || 'them')}, and for what?`,
  tooMuch: (max) => `That's above the ${max} limit per invoice. Fix the amount and try again.`,
  sent: (inv, lang) => `✅ <b>Payment link ready</b> for ${esc(inv.client_name)}\n${fmtMoney(inv.amount_cents, inv.currency, lang)} · ${esc(inv.description)}\nTo: <code>${esc(inv.near_account)}</code>\n\nSend it to your client: they pay with any crypto, you get USDC. I'll tell you the moment it's paid.`,
  btnShare: '📤 Send to client',
  btnPayLink: '🔗 Payment page',
  btnInPerson: '📱 Get paid in person',
  shareText: (inv, lang) => `Hi ${inv.client_name.split(' ')[0]}, here is the invoice for ${inv.description}: ${fmtMoney(inv.amount_cents, inv.currency, lang)}. You can pay with the crypto you prefer on this page:`,
  inPerson: (inv, lang) => `📱 Open this page on your phone and show it to ${esc(inv.client_name)}. They scan the QR with their wallet and pay ${fmtMoney(inv.amount_cents, inv.currency, lang)}.`,
  cancelled: 'Draft discarded. 👍',
  gone: 'That draft is no longer available. Send me a new one.',
  paid: (inv, lang) => `💸 <b>${esc(inv.client_name)} paid you ${fmtMoney(inv.amount_cents, inv.currency, lang)}</b>\n${esc(inv.description)}\nThey sent ${esc(inv.paid_with)} · you received USDC in <code>${esc(inv.near_account)}</code>.`,
  paidAgain: (inv) => `💸 Another payment for an invoice that was already paid (${esc(inv.client_name)} · ${esc(inv.description)}): ${esc(inv.paid_with)}. The USDC is in <code>${esc(inv.near_account)}</code>.`,
  incoming: (inv, what) => `⏳ <b>${esc(inv.client_name)} is paying</b>: ${esc(what)} detected, converting to USDC…`,
  refundedAttempt: (inv, what, reason) => `↩️ A payment attempt from ${esc(inv.client_name)} (${esc(what)}) could not be completed and was refunded to them${reason ? ` (${esc(reason)})` : ''}. The invoice is still open.`,
  btnTx: '🔎 See the transaction',
  overdueAlert: (inv, lang) => `⏰ <b>${esc(inv.client_name)} hasn't paid yet</b>\n${fmtMoney(inv.amount_cents, inv.currency, lang)} · ${esc(inv.description)}\nThe invoice is past its due date. Want me to write a friendly reminder?`,
  noneOwed: '🎉 Nobody owes you anything right now.',
  owedTitle: (n) => `💸 <b>${n} unpaid invoice${n === 1 ? '' : 's'}</b>`,
  overdue: (d) => `⚠️ ${d} day${d === 1 ? '' : 's'} overdue`,
  dueIn: (d) => (d === 0 ? 'due today' : `due in ${d} day${d === 1 ? '' : 's'}`),
  reminded: 'reminded',
  btnRemind: (name) => `🔔 Remind ${name}`,
  reminderPreview: (inv, note) => `🔔 <b>Reminder for ${esc(inv.client_name)}</b>\nForward it with the button below; the payment link goes with it:\n\n<i>${esc(note)}</i>`,
  btnSendReminder: '📤 Send reminder',
  alreadyPaid: (inv) => `✅ Good news: ${esc(inv.client_name)} already paid that one.`,
  month: (rows, unpaidN, lang) => {
    if (!rows.length) return `📊 <b>This month</b>\n\nNo invoices yet. Send me a voice note to bill your first client.`;
    const lines = rows.map((r) => `• ${r.currency}: collected <b>${fmtMoney(r.paid, r.currency, lang)}</b> (${r.paid_n}) · billed ${fmtMoney(r.billed, r.currency, lang)} (${r.billed_n})`);
    return `📊 <b>This month</b>\n\n${lines.join('\n')}${unpaidN ? `\n\n⏳ ${unpaidN} still unpaid.` : ''}`;
  },
  settings: (u) => `⚙️ <b>Settings</b>\n\nLanguage: ${u.lang === 'es' ? 'Español' : 'English'}\nInvoice currency: ${u.currency} (paid out in USDC)\nNEAR account: ${u.near_account ? `<code>${esc(u.near_account)}</code>` : '—'}\nName on invoices: ${esc(u.business_name || u.first_name || '—')}`,
  btnLang: '🌐 Español',
  btnNear: '🟢 NEAR account',
  btnBusiness: '🏷️ Name on invoices',
  askBusiness: 'What name should your clients see on the invoices? (your name or your business)',
  saved: 'Saved ✅',
  aiFail: "Sorry, I couldn't understand that one. Could you say it again, or type it?",
  tooLong: (s) => `That audio is a bit long. Keep it under ${Math.round(s / 60)} min: who, how much and what for is enough.`,
  quota: 'You have used today\'s voice minutes. You can still type, it works the same.',
  notConfigured: 'Payment links are not set up yet (missing PUBLIC_URL).',
};

const ES = {
  ...EN,
  btnOwed: '💸 Quién me debe',
  btnMonth: '📊 Este mes',
  btnHelp: '❓ Cómo funciona',
  btnSettings: '⚙️ Ajustes',
  welcome: (name) => `¡Hola, ${esc(name || '')}! Soy <b>Cobra</b> 🧾🎙️\n\nFacturo a tus clientes y persigo los pagos por ti. Tus clientes pagan con <b>la cripto que tengan, en la red que sea</b> (USDC, USDT, BTC, ETH, SOL, ZEC…) y tú recibes <b>USDC en NEAR</b>, gracias a NEAR Intents.\n\nMándame un audio o un texto como:\n\n<i>«Factura a Marta García 350 euros por el diseño del logo, a pagar en 15 días.»</i>\n\nPrimero te enseño la factura. No se crea nada hasta que pulses ✅.`,
  help: `<b>Qué hago</b>\n\n🎙️ <b>Mándame un audio o un texto</b> diciendo a quién facturas, cuánto y por qué. Preparo la factura y te la enseño.\n✅ Pulsa <b>Crear</b> y tienes un <b>enlace de pago</b> para mandárselo a tu cliente.\n🌐 Tu cliente paga con lo que tenga: USDC o USDT en casi cualquier red, BTC, ETH, SOL, NEAR, ZEC… NEAR Intents lo convierte y <b>tú recibes USDC en NEAR</b>.\n💸 Te aviso <b>en cuanto te pagan</b>, con la transacción.\n🔔 <b>Quién me debe</b> te enseña lo pendiente; te escribo un recordatorio amable para reenviar.\n📊 <b>Este mes</b>: lo facturado y lo cobrado.\n\nSin conectar carteras ni dar claves: Cobra nunca toca tu dinero.`,
  thinking: '🎙️ Escuchando…',
  draftTitle: '🧾 <b>Borrador de factura</b>',
  to: 'Para',
  totalL: 'Total',
  due: 'Vence',
  onReceipt: 'al recibirla',
  note: 'Nota',
  btnSend: '✅ Crear enlace de pago',
  btnFix: '✏️ Corregir',
  btnCancel: '❌ Cancelar',
  askNear: '¿En qué <b>cuenta de NEAR</b> quieres recibir los USDC? Por ejemplo <code>marta.near</code>. Solo te lo pregunto una vez.',
  badNear: 'No encuentro esa cuenta de NEAR. Revísala y mándamela otra vez, por ejemplo <code>marta.near</code>.',
  nearSaved: (a) => `✅ Los pagos irán a <code>${esc(a)}</code>.`,
  askFix: 'Dime qué cambio (por audio o por texto), por ejemplo «que sean 400» o «que venza el viernes».',
  noClient: '¿A quién facturo? Dime el nombre del cliente, el importe y por qué es.',
  noAmount: (name) => `¿Cuánto le facturo a ${esc(name || 'tu cliente')} y por qué?`,
  tooMuch: (max) => `Supera el límite de ${max} por factura. Corrige el importe y vuelve a intentarlo.`,
  sent: (inv, lang) => `✅ <b>Enlace de pago listo</b> para ${esc(inv.client_name)}\n${fmtMoney(inv.amount_cents, inv.currency, lang)} · ${esc(inv.description)}\nA: <code>${esc(inv.near_account)}</code>\n\nMándaselo a tu cliente: paga con la cripto que quiera y tú recibes USDC. Te aviso en cuanto te pague.`,
  btnShare: '📤 Mandar al cliente',
  btnPayLink: '🔗 Página de pago',
  btnInPerson: '📱 Cobrar en persona',
  shareText: (inv, lang) => `Hola ${inv.client_name.split(' ')[0]}, te paso la factura de ${inv.description}: ${fmtMoney(inv.amount_cents, inv.currency, lang)}. Puedes pagar con la cripto que prefieras en esta página:`,
  inPerson: (inv, lang) => `📱 Abre esta página en tu móvil y enséñasela a ${esc(inv.client_name)}. Escanea el QR con su cartera y paga ${fmtMoney(inv.amount_cents, inv.currency, lang)}.`,
  cancelled: 'Borrador descartado. 👍',
  gone: 'Ese borrador ya no está. Mándame uno nuevo.',
  paid: (inv, lang) => `💸 <b>${esc(inv.client_name)} te ha pagado ${fmtMoney(inv.amount_cents, inv.currency, lang)}</b>\n${esc(inv.description)}\nHa enviado ${esc(inv.paid_with)} · tú has recibido USDC en <code>${esc(inv.near_account)}</code>.`,
  paidAgain: (inv) => `💸 Ha llegado otro pago de una factura que ya estaba pagada (${esc(inv.client_name)} · ${esc(inv.description)}): ${esc(inv.paid_with)}. Los USDC están en <code>${esc(inv.near_account)}</code>.`,
  incoming: (inv, what) => `⏳ <b>${esc(inv.client_name)} está pagando</b>: ${esc(what)} detectado, convirtiendo a USDC…`,
  refundedAttempt: (inv, what, reason) => `↩️ Un intento de pago de ${esc(inv.client_name)} (${esc(what)}) no se ha podido completar y se le ha devuelto${reason ? ` (${esc(reason)})` : ''}. La factura sigue pendiente.`,
  btnTx: '🔎 Ver la transacción',
  overdueAlert: (inv, lang) => `⏰ <b>${esc(inv.client_name)} aún no ha pagado</b>\n${fmtMoney(inv.amount_cents, inv.currency, lang)} · ${esc(inv.description)}\nLa factura ya ha vencido. ¿Te escribo un recordatorio amable?`,
  noneOwed: '🎉 Ahora mismo nadie te debe nada.',
  owedTitle: (n) => `💸 <b>${n} factura${n === 1 ? '' : 's'} sin pagar</b>`,
  overdue: (d) => `⚠️ vencida hace ${d} día${d === 1 ? '' : 's'}`,
  dueIn: (d) => (d === 0 ? 'vence hoy' : `vence en ${d} día${d === 1 ? '' : 's'}`),
  reminded: 'recordada',
  btnRemind: (name) => `🔔 Recordar a ${name}`,
  reminderPreview: (inv, note) => `🔔 <b>Recordatorio para ${esc(inv.client_name)}</b>\nReenvíaselo con el botón; el enlace de pago va incluido:\n\n<i>${esc(note)}</i>`,
  btnSendReminder: '📤 Mandar recordatorio',
  alreadyPaid: (inv) => `✅ Buenas noticias: ${esc(inv.client_name)} ya pagó esa.`,
  month: (rows, unpaidN, lang) => {
    if (!rows.length) return `📊 <b>Este mes</b>\n\nTodavía no hay facturas. Mándame un audio para facturar a tu primer cliente.`;
    const lines = rows.map((r) => `• ${r.currency}: cobrado <b>${fmtMoney(r.paid, r.currency, lang)}</b> (${r.paid_n}) · facturado ${fmtMoney(r.billed, r.currency, lang)} (${r.billed_n})`);
    return `📊 <b>Este mes</b>\n\n${lines.join('\n')}${unpaidN ? `\n\n⏳ ${unpaidN} sin pagar todavía.` : ''}`;
  },
  settings: (u) => `⚙️ <b>Ajustes</b>\n\nIdioma: ${u.lang === 'es' ? 'Español' : 'English'}\nMoneda de las facturas: ${u.currency} (cobras en USDC)\nCuenta de NEAR: ${u.near_account ? `<code>${esc(u.near_account)}</code>` : '—'}\nNombre en las facturas: ${esc(u.business_name || u.first_name || '—')}`,
  btnLang: '🌐 English',
  btnNear: '🟢 Cuenta de NEAR',
  btnBusiness: '🏷️ Nombre en las facturas',
  askBusiness: '¿Qué nombre quieres que vean tus clientes en las facturas? (el tuyo o el de tu negocio)',
  saved: 'Guardado ✅',
  aiFail: 'Perdona, no lo he entendido. ¿Me lo repites o me lo escribes?',
  tooLong: (s) => `Ese audio es un poco largo. Con menos de ${Math.round(s / 60)} min basta: a quién, cuánto y por qué.`,
  quota: 'Has gastado los minutos de audio de hoy. Puedes escribirme, funciona igual.',
  notConfigured: 'Los enlaces de pago aún no están configurados (falta PUBLIC_URL).',
};

export const T = (lang) => (lang === 'es' ? ES : EN);

/** The invoice draft card. */
export function draftCard(d, lang) {
  const t = T(lang);
  const lines = [t.draftTitle, ''];
  lines.push(`${t.to}: <b>${esc(d.client_name || '?')}</b>${d.client_email ? ` · ${esc(d.client_email)}` : ''}`);
  for (const it of d.items) lines.push(`• ${esc(it.name)}${it.qty > 1 ? ` ×${it.qty}` : ''} · ${fmtMoney(it.cents * it.qty, d.currency, lang)}`);
  lines.push(`${t.totalL}: <b>${fmtMoney(total(d.items), d.currency, lang)}</b>`);
  lines.push(`${t.due}: ${d.due_date ? fmtDate(d.due_date, lang) : t.onReceipt}`);
  if (d.note) lines.push(`${t.note}: <i>${esc(d.note)}</i>`);
  lines.push(`🟢 ${t.settles(lang)}`);
  return lines.join('\n');
}

export const mainKeyboard = (lang) => {
  const t = T(lang);
  return { keyboard: [[{ text: t.btnOwed }, { text: t.btnMonth }], [{ text: t.btnHelp }, { text: t.btnSettings }]], resize_keyboard: true, is_persistent: true };
};
