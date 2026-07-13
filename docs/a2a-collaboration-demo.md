# Windows role in the A2A collaboration demo

The Mac `main` branch owns the sample CSV and the five-stage driver. This `windows` branch exposes `windows-agent` using `lfm2.5-thinking`.

For reliability, protocol file I/O is handled before inference instead of being delegated to the model. A deterministic A2A input processor saves every envelope file to the local workspace and byte-verifies it. It also injects the saved CSV for revision and verification stages.

Run `npm test`, `npm run demo:dry-run`, and `npm run build`, then start the server with `npm run dev`. Run `npm run demo:a2a` on the Mac. When Mac prints the collaboration ID, run:

```powershell
npm run demo:verify-workspace -- <collaboration-id>
```

This parses `received/<collaboration-id>/sales-data.csv` directly from the Windows local workspace and fails unless the dataset has the expected shape and total revenue. No DefraDB service is involved.
