import { createFinanceWatchPanel } from '../finance-watch-kit';

export const panel = createFinanceWatchPanel({
  id: 'tradfi-perp-radar',
  title: 'TRADFI PERPS',
  description: 'Tokenized stock, index, and commodity perp radar.',
  question: 'Ranks seeded TradFi perp proxies by mark/reference basis and funding pressure.',
  limit: 10,
});
