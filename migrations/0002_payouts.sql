-- Payouts on more than NEAR: the freelancer chooses the network (near | arb | bch) and gives an address there.
ALTER TABLE users RENAME COLUMN near_account TO payout_address;
ALTER TABLE users ADD COLUMN payout_chain TEXT NOT NULL DEFAULT 'near';
ALTER TABLE invoices RENAME COLUMN near_account TO payout_address;
ALTER TABLE invoices ADD COLUMN payout_chain TEXT NOT NULL DEFAULT 'near';
ALTER TABLE deposits RENAME COLUMN usdc TO amount_out; -- base units of the payout asset
