# kurehajime/contributor-summary

<img width="2220" height="1464" alt="head" src="https://github.com/user-attachments/assets/0a264691-d02c-4de8-8d97-39dbee45e570" />



`kurehajime/contributor-summary` is a GitHub Action that summarizes a user's recent public pull request and issue activity across external repositories.

It is useful when you want a quick, linkable contribution history for a pull request author, especially for first-time or external contributors.

## What It Reports

The action searches public GitHub pull requests and issues authored by the target user in a recent time window. By default, it excludes repositories owned by the user and public organizations the user belongs to.

The generated summary includes:

- total opened pull requests and issues
- unique repositories touched
- merged pull request count
- closed-without-merge pull request count
- pull request rejection rate
- open pull request and issue count
- top repositories by contribution count
- GitHub search links for the underlying result sets
- machine-readable JSON and ready-to-post Markdown

Only public GitHub activity is included.

## Usage

Add the action to a workflow and pass the GitHub login you want to summarize.

```yaml
name: Contributor Summary

on:
  workflow_dispatch:
    inputs:
      github-user:
        description: GitHub user ID to summarize
        required: true
        type: string

permissions:
  contents: read

jobs:
  summarize:
    runs-on: ubuntu-latest
    steps:
      - name: Summarize contributor activity
        id: contributor-summary
        uses: kurehajime/contributor-summary@v1
        with:
          github-user: ${{ inputs['github-user'] }}
          months: "12"
          github-token: ${{ github.token }}

      - name: Print summary
        env:
          SUMMARY_MARKDOWN: ${{ steps.contributor-summary.outputs.summary-markdown }}
        run: |
          printf '%s\n' "$SUMMARY_MARKDOWN"
```

## Pull Request Comment Example

This example comments on newly opened pull requests from external contributors. It skips the repository owner and public organization members before running the summary.

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

      - name: Summarize contributor activity
        id: contributor-summary
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

| Name | Required | Default | Description |
| --- | --- | --- | --- |
| `github-user` | Yes | | GitHub user ID to audit. |
| `months` | No | `3` | Number of past months to scan. Must be a positive integer. |
| `exclude-self` | No | `true` | Exclude repositories owned by the audited user. |
| `exclude-organizations` | No | `true` | Exclude repositories owned by public organizations that the audited user belongs to. |
| `github-token` | No | | GitHub token for API requests. If omitted, the action uses unauthenticated public API requests. |

Use `github-token: ${{ github.token }}` to avoid low unauthenticated rate limits.

## Outputs

| Name | Description |
| --- | --- |
| `pull-request-search-url` | GitHub web search URL for the pull request query. |
| `issue-search-url` | GitHub web search URL for the issue query. |
| `unique-repository-count` | Number of unique repositories that received matching pull requests or issues. |
| `opened-count` | Number of pull requests and issues opened in the scanned window. |
| `opened-pull-request-count` | Number of pull requests opened in the scanned window. |
| `opened-issue-count` | Number of issues opened in the scanned window. |
| `merged-pull-request-count` | Number of pull requests merged in the scanned window. |
| `closed-unmerged-pull-request-count` | Number of pull requests closed without merge in the scanned window. |
| `pull-request-rejection-rate` | Pull request rejection rate, calculated as closed without merge divided by opened pull requests. |
| `closed-issue-count` | Number of issues closed in the scanned window. |
| `open-pull-request-count` | Number of pull requests that are still open. |
| `open-issue-count` | Number of issues that are still open. |
| `summary-json` | Full summary as a formatted JSON string. |
| `summary-markdown` | Ready-to-post Markdown summary. The same content is also appended to the workflow step summary. |

## Summary JSON

The `summary-json` output contains the input context, search queries, aggregate counts, top repositories, monthly trends, and recent pull requests and issues.

Top-level fields include:

- `user`
- `months`
- `since`
- `exclude_self`
- `exclude_organizations`
- `excluded_public_orgs`
- `opened_count`
- `unique_repository_count`
- `top_repositories`
- `pull_requests`
- `issues`

## Notes and Limitations

- GitHub Search API results are capped at the first 1,000 matches for pull requests and the first 1,000 matches for issues.
- The action uses public GitHub search, so private repository activity is not included.
