# Keyword files

Each file holds search patterns for ShodanHound — **one query per line, no spaces**.

Searches run with **no language filter**, so every pattern sweeps all file types
on GitHub at once (`.py`, `.env`, `.php`, `.js`, YAML, config…). Add more `.txt`
files here and register them in the `KEYWORD_FILES` array at the top of
`shodanhound.mjs`.
