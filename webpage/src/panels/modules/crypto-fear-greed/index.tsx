import { createFinanceWatchPanel } from '../finance-watch-kit';

export const panel = createFinanceWatchPanel({
  id: 'crypto-fear-greed',
  title: 'FEAR & GREED',
  description: 'Crypto sentiment gauge with price drivers.',
  question: 'Shows the Alternative.me crypto Fear & Greed score with BTC and ETH momentum drivers.',
  mode: 'sentiment',
  limit: 6,
});
