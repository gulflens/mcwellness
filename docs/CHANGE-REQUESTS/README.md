# Change requests to the shared zone
A worktree that needs a change to core schema, `domain/shared`, `app/shell`, `CLAUDE.md` or `.claude/**` writes `<worktree>-NN.md` here with: what, why, proposed diff, which spec section requires it. Then stops dependent work. The integrator applies on `main`; all worktrees rebase.
