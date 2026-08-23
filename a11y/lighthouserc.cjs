const sandboxFlags = process.env.LHCI_NO_SANDBOX === '1'
  ? '--no-sandbox --disable-setuid-sandbox'
  : '';
const baseUrl = String(process.env.A11Y_BASE || 'http://localhost:4322').replace(/\/$/, '');

module.exports = {
  ci: {
    collect: {
      url: [
        `${baseUrl}/`,
        `${baseUrl}/#/build`,
        `${baseUrl}/#/set/75192-1`,
      ],
      ...(process.env.A11Y_BASE ? {} : {
        startServerCommand: 'node -e "process.env.PORT=\'4322\'; import(\'./e2e/serve.mjs\')"',
        startServerReadyPattern: 'http://localhost:4322',
        startServerReadyTimeout: 30000,
      }),
      numberOfRuns: 3,
      settings: {
        onlyCategories: ['accessibility', 'performance'],
        ...(sandboxFlags ? { chromeFlags: sandboxFlags } : {}),
      },
    },
    assert: {
      assertions: {
        'categories:accessibility': ['error', { minScore: 0.9 }],
        'categories:performance': ['warn', { minScore: 0.85 }],
        'largest-contentful-paint': ['warn', { maxNumericValue: 3000 }],
        'cumulative-layout-shift': ['error', { maxNumericValue: 0.1 }],
        'total-blocking-time': ['warn', { maxNumericValue: 300 }],
      },
    },
    upload: { target: 'temporary-public-storage' },
  },
};
