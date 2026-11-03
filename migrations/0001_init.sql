-- Cobra on NEAR: users, clients, drafts, invoices, deposits (one per payment attempt), kv.
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,                  -- Telegram user id
  first_name TEXT,
  lang TEXT NOT NULL DEFAULT 'en',         -- 'en' | 'es'
  currency TEXT NOT NULL DEFAULT 'USD',    -- what invoices are written in; payment always settles in USDC
  business_name TEXT,                      -- shown as the invoicer on the payment page
  near_account TEXT,                       -- where the USDC lands
  pending TEXT,                            -- what the next text message answers: 'near:<draftId>' | 'fix:<draftId>' | 'business'
  created_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS clients (
  user_id INTEGER NOT NULL,
  name_key TEXT NOT NULL,                  -- normalized name, for "bill Marta again"
  name TEXT NOT NULL,
  email TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, name_key)
);
CREATE TABLE IF NOT EXISTS drafts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  data TEXT NOT NULL,                      -- JSON: client_name, client_email, items, currency, due_date, note
  heard TEXT,                              -- what the user said (transcript), for context on corrections
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS drafts_user ON drafts (user_id);
CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  pay_token TEXT NOT NULL UNIQUE,          -- random; the payment page lives at /pay/<token>
  number TEXT,
  client_name TEXT NOT NULL,
  client_email TEXT,
  description TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL,                  -- EUR | USD
  near_account TEXT NOT NULL,              -- recipient, frozen when the invoice is created
  due_date TEXT,                           -- YYYY-MM-DD
  status TEXT NOT NULL DEFAULT 'SENT',     -- SENT | PAID | CANCELLED
  pay_url TEXT,
  paid_with TEXT,                          -- "25.05 USDT · Tron"
  paid_tx TEXT,                            -- explorer link of the USDC arriving on NEAR
  created_at INTEGER NOT NULL,
  paid_at INTEGER,
  reminded_at INTEGER
);
CREATE INDEX IF NOT EXISTS invoices_user ON invoices (user_id, status);
CREATE TABLE IF NOT EXISTS deposits (
  address TEXT PRIMARY KEY,                -- 1Click deposit address
  memo TEXT,                               -- some chains need it next to the address
  invoice_id INTEGER NOT NULL,
  origin_asset TEXT NOT NULL,
  symbol TEXT NOT NULL,
  chain TEXT NOT NULL,
  refund_to TEXT NOT NULL,
  amount_in TEXT NOT NULL,                 -- formatted: what the client has to send
  usdc TEXT NOT NULL,                      -- USDC base units the freelancer receives
  quote TEXT NOT NULL,                     -- full signed quote, kept for disputes
  deadline INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING_DEPOSIT',
  checked_at INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS deposits_invoice ON deposits (invoice_id);
CREATE INDEX IF NOT EXISTS deposits_open ON deposits (status, deadline);
CREATE TABLE IF NOT EXISTS kv (
  k TEXT PRIMARY KEY,
  v TEXT
);
