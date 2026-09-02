# Start here (owner)

You are non-technical and solo. This folder is the brief. Claude Code is the builder. Follow these steps in order.

## Before opening Claude Code (about one day)
1. Create an empty GitHub repository called `mcwellness`. Clone it to your computer.
2. Copy everything in this folder into that clone (including the hidden `.claude`, `.gitignore`, `.worktreeinclude`, `.env.example`). Commit and push: "chore: starter brief".
3. Create a Supabase Cloud project. This is STAGING — synthetic data only. Note the URL and keys.
4. Install Docker Desktop. Install Claude Code in the Claude desktop app.
5. Copy `.env.example` to `.env` and fill in the Supabase staging values. Never put anything from production in this file.

## First Claude Code session
7. Open Claude Code in the `mcwellness` folder. Run it once to accept the trust prompt.
8. Paste the contents of `KICKOFF-PROMPT.md`.
9. Read the plan it gives you. If something is unclear, ask it to explain in plain language. Approve.
10. Let it build PR 1. When it says done, look at what changed. If a hook blocked something, that is the hook working — read the message.
11. Merge PR 1. Repeat for PRs 2–6. One PR at a time. Do not skip the review agents.

## When the trunk exit test passes
12. Tag `trunk-v1`. Come back to the planning project — we open the four Stage 1 worktrees next.

## Rules for you
- If you can screenshot your screen and post it publicly, you're in staging. If you can't, close the session.
- Never paste a real client's details into Claude Code, ever.
- One PR at a time. Small is fast.
- When lost, ask Claude Code: "explain what you just did and why, as if to a non-developer."
