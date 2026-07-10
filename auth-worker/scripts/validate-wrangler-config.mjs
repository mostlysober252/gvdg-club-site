import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Validates that the wrangler.toml section being deployed has no leftover REPLACE_WITH_* placeholder
// resource ids. It is ENV-AWARE: with no `--env`, only the top-level (default/production) config is
// checked; with `--env <name>`, only that [env.<name>] block is checked. Wrangler treats environments
// as independent Workers, so an unprovisioned staging env must not block a production deploy (or vice
// versa). `--allow-placeholders` bypasses the check (used by deploy:dry-run).

const args = process.argv.slice(2);
const allowPlaceholders = args.includes('--allow-placeholders');
const envIdx = args.indexOf('--env');
const env = envIdx !== -1 ? args[envIdx + 1] : null;

const config = readFileSync(resolve('wrangler.toml'), 'utf8');
const lines = config.split('\n');
const isEnvHeader = (l) => /^\s*\[\[?env\./.test(l);

function sectionFor(envName) {
  if (!envName) {
    // Top-level config = everything before the first [env.*] / [[env.*]] header.
    const end = lines.findIndex(isEnvHeader);
    return (end === -1 ? lines : lines.slice(0, end)).join('\n');
  }
  // The named env block: its first header through to the next DIFFERENT env header (or EOF).
  const headerRe = new RegExp(`^\\s*\\[\\[?env\\.${envName}[.\\]]`);
  const start = lines.findIndex((l) => headerRe.test(l));
  if (start === -1) {
    console.error(`validate-wrangler-config: no [env.${envName}] section found in wrangler.toml`);
    process.exit(1);
  }
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const m = lines[i].match(/^\s*\[\[?env\.([a-z0-9_-]+)[.\]]/i);
    if (m && m[1] !== envName) { end = i; break; }
  }
  return lines.slice(start, end).join('\n');
}

const placeholders = [...sectionFor(env).matchAll(/REPLACE_WITH_[A-Z0-9_]+/g)].map((m) => m[0]);

if (!allowPlaceholders && placeholders.length > 0) {
  const unique = [...new Set(placeholders)].sort();
  const where = env ? `[env.${env}]` : 'top-level config';
  console.error(`wrangler.toml ${where} still contains placeholder resource ids: ${unique.join(', ')}`);
  process.exit(1);
}
