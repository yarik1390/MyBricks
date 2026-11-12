// Entry point for .github/workflows/scan-vector-eval.yml.
import { mkdirSync } from 'node:fs';
import { runEval } from './run-eval.mjs';

const OUT = 'scan-eval-out';
mkdirSync(OUT, { recursive: true });
await runEval({ OUT });
