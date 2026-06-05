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
const KEYWORD_FILES = ['keywords/shodan-python.txt'];

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

function extractCandidates(content, keyword) {
  // Find `keyword"..."` or `keyword'...'` where the quoted value is 32 chars.
  const out = [];
  for (const original of content.split('\n')) {
    const line = original.trim().toLowerCase().replace(/ /g, '');
    let quote = null;
    if (line.includes(keyword + '"')) quote = '"';
    else if (line.includes(keyword + "'")) quote = "'";
    if (!quote) continue;
    const parts = original.split(quote);
    if (parts[1] && parts[1].length === 32) out.push(parts[1]);
  }
  return out;
}

async function searchKeyword(token, outFile, keyword, language) {
  const q = `${language}${keyword}`;
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
    const language = file.includes('python') ? 'language:python ' : '';
    const keywords = (await readFile(file, 'utf-8'))
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    for (const keyword of keywords) {
      await searchKeyword(token, outFile, keyword, language);
    }
  }

  console.log(`\nDone. ${seen.size} unique candidates checked. Results in ${outFile}`);
}

main().catch((e) => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
