<div align="center">

# 🐕 ShodanHound

### Hunt leaked Shodan API keys across public GitHub — and prove they're live.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%E2%89%A518-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Zero dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)](package.json)
[![Made for security research](https://img.shields.io/badge/purpose-security%20research-blue)](#-responsible-use)

*A single-file, zero-dependency recon tool that sweeps public repositories for
exposed Shodan API keys and validates each one against the Shodan API — so your
results contain only keys that actually work.*

</div>

---

## ✨ Why ShodanHound

Developers leak secrets. It happens every day — a hardcoded key in a commit, a
forgotten config in a public repo. **ShodanHound** automates the discovery and,
crucially, the **verification** step that most grep-and-pray scripts skip:

- 🔎 **Searches smart** — drives the GitHub Code Search API with a curated set of
  Shodan-specific patterns instead of one naive string.
- 🎯 **Scoped where keys leak** — searches `.py`, `.js`, `.ts`, `.json` and `.env`
  files, quoted or bare. Targeted scopes mean fewer downloads and a much faster
  sweep than a blind crawl.
- ✅ **Validates live** — every candidate is checked against `api.shodan.io`; only
  keys with real, usable credits make it to your output.
- 🧠 **Respects rate limits** — honours `Retry-After` / `X-RateLimit-Reset` headers
  with adaptive backoff, so it runs unattended without getting you throttled.
- 🪶 **Zero dependencies** — pure Node.js built-in `fetch`. No `npm install`, no
  supply-chain surface. One file, drop it anywhere.
- 🧹 **Deduplicates on the fly** — each key is checked exactly once per run.

---

## ⚙️ How it works

```
┌──────────────┐     ┌────────────────────┐     ┌───────────────────┐     ┌──────────────┐
│  keyword     │ ──▶ │  GitHub Code Search │ ──▶ │  fetch file, parse │ ──▶ │ Shodan API   │
│  patterns    │     │  (paginated, 100/pg)│     │  32-char candidate │     │ validate key │
└──────────────┘     └────────────────────┘     └───────────────────┘     └──────┬───────┘
                                                                                  │
                                                  credits ≥ 50 ?  ────────────────┘
                                                        │ yes
                                                        ▼
                                                   keys.out  ✅
```

1. Read patterns from `keywords/shodan.txt` (one query per line).
2. For each pattern, search GitHub Code Search scoped to the file types where
   keys leak — `.py`, `.js`, `.ts`, `.json`, `.env`.
3. Download each matching file and extract any isolated 32-character token near
   the keyword — quoted or bare.
4. Hit the Shodan `api-info` endpoint. If the key has **≥ 50 query credits**, it's
   real and useful → append it to your output file.

---

## 🚀 Quick start

**Requirements:** Node.js ≥ 18 and a GitHub personal access token (no scopes
needed — public code search only).

```bash
# clone
git clone https://github.com/damanoreshkan-beep/ShodanHound.git
cd ShodanHound

# run — pass your GitHub token and an output file
node shodanhound.mjs <github-token> keys.out
```

Using the [GitHub CLI](https://cli.github.com)? Skip the token juggling:

```bash
node shodanhound.mjs "$(gh auth token)" keys.out
```

> ⚠️ A full sweep takes a while — GitHub caps Code Search at ~10 requests/min, so
> ShodanHound deliberately paces itself.

### Example output

```
06.06.2026, 00:18:09 — query: 'language:python shodan_api_key='
  ✓ KEY FOUND: ******************************** (credits: 99, scans: 100)

Done. 1342 unique candidates checked. Results in keys.out
```

---

## 🧩 Customising the hunt

Patterns live in [`keywords/shodan.txt`](keywords/shodan.txt) — one search string
per line, no spaces. Add your own to widen the net:

```
shodan_api_key=
api_shodan_key=
shodankey=
sd=shodan(
```

Point ShodanHound at more keyword files by editing the `KEYWORD_FILES` array at
the top of `shodanhound.mjs`. Each pattern is searched across every scope in the
`SCOPES` array (`.py`, `.js`, `.ts`, `.json`, `.env` by default) — add or remove
scopes there to tune coverage vs. speed.

---

## 🛡️ Responsible use

ShodanHound is built for **defensive security research, bug bounty, and
responsible disclosure** — for example, finding *your own* organisation's leaked
keys before an attacker does.

- ✅ Audit your own / authorised infrastructure.
- ✅ Report discovered keys to their owners and to Shodan so they can be rotated.
- ❌ **Never** use, sell, or store third-party keys you are not authorised to access.

Discovered credentials are live secrets. Treat them as toxic: report and discard.
The output file is git-ignored by default so you never publish what you find.
You are responsible for complying with all applicable laws and the terms of
service of GitHub and Shodan.

---

## 📜 License

[MIT](LICENSE) © 2026

<div align="center">

**If ShodanHound saved you from a leak, drop a ⭐ — it helps others find it.**

</div>
