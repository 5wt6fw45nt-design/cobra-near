// The page the client opens: pick a token and a chain, get a deposit address, watch the payment land.

const QR = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';

/** JSON that is safe inside a <script> tag. */
const embed = (x) => JSON.stringify(x).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');

/** What the client may see of an invoice: never the freelancer's Telegram id or the client book. */
export const publicInvoice = (inv, owner) => ({
  from: owner?.business_name || owner?.first_name || 'Cobra',
  to: inv.client_name,
  number: inv.number,
  description: inv.description,
  amount: inv.amount_cents / 100,
  currency: inv.currency,
  due: inv.due_date,
  recipient: inv.near_account,
  status: inv.status,
  paidWith: inv.paid_with,
  paidTx: inv.paid_tx,
});

export function payPage({ token, invoice, options, lang }) {
  return `<!doctype html>
<html lang="${lang === 'es' ? 'es' : 'en'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<title>Cobra · ${lang === 'es' ? 'Pagar factura' : 'Pay invoice'}</title>
<script src="${QR}"></script>
<style>
  :root { --bg:#f4f6fa; --card:#fff; --ink:#0f1b2d; --soft:#5d6b82; --line:#dfe5ee; --accent:#00a86b; --accent-ink:#fff; --warn:#b26a00; --bad:#c8352b; }
  @media (prefers-color-scheme: dark) { :root { --bg:#0b111c; --card:#141c2b; --ink:#e9eef7; --soft:#9aa8bf; --line:#253247; --accent:#2fd39a; --accent-ink:#06261a; --warn:#ffb648; --bad:#ff7b70; } }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--ink); font:16px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  main { max-width:520px; margin:0 auto; padding:20px 16px 40px; display:grid; gap:14px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:16px; padding:18px; }
  .brand { display:flex; align-items:center; gap:8px; color:var(--soft); font-size:14px; }
  .brand b { color:var(--ink); }
  h1 { font-size:34px; margin:6px 0 2px; font-variant-numeric:tabular-nums; letter-spacing:-.5px; }
  .muted { color:var(--soft); font-size:14px; }
  .row { display:flex; justify-content:space-between; gap:12px; font-size:14px; padding:6px 0; border-top:1px solid var(--line); }
  .row:first-of-type { border-top:0; }
  .row span:last-child { text-align:right; overflow-wrap:anywhere; }
  label { display:block; font-weight:600; margin:14px 0 6px; font-size:14px; }
  select, input { width:100%; font:inherit; color:var(--ink); background:var(--bg); border:1px solid var(--line); border-radius:10px; padding:11px 12px; }
  select:focus, input:focus { outline:2px solid var(--accent); outline-offset:1px; }
  button { width:100%; font:inherit; font-weight:700; border:0; border-radius:12px; padding:13px; margin-top:16px; background:var(--accent); color:var(--accent-ink); cursor:pointer; }
  button:disabled { opacity:.55; cursor:wait; }
  button.ghost { background:transparent; color:var(--ink); border:1px solid var(--line); margin-top:10px; font-weight:600; }
  .send { font-size:22px; font-weight:700; font-variant-numeric:tabular-nums; margin:4px 0; }
  .addr { font:14px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; background:var(--bg); border:1px solid var(--line); border-radius:10px; padding:10px; overflow-wrap:anywhere; cursor:pointer; }
  #qr { display:flex; justify-content:center; padding:14px; background:#fff; border-radius:12px; margin:12px 0; }
  #qr img, #qr canvas { max-width:100%; height:auto; }
  .status { display:flex; align-items:center; gap:10px; font-weight:600; }
  .dot { width:10px; height:10px; border-radius:50%; background:var(--warn); flex:none; animation:pulse 1.4s infinite; }
  .ok .dot { background:var(--accent); animation:none; } .bad .dot { background:var(--bad); animation:none; }
  @keyframes pulse { 50% { opacity:.3; } }
  .err { color:var(--bad); font-size:14px; margin-top:10px; min-height:1em; }
  .done { text-align:center; }
  .done .big { font-size:54px; }
  a { color:var(--accent); }
  .hidden { display:none; }
  footer { text-align:center; color:var(--soft); font-size:12px; }
</style>
</head>
<body>
<main>
  <div class="brand">🧾 <b>Cobra</b> · <span id="tagline"></span></div>
  <section class="card">
    <div class="muted" id="fromLine"></div>
    <h1 id="amount"></h1>
    <div class="muted" id="desc"></div>
    <div style="margin-top:12px" id="facts"></div>
  </section>

  <section class="card" id="choose">
    <label for="asset" id="lAsset"></label>
    <select id="asset"></select>
    <label for="refund" id="lRefund"></label>
    <input id="refund" autocomplete="off" spellcheck="false">
    <div class="muted" id="hRefund" style="margin-top:6px"></div>
    <button id="go"></button>
    <div class="err" id="err"></div>
  </section>

  <section class="card hidden" id="deposit">
    <div class="muted" id="lSend"></div>
    <div class="send" id="sendAmount"></div>
    <div id="qr"></div>
    <div class="muted" id="lTo"></div>
    <div class="addr" id="addr" title="copy"></div>
    <div class="hidden" id="memoBox"><div class="muted" id="lMemo" style="margin-top:10px"></div><div class="addr" id="memo"></div></div>
    <div class="muted" id="expires" style="margin-top:10px"></div>
    <div class="status" id="statusBox" style="margin-top:14px"><span class="dot"></span><span id="statusText"></span></div>
    <button class="ghost" id="back"></button>
  </section>

  <section class="card done hidden" id="paid">
    <div class="big">✅</div>
    <h2 id="paidTitle"></h2>
    <div class="muted" id="paidWith"></div>
    <p><a id="paidTx" target="_blank" rel="noopener"></a></p>
  </section>
  <footer id="foot"></footer>
</main>
<script>
const TOKEN = ${embed(token)};
const INV = ${embed(invoice)};
const OPTIONS = ${embed(options)};
const L = (navigator.language || '').startsWith('es') ? 'es' : ${embed(lang === 'es' ? 'es' : 'en')};
const TX = {
  en: { tagline: 'pay with any crypto', from: (f, n) => 'Invoice' + (n ? ' #' + n : '') + ' from ' + f, to: 'To', due: 'Due', receives: 'Received as', asset: 'Pay with', refund: 'Your address on that chain', refundHint: (c) => 'Only used to send money back if something goes wrong (or the excess, if you send more). Your ' + c + ' address.', nearHint: 'Your NEAR account, e.g. you.near', go: 'Get payment address', send: 'Send exactly', to2: 'To this address (tap to copy)', memo: 'Memo / tag (required)', expires: (m) => 'This address waits for your payment ' + m + ' min. After that, start again.', waiting: 'Waiting for your payment…', known: 'Payment seen, confirming…', processing: 'Payment received, converting to USDC…', incomplete: 'Less than the amount arrived. Send the rest to the same address.', success: 'Paid', refunded: 'The payment was refunded to your address.', failed: 'Something failed; your funds are refunded to your address.', back: 'Pay with something else', copied: 'Copied', paidTitle: 'Invoice paid', thanks: 'Thank you!', seeTx: 'See the transaction', closed: 'This invoice is no longer open.', errAsset: 'Choose what you pay with.', errRefund: 'Write your address on that chain.', errGeneric: 'That did not work. Check the address and try again.', errLimit: 'Too many attempts for this invoice. Ask for a new link.', foot: 'Powered by NEAR Intents · Cobra never holds funds', usdc: 'USDC on NEAR' },
  es: { tagline: 'paga con cualquier cripto', from: (f, n) => 'Factura' + (n ? ' n.º ' + n : '') + ' de ' + f, to: 'Para', due: 'Vence', receives: 'Se recibe como', asset: 'Pagar con', refund: 'Tu dirección en esa red', refundHint: (c) => 'Solo se usa para devolverte el dinero si algo falla (o lo que sobre, si mandas de más). Tu dirección de ' + c + '.', nearHint: 'Tu cuenta de NEAR, por ejemplo tu.near', go: 'Obtener dirección de pago', send: 'Envía exactamente', to2: 'A esta dirección (toca para copiar)', memo: 'Memo / etiqueta (obligatorio)', expires: (m) => 'Esta dirección espera tu pago ' + m + ' min. Después, vuelve a empezar.', waiting: 'Esperando tu pago…', known: 'Pago visto, confirmando…', processing: 'Pago recibido, convirtiendo a USDC…', incomplete: 'Ha llegado menos del importe. Manda el resto a la misma dirección.', success: 'Pagado', refunded: 'El pago se ha devuelto a tu dirección.', failed: 'Algo ha fallado; tus fondos se devuelven a tu dirección.', back: 'Pagar con otra cosa', copied: 'Copiado', paidTitle: 'Factura pagada', thanks: '¡Gracias!', seeTx: 'Ver la transacción', closed: 'Esta factura ya no está abierta.', errAsset: 'Elige con qué pagas.', errRefund: 'Escribe tu dirección en esa red.', errGeneric: 'No ha funcionado. Revisa la dirección y vuelve a intentarlo.', errLimit: 'Demasiados intentos para esta factura. Pide un enlace nuevo.', foot: 'Funciona con NEAR Intents · Cobra nunca toca los fondos', usdc: 'USDC en NEAR' },
}[L];
const $ = (id) => document.getElementById(id);
const fmt = (n, c) => new Intl.NumberFormat(L === 'es' ? 'es-ES' : 'en-US', { style: 'currency', currency: c }).format(n);
const day = (d) => new Intl.DateTimeFormat(L === 'es' ? 'es-ES' : 'en-US', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(d + 'T12:00:00Z'));
const row = (k, v) => { const r = document.createElement('div'); r.className = 'row'; const a = document.createElement('span'); a.className = 'muted'; a.textContent = k; const b = document.createElement('span'); b.textContent = v; r.append(a, b); return r; };

$('tagline').textContent = TX.tagline;
$('fromLine').textContent = TX.from(INV.from, INV.number);
$('amount').textContent = fmt(INV.amount, INV.currency);
$('desc').textContent = INV.description;
$('facts').append(row(TX.to, INV.to));
if (INV.due) $('facts').append(row(TX.due, day(INV.due)));
$('facts').append(row(TX.receives, TX.usdc + ' · ' + INV.recipient));
$('lAsset').textContent = TX.asset; $('lRefund').textContent = TX.refund; $('go').textContent = TX.go; $('back').textContent = TX.back;
$('lSend').textContent = TX.send; $('lTo').textContent = TX.to2; $('lMemo').textContent = TX.memo; $('foot').textContent = TX.foot;
for (const o of OPTIONS) { const el = document.createElement('option'); el.value = o.assetId; el.textContent = o.symbol + ' · ' + o.chainName; $('asset').append(el); }
const current = () => OPTIONS.find((o) => o.assetId === $('asset').value);
const hint = () => { const o = current(); $('hRefund').textContent = o?.chain === 'near' ? TX.nearHint : TX.refundHint(o ? o.chainName : ''); };
$('asset').onchange = hint; hint();

let watching = null;
function showPaid(inv) {
  for (const id of ['choose', 'deposit']) $(id).classList.add('hidden');
  $('paid').classList.remove('hidden');
  $('paidTitle').textContent = TX.paidTitle + ' · ' + TX.thanks;
  $('paidWith').textContent = inv.paidWith || '';
  if (inv.paidTx) { $('paidTx').href = inv.paidTx; $('paidTx').textContent = TX.seeTx; }
  clearInterval(watching);
}
if (INV.status === 'PAID') showPaid(INV);
else if (INV.status !== 'SENT') { $('choose').innerHTML = ''; $('choose').textContent = TX.closed; }

function copy(el) { navigator.clipboard?.writeText(el.textContent).then(() => { const old = el.textContent; el.textContent = TX.copied; setTimeout(() => { el.textContent = old; }, 900); }); }
$('addr').onclick = () => copy($('addr'));
$('memo').onclick = () => copy($('memo'));

function setStatus(s) {
  const box = $('statusBox');
  box.className = 'status' + (s === 'SUCCESS' ? ' ok' : (s === 'REFUNDED' || s === 'FAILED') ? ' bad' : '');
  $('statusText').textContent = { PENDING_DEPOSIT: TX.waiting, KNOWN_DEPOSIT_TX: TX.known, PROCESSING: TX.processing, INCOMPLETE_DEPOSIT: TX.incomplete, SUCCESS: TX.success, REFUNDED: TX.refunded, FAILED: TX.failed }[s] || TX.waiting;
}

function showDeposit(d) {
  $('choose').classList.add('hidden');
  $('deposit').classList.remove('hidden');
  $('sendAmount').textContent = d.amountIn + ' ' + d.symbol + ' · ' + d.chainName;
  $('addr').textContent = d.address;
  $('memoBox').classList.toggle('hidden', !d.memo);
  if (d.memo) $('memo').textContent = d.memo;
  $('qr').innerHTML = '';
  if (window.QRCode) new QRCode($('qr'), { text: d.address, width: 220, height: 220 });
  $('expires').textContent = TX.expires(Math.max(1, Math.round((d.deadline - Date.now()) / 60000)));
  setStatus(d.status);
  clearInterval(watching);
  watching = setInterval(() => poll(d.address), 5000);
}

async function poll(address) {
  try {
    const r = await fetch('/pay/' + TOKEN + '/status?d=' + encodeURIComponent(address));
    if (!r.ok) return;
    const s = await r.json();
    if (s.invoice.status === 'PAID') return showPaid(s.invoice);
    if (s.deposit) setStatus(s.deposit.status);
  } catch {}
}

$('back').onclick = () => { clearInterval(watching); $('deposit').classList.add('hidden'); $('choose').classList.remove('hidden'); };
$('go').onclick = async () => {
  $('err').textContent = '';
  if (!current()) return ($('err').textContent = TX.errAsset);
  const refundTo = $('refund').value.trim();
  if (refundTo.length < 2) return ($('err').textContent = TX.errRefund);
  $('go').disabled = true;
  try {
    const r = await fetch('/pay/' + TOKEN + '/quote', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ assetId: current().assetId, refundTo }) });
    const out = await r.json().catch(() => ({}));
    if (!r.ok) { $('err').textContent = out.error === 'limit' ? TX.errLimit : out.error === 'closed' ? TX.closed : (out.detail || TX.errGeneric); return; }
    showDeposit(out);
  } catch { $('err').textContent = TX.errGeneric; } finally { $('go').disabled = false; }
};
</script>
</body>
</html>`;
}
