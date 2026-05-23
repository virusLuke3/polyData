import { createFinanceWatchPanel } from '../finance-watch-kit';

export const panel = createFinanceWatchPanel({
  id: 'crypto-perp-funding',
  title: 'CRYPTO PERPS',
  description: 'Crypto perpetual funding pressure list.',
  question: 'Shows whether longs or shorts are crowded based on seeded Binance and Bybit funding snapshots.',
  limit: 10,
});
