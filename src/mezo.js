// Direct MUSD payments on Mezo (Bitcoin-backed stablecoin, ERC-20, 18 decimals). NEAR Intents does not route MUSD,
// so the client sends MUSD straight to the freelancer's address and Cobra watches the chain for that exact amount.
// Docs: https://mezo.org/docs/developers/ · token addresses: github.com/mezo-org/musd (solidity/artifacts/deployments)

export const MEZO_NETWORKS = {
  testnet: {
    chainId: 31611, name: 'Mezo Testnet', rpc: 'https://rpc.test.mezo.org', explorer: 'https://explorer.test.mezo.org',
    musd: '0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503',
  },
  mainnet: {
    chainId: 31612, name: 'Mezo', rpc: 'https://mezo-mainnet.boar.network', explorer: 'https://explorer.mezo.org',
    musd: '0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186',
  },
};

export const MUSD_ASSET = 'mezo:musd'; // our own id for "pay MUSD directly", next to the 1Click asset ids
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'; // keccak("Transfer(address,address,uint256)")
const MAX_RANGE = 5_000; // blocks per eth_getLogs call; public RPCs cap the range

const pad32 = (hex) => `0x${hex.replace(/^0x/, '').toLowerCase().padStart(64, '0')}`;

/** 11200000000000000002 wei → "11.200000000000000002" (trailing zeros trimmed, never scientific notation). */
export function formatUnits(wei, decimals = 18) {
  const s = BigInt(wei).toString().padStart(decimals + 1, '0');
  const frac = s.slice(-decimals).replace(/0+$/, '');
  return `${s.slice(0, -decimals)}${frac ? `.${frac}` : ''}`;
}

/**
 * The exact amount a client must send for an invoice: the USD value in MUSD plus the invoice id in wei.
 * The tag (a few wei, worth nothing) tells two invoices of the same amount to the same freelancer apart.
 */
export const taggedAmount = (usdc6, invoiceId) => (BigInt(usdc6) * 10n ** 12n + BigInt(invoiceId)).toString();

/** ERC-20 transfer(to, amount) calldata, for the "pay with wallet" button. */
export const transferData = (to, wei) => `0xa9059cbb${pad32(to).slice(2)}${BigInt(wei).toString(16).padStart(64, '0')}`;

export function createMezo(network = 'testnet', fetchFn = (...a) => fetch(...a)) {
  const net = MEZO_NETWORKS[network] || MEZO_NETWORKS.testnet;
  let id = 0;

  async function rpc(method, params) {
    const res = await fetchFn(net.rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) });
    const body = await res.json().catch(() => ({}));
    if (body.error || body.result === undefined) throw new Error(`Mezo ${method}: ${body.error?.message || res.status}`);
    return body.result;
  }

  return {
    net,
    blockNumber: async () => Number(BigInt(await rpc('eth_blockNumber', []))),

    /**
     * Looks for a MUSD Transfer of exactly `wei` to `to` from `fromBlock` on. Scans at most a few ranges per call
     * and returns where it stopped, so the next call continues from there: { found: { hash, block } | null, scanned }.
     */
    async findTransfer(to, wei, fromBlock, maxRanges = 4) {
      const head = Number(BigInt(await rpc('eth_blockNumber', [])));
      let from = fromBlock;
      for (let i = 0; i < maxRanges && from <= head; i++) {
        const until = Math.min(head, from + MAX_RANGE - 1);
        const logs = await rpc('eth_getLogs', [{
          address: net.musd, fromBlock: `0x${from.toString(16)}`, toBlock: `0x${until.toString(16)}`, topics: [TRANSFER, null, pad32(to)],
        }]);
        const hit = logs.find((l) => BigInt(l.data) === BigInt(wei));
        if (hit) return { found: { hash: hit.transactionHash, block: Number(BigInt(hit.blockNumber)) }, scanned: until };
        from = until + 1;
      }
      return { found: null, scanned: from - 1 };
    },

    txUrl: (hash) => `${net.explorer}/tx/${hash}`,
  };
}
