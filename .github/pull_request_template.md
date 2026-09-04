<!--
The pull request TITLE becomes the commit message — merges are squashed.
It must be a Conventional Commit: feat(scope): what changed
See docs/CONVENTIONS.md section 2.
-->

## What this changes

<!-- One paragraph. What behaviour is different afterwards? -->

## Why

<!-- The problem being solved, not a restatement of the diff. -->

## How it was verified

<!-- Commands run, cases exercised, data it was tested against. -->

## Checklist

- [ ] Targets `integration`, not `main`
- [ ] Title is a valid Conventional Commit
- [ ] One concern only
- [ ] New source is in English
- [ ] Model changes include an Alembic revision, and I read what autogenerate produced
- [ ] Tests cover the change, or the reason they do not is stated above
- [ ] No `console.log`, `debugger`, or commented-out code
- [ ] Colours come from tokens; icons come from `frontend/src/ui/icons.ts`
