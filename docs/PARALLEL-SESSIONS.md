# Working in parallel sessions

One worktree per stream of work, each a full checkout of its own branch with
its own database, its own ports and its own Claude Code session. Nothing is
shared but the git history, so two sessions can run all day without touching
each other's files, ports or data.

The ownership map (docs/SPEC/OWNERSHIP.md) decides what each worktree may
edit and which migration numbers it may use. That map is what makes parallel
work safe; this file is only the mechanics.

## Opening one

From the trunk checkout:

```bash
pnpm worktree:add client-record
```

That creates `../mcwellness-client-record` on a new branch of the same name,
writes its `.env` with the ports from the ownership table, installs its
dependencies, starts its own database, applies the migrations and seeds the
synthetic practice. It prints the directory when it is done.

Then open a Claude Code session in that directory. It is an ordinary
checkout: `pnpm dev`, `pnpm verify`, `pnpm test:db` all work the same way,
on that worktree's own ports.

## What each worktree gets

- **Its own branch**, named after the worktree, branched from `main`.
- **Its own database**, a separate container and volume, on its own port. A
  reset or a reseed in one worktree cannot touch another's data.
- **Its own ports** for the API and the web server, so several `pnpm dev`
  runs coexist. The proxy in each worktree points at its own API.
- **Its own `node_modules`**, because a worktree is a separate directory.

## Closing one

When its pull request is merged:

```bash
pnpm worktree:remove client-record
```

That stops and removes its database (its volume goes with it), removes the
worktree directory and prunes the branch registration. The branch itself
stays in git history through the merge.

## Rules that matter more than the mechanics

1. **Edit only what your worktree owns.** A bug elsewhere is a change
   request, not a fix in passing (OWNERSHIP.md rule 1).
2. **Use your own migration range.** Never renumber someone else's.
3. **Rebase on `main` before opening a pull request.** A rebase conflict
   means the ownership map is wrong; fix the map first.
4. **One pull request per worktree per day, small.** Both reviewers run.
5. **Staging is for integration after merge only.** A worktree never points
   at staging or production; its database is local and synthetic.
