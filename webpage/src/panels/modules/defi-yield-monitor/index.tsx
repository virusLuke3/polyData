import { createFinanceWatchPanel } from '../finance-watch-kit';

export const panel = createFinanceWatchPanel({
  id: 'defi-yield-monitor',
  title: 'DEFI YIELDS',
  description: 'Protocol APY and TVL watch board.',
  question: 'Shows seeded DeFiLlama yield pools ranked by APY with TVL and risk tags.',
  limit: 10,
});
