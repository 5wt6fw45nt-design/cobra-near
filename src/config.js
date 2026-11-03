// Cobra on NEAR · settings from the Worker environment.

export const CURRENCIES = ['EUR', 'USD'];

export function loadConfig(vars = globalThis.process?.env ?? {}) {
  const env = (k, d) => vars[k] ?? d;
  return {
    token: env('BOT_TOKEN', ''),
    intents: {
      base: env('ONECLICK_BASE', 'https://1click.chaindefuser.com'),
      apiKey: env('ONECLICK_API_KEY', ''), // optional partner key: lower fees
      rpc: env('NEAR_RPC', 'https://free.rpc.fastnear.com'),
    },
    publicUrl: env('PUBLIC_URL', ''), // https://cobra-near.<you>.workers.dev, for payment links
    quoteMinutes: Number(env('QUOTE_MINUTES', 60)), // how long a deposit address waits for the client
    maxAudioSeconds: Number(env('MAX_AUDIO_SECONDS', 120)), // invoices are short; keeps the free Workers AI quota safe
    audioSecondsPerDay: Number(env('AUDIO_SECONDS_PER_DAY', 300)),
    aiCallsPerDay: Number(env('AI_CALLS_PER_DAY', 80)), // whole bot, all users
    maxAmount: Number(env('MAX_AMOUNT', 100000)),
  };
}
