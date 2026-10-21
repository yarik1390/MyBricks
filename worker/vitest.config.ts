import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

// Quiet Wrangler's log output during test runs. On Windows the pool's Wrangler
// child otherwise tries to write rotating log files and spams permission noise;
// `none` keeps `vitest run` output clean cross-platform. Respect an explicit
// override so a developer can still raise the level when debugging the pool.
process.env.WRANGLER_LOG ||= 'none';

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: {
        configPath: './wrangler.toml',
      },
      // The OPENCODEX_VPC (Workers VPC) binding is remote-only. Tests stub it, and
      // a remote proxy session would need live Cloudflare credentials in CI.
      remoteBindings: false,
    }),
  ],
});

