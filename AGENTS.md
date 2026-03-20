# AGENTS.md

## Project
This repository is **RedCode**: a Tauri 2.x + React 18 + TypeScript desktop IDE for authorised offensive security, red team, and penetration testing workflows.

Core stack:
- Tauri 2.x
- React 18
- TypeScript
- SQLite
- xterm.js

Primary workspaces:
- Recon
- Exploit
- Reporting
- Scope
- Evidence
- Settings
- Terminal

## Operating rules
When making changes in this repository:

1. Prefer small, contained edits over broad refactors.
2. Preserve existing architecture and naming unless there is a strong reason to change them.
3. Do not invent features outside the requested scope.
4. Keep all security-related behaviour aligned to authorised, scope-bound workflows only.
5. Do not add destructive, stealth, persistence, phishing, credential theft, or unauthorised access functionality.
6. Keep changes production-minded and maintainable.

## Validation workflow
After every meaningful code change, do not stop at editing files. Validate the change in this order:

1. Run linting.
2. Run tests.
3. Run a Rust/Tauri compile check.
4. Run a debug build if needed.
5. Run the Tauri development app.
6. Report results clearly.
7. Do not claim success purely because the app starts.

### Required commands
Run the following where relevant:

```bash
pnpm lint
pnpm test
cargo check
pnpm tauri build --debug
pnpm tauri dev