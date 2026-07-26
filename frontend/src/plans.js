// Keep these quota numbers in sync with backend/config/plans.js -
// they're what actually gets applied to a new account at registration.
export const PLANS = [
  {
    id: 'free',
    name: 'Free',
    price: '$0',
    period: 'forever',
    tagline: 'Try it out, self-host it, no card required.',
    features: ['1 workspace', '1 vCPU · 1 GB RAM', 'Browser terminal', 'Community support'],
    cta: 'Start free',
  },
  {
    id: 'pro',
    name: 'Pro',
    price: '$12',
    period: 'per month',
    tagline: 'For individual developers running real projects.',
    features: [
      '5 workspaces',
      '2 vCPU · 2 GB RAM each',
      'SSH + VS Code Remote-SSH',
      'Priority email support',
    ],
    highlighted: true,
    cta: 'Start Pro trial',
  },
  {
    id: 'team',
    name: 'Team',
    price: '$39',
    period: 'per month',
    tagline: 'For small teams sharing one Forge instance.',
    features: [
      '20 workspaces',
      '4 vCPU · 4 GB RAM each',
      'Admin panel & per-user quotas',
      'Cluster resource caps',
    ],
    cta: 'Start Team trial',
  },
];
