# action-release-version

GitHub Action to calculate the next semantic version from commit history.

Supports `push` and `pull_request` contexts.

## Inputs

- `tag-prefix` (optional, default: `""`)
  - Prefix for git tags, e.g. `v` for tags like `v0.3.7`.
- `working-directory` (optional, default: `.`)
  - Directory where git commands should run.
  - If this points to a subdirectory inside the repository, only commits that touched this subpath are considered.

## Outputs

- `next-version`: version without prefix, e.g. `0.4.0`
- `next-tag`: version with prefix, e.g. `v0.4.0`
- `bump-type`: one of `major`, `minor`, `patch`
- `commit-count`: number of commits evaluated

## Bump rules

- `feat:` -> `minor` (x.Y.0)
- any other conventional commit type (e.g. `chore:`, `fix:`) -> `patch` (x.y.Z)
- non-conventional commit messages -> `patch` (never fails because of message format)
- `!` or `BREAKING CHANGE:` -> `major`

## Example workflow

```yaml
name: Release version calc

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  version:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Calculate next version
        id: version
        uses: ./
        with:
          tag-prefix: v
          working-directory: .

      - name: Show
        run: |
          echo "next-version=${{ steps.version.outputs.next-version }}"
          echo "next-tag=${{ steps.version.outputs.next-tag }}"
          echo "bump-type=${{ steps.version.outputs.bump-type }}"
          echo "commit-count=${{ steps.version.outputs.commit-count }}"
```

## Notes

- For correct tag and history detection, use `fetch-depth: 0` in checkout.
- The action intentionally does not implement prerelease semantics.
