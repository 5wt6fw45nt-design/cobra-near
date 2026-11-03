// A paying agent, for the Concordium demo: it asks Cobra for an invoice, gets 402 Payment Required, pays the exact
// CCD amount on testnet with its own key, and retries with X-PAYMENT. No human in the loop.
//
//   CCD_WALLET=./agent.export node scripts/x402-agent.mjs https://<worker>/x402/<token>
//
// CCD_WALLET is the key file exported from the Concordium Browser Wallet (testnet account of the paying agent).

import { readFileSync } from 'node:fs';
import {
  ConcordiumGRPCWebClient, AccountAddress, CcdAmount, TransactionExpiry, AccountTransactionType,
  buildAccountSigner, signTransaction, parseWallet, TransactionHash,
} from '@concordium/web-sdk';

const url = process.argv[2];
if (!url || !process.env.CCD_WALLET) {
  console.error('usage: CCD_WALLET=<exported key file> node scripts/x402-agent.mjs <x402 url>');
  process.exit(1);
}
const wallet = parseWallet(readFileSync(process.env.CCD_WALLET, 'utf8'));
const sender = AccountAddress.fromBase58(wallet.value.address);
const node = new ConcordiumGRPCWebClient(process.env.CCD_GRPC || 'https://grpc.testnet.concordium.com', 20000, { timeout: 30000 });

const first = await fetch(url);
if (first.status !== 402) {
  console.log(first.status, await first.text());
  process.exit(0);
}
const { accepts } = await first.json();
const req = accepts.find((a) => a.scheme === 'exact' && a.network.startsWith('concordium') && a.asset === 'CCD');
console.log(`402 → ${req.description}: ${Number(req.maxAmountRequired) / 1e6} CCD to ${req.payTo}`);

const tx = {
  type: AccountTransactionType.Transfer,
  header: { sender, nonce: (await node.getNextAccountNonce(sender)).nonce, expiry: TransactionExpiry.futureMinutes(5) },
  payload: { amount: CcdAmount.fromMicroCcd(BigInt(req.maxAmountRequired)), toAddress: AccountAddress.fromBase58(req.payTo) },
};
const hash = await node.sendAccountTransaction(tx, await signTransaction(tx, buildAccountSigner(wallet)));
const hex = TransactionHash.toHexString(hash);
console.log(`paid: ${hex}, waiting for finalization…`);
await node.waitForTransactionFinalization(hash);

const header = Buffer.from(JSON.stringify({ x402Version: 1, scheme: 'exact', network: req.network, payload: { txHash: hex } })).toString('base64');
const paid = await fetch(url, { headers: { 'x-payment': header } });
console.log(paid.status, await paid.text());
const receipt = paid.headers.get('x-payment-response');
if (receipt) console.log('receipt:', Buffer.from(receipt, 'base64').toString());
