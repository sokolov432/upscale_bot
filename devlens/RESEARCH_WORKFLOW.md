# Fast investigation and private memory

For each CA the user asks about:

1. Run the private catalogue lookup before source queries. Reuse immutable
   creation/transfer transactions; refresh mutable metadata when needed. A saved
   answer is dated evidence, not a claim of a fresh full investigation.
2. Store creator, birth, direct funding, verified transfer paths, source-chain
   makers (including deBridge order IDs), X URL/profile snapshots and any actual
   available chart snapshots. Record time, source and coverage. Missing fields
   remain unknown. Never infer missing follower counts or create chart images.
3. Compare the new profile with the catalogue using `KnowledgeIndex`. Charts
   require matching known timeframes and remain a weak clue. A common exchange,
   bridge solver, copied bio/avatar or similar chart does not establish identity.
4. Prefer bulk full transactions and small independent batches over individual
   transaction RPC calls. Cover at least 14–30 days when following funding, and
   extend older when the observed chain leads there. Read post-launch cashouts.
5. Report the first defensible candidate promptly with CA and public sources;
   separate verified transfers from ownership hypotheses. Save findings before
   ending the turn, including negative searches and explicit coverage gaps.

Private catalogue: `research/token-memory.json`. It is compatible with version-1
browser memory backups. It is not automatically synchronized to a user's browser.
The extension stores its own private IndexedDB catalogue and sends bounded
comparison facts with requests to this conversation. Neither catalogue is copied
to the public website or extension distribution.

Charts in the extension are snapshots of readable chart canvases, including
same-origin chart iframes. Cross-origin or tainted canvases are unavailable;
no screenshot of the whole trading/account page is taken. Only two recent image
previews per token are retained, alongside up to 24 dated chart fingerprints.
X observations are collected only from opened profile pages matching a token
already known to the extension. Exact and abbreviated follower displays are
kept distinct; abbreviated counts remain unknown numerically. No hidden/private
X API is called, and social collection does not block the main investigation.
