# GitHub Contributor Summary

GitHub Action that summarizes a GitHub user's recent public pull request and issue activity across repositories they do not own.

## Usage

```yaml
name: Contributor Summary

on:
  pull_request_target:
    types: [opened]

permissions:
  contents: read
  pull-requests: write

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - name: Skip repository owner and public org members
        id: internal
        env:
          GH_TOKEN: ${{ github.token }}
          PR_AUTHOR: ${{ github.event.pull_request.user.login }}
          REPO_OWNER: ${{ github.repository_owner }}
        run: |
          if [ "$PR_AUTHOR" = "$REPO_OWNER" ]; then
            echo "value=true" >> "$GITHUB_OUTPUT"
            exit 0
          fi

          if gh api "/orgs/$REPO_OWNER/public_members/$PR_AUTHOR" >/dev/null 2>&1; then
            echo "value=true" >> "$GITHUB_OUTPUT"
          else
            echo "value=false" >> "$GITHUB_OUTPUT"
          fi

      - id: contributor-summary
        if: steps.internal.outputs.value != 'true'
        uses: kurehajime/contributor-summary@v1
        with:
          github-user: ${{ github.event.pull_request.user.login }}
          months: "12"
          github-token: ${{ github.token }}

      - name: Comment audit summary
        if: steps.internal.outputs.value != 'true'
        env:
          GH_TOKEN: ${{ github.token }}
          PR_URL: ${{ github.event.pull_request.html_url }}
          SUMMARY_MARKDOWN: ${{ steps.contributor-summary.outputs.summary-markdown }}
        run: |
          body_file="$(mktemp)"
          printf '%s\n' "$SUMMARY_MARKDOWN" >"$body_file"
          gh pr comment "$PR_URL" --body-file "$body_file"
```

## Inputs

- `github-user`: GitHub user ID to audit. Required.
- `months`: Number of past months to scan. Default: `3`.
- `exclude-self`: Exclude repositories owned by the audited user. Default: `true`.
- `exclude-organizations`: Exclude repositories owned by public organizations that the audited user belongs to. Default: `true`.
- `github-token`: Optional GitHub token for API requests. Omit to use unauthenticated public API requests.

## Outputs

- `pull-request-search-url`
- `issue-search-url`
- `unique-repository-count`
- `opened-count`
- `opened-pull-request-count`
- `opened-issue-count`
- `merged-pull-request-count`
- `closed-unmerged-pull-request-count`
- `pull-request-rejection-rate`
- `closed-issue-count`
- `open-pull-request-count`
- `open-issue-count`
- `summary-json`
- `summary-markdown`

GitHub Search API results are capped at the first 1,000 matches.
