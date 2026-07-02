const fs = require("node:fs");
const os = require("node:os");

const apiVersion = "2022-11-28";
const searchCap = 1000;
const perPage = 100;

function inputNames(name) {
  const actionsName = `INPUT_${name.replace(/ /g, "_").toUpperCase()}`;
  const shellFriendlyName = `INPUT_${name.replace(/ /g, "_").replace(/-/g, "_").toUpperCase()}`;
  return actionsName === shellFriendlyName ? [actionsName] : [actionsName, shellFriendlyName];
}

function getInput(name, options = {}) {
  const value = inputNames(name)
    .map((envName) => process.env[envName])
    .find((envValue) => envValue != null)
    ?.trim() ?? "";
  if (options.required && value === "") {
    throw new Error(`Input required and not supplied: ${name}`);
  }
  return value;
}

function getBooleanInput(name, defaultValue) {
  const value = getInput(name) || defaultValue;
  if (value !== "true" && value !== "false") {
    throw new Error(`${name} must be true or false`);
  }
  return value === "true";
}

function setOutput(name, value) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) {
    console.log(`${name}=${value}`);
    return;
  }

  const stringValue = String(value);
  if (stringValue.includes("\n")) {
    const delimiter = `contributor_summary_${name.replace(/[^A-Za-z0-9_]/g, "_")}_${Date.now()}`;
    fs.appendFileSync(outputPath, `${name}<<${delimiter}${os.EOL}${stringValue}${os.EOL}${delimiter}${os.EOL}`);
  } else {
    fs.appendFileSync(outputPath, `${name}=${stringValue}${os.EOL}`);
  }
}

function addStepSummary(markdown) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    fs.appendFileSync(summaryPath, markdown);
  }
}

function validateGitHubLogin(value, label) {
  if (!/^[A-Za-z0-9]([A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(value)) {
    throw new Error(`Invalid GitHub ${label}: ${value}`);
  }
}

function monthsAgoDate(months) {
  const now = new Date();
  const targetMonthIndex = now.getUTCMonth() - months;
  const targetYear = now.getUTCFullYear() + Math.floor(targetMonthIndex / 12);
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12;
  const daysInTargetMonth = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const targetDay = Math.min(now.getUTCDate(), daysInTargetMonth);
  const date = new Date(Date.UTC(targetYear, targetMonth, targetDay));
  return date.toISOString().slice(0, 10);
}

function githubHeaders(token) {
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": apiVersion,
    "User-Agent": "github-contributor-summary",
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

async function githubGetJson(url, token, context) {
  const response = await fetch(url, { headers: githubHeaders(token) });
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  if (!response.ok) {
    const message = typeof body === "object" && body?.message ? body.message : text;
    const reset = response.headers.get("x-ratelimit-reset");
    const remaining = response.headers.get("x-ratelimit-remaining");
    const details = [
      `GitHub API request failed while ${context}: HTTP ${response.status}`,
      message ? `message: ${message}` : "",
      remaining ? `rate limit remaining: ${remaining}` : "",
      reset ? `rate limit reset epoch: ${reset}` : "",
    ].filter(Boolean);
    throw new Error(details.join("\n"));
  }

  return body;
}

async function listPublicOrganizations(user, token) {
  const orgs = [];
  for (let page = 1; ; page += 1) {
    const url = new URL(`https://api.github.com/users/${user}/orgs`);
    url.searchParams.set("per_page", String(perPage));
    url.searchParams.set("page", String(page));

    const pageOrgs = await githubGetJson(url, token, "listing public organizations");
    for (const org of pageOrgs) {
      orgs.push(org.login);
    }
    if (pageOrgs.length < perPage) {
      return orgs;
    }
  }
}

function ownerFromRepositoryUrl(repositoryUrl) {
  return repositoryUrl.replace("https://api.github.com/repos/", "").split("/")[0];
}

function repoFromRepositoryUrl(repositoryUrl) {
  return repositoryUrl.replace("https://api.github.com/repos/", "");
}

function pullRequestStatus(item) {
  if (item.state === "open") {
    return "open";
  }
  return item.pull_request?.merged_at ? "merged" : "closed";
}

function sortTopRepositories(repoMap) {
  return [...repoMap.values()]
    .sort((a, b) => b.total - a.total || a.repo.localeCompare(b.repo))
    .slice(0, 15);
}

function summarizePullRequests(items) {
  const uniqueRepos = new Set(items.map((item) => repoFromRepositoryUrl(item.repository_url)));
  const merged = items.filter((item) => item.state === "closed" && item.pull_request?.merged_at).length;
  const open = items.filter((item) => item.state === "open").length;
  const closedUnmerged = items.filter((item) => item.state === "closed" && !item.pull_request?.merged_at).length;
  const rejectionRate = items.length === 0 ? 0 : closedUnmerged / items.length;

  const repoMap = new Map();
  for (const item of items) {
    const repo = repoFromRepositoryUrl(item.repository_url);
    const current = repoMap.get(repo) ?? { repo, total: 0, open: 0, merged: 0, closed_unmerged: 0 };
    current.total += 1;
    const status = pullRequestStatus(item);
    if (status === "open") {
      current.open += 1;
    } else if (status === "merged") {
      current.merged += 1;
    } else {
      current.closed_unmerged += 1;
    }
    repoMap.set(repo, current);
  }

  const monthMap = new Map();
  for (const item of items) {
    const month = item.created_at.slice(0, 7);
    monthMap.set(month, (monthMap.get(month) ?? 0) + 1);
  }
  const monthlyTrend = [...monthMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, total]) => ({ month, total }));

  const recentPullRequests = items.slice(0, 20).map((item) => ({
    created_at: item.created_at,
    date: item.created_at.slice(0, 10),
    status: pullRequestStatus(item),
    repo: repoFromRepositoryUrl(item.repository_url),
    number: item.number,
    title: item.title,
    url: item.html_url,
  }));

  return {
    unique_repository_count: uniqueRepos.size,
    opened_count: items.length,
    merged_count: merged,
    closed_unmerged_count: closedUnmerged,
    rejection_rate: rejectionRate,
    open_count: open,
    top_repositories: sortTopRepositories(repoMap),
    monthly_trend: monthlyTrend,
    recent_pull_requests: recentPullRequests,
  };
}

function summarizeIssues(items) {
  const uniqueRepos = new Set(items.map((item) => repoFromRepositoryUrl(item.repository_url)));
  const open = items.filter((item) => item.state === "open").length;
  const closed = items.filter((item) => item.state === "closed").length;

  const repoMap = new Map();
  for (const item of items) {
    const repo = repoFromRepositoryUrl(item.repository_url);
    const current = repoMap.get(repo) ?? { repo, total: 0, open: 0, closed: 0 };
    current.total += 1;
    if (item.state === "open") {
      current.open += 1;
    } else {
      current.closed += 1;
    }
    repoMap.set(repo, current);
  }

  const monthMap = new Map();
  for (const item of items) {
    const month = item.created_at.slice(0, 7);
    monthMap.set(month, (monthMap.get(month) ?? 0) + 1);
  }
  const monthlyTrend = [...monthMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, total]) => ({ month, total }));

  const recentIssues = items.slice(0, 20).map((item) => ({
    created_at: item.created_at,
    date: item.created_at.slice(0, 10),
    status: item.state,
    repo: repoFromRepositoryUrl(item.repository_url),
    number: item.number,
    title: item.title,
    url: item.html_url,
  }));

  return {
    unique_repository_count: uniqueRepos.size,
    opened_count: items.length,
    closed_count: closed,
    open_count: open,
    top_repositories: sortTopRepositories(repoMap),
    monthly_trend: monthlyTrend,
    recent_issues: recentIssues,
  };
}

function combineTopRepositories(pullRequestItems, issueItems) {
  const repoMap = new Map();
  for (const item of pullRequestItems) {
    const repo = repoFromRepositoryUrl(item.repository_url);
    const current = repoMap.get(repo) ?? { repo, total: 0, pull_requests: 0, issues: 0 };
    current.total += 1;
    current.pull_requests += 1;
    repoMap.set(repo, current);
  }
  for (const item of issueItems) {
    const repo = repoFromRepositoryUrl(item.repository_url);
    const current = repoMap.get(repo) ?? { repo, total: 0, pull_requests: 0, issues: 0 };
    current.total += 1;
    current.issues += 1;
    repoMap.set(repo, current);
  }
  return sortTopRepositories(repoMap);
}

function uniqueRepositoryCount(...itemLists) {
  const repos = new Set();
  for (const items of itemLists) {
    for (const item of items) {
      repos.add(repoFromRepositoryUrl(item.repository_url));
    }
  }
  return repos.size;
}

function githubSearchUrl(query, webSearchType) {
  return `https://github.com/search?q=${encodeURIComponent(query)}&type=${webSearchType}&s=created&o=desc`;
}

async function searchItems(query, webSearchType, context, maxItems, token) {
  const items = [];
  let totalCount = 0;
  let incompleteResults = false;

  for (let page = 1; items.length < maxItems; page += 1) {
    const remaining = maxItems - items.length;
    const pageSize = Math.min(perPage, remaining);
    const url = new URL("https://api.github.com/search/issues");
    url.searchParams.set("q", query);
    url.searchParams.set("sort", "created");
    url.searchParams.set("order", "desc");
    url.searchParams.set("per_page", String(pageSize));
    url.searchParams.set("page", String(page));

    const body = await githubGetJson(url, token, context);
    if (page === 1) {
      totalCount = body.total_count;
      incompleteResults = body.incomplete_results;
    }
    if (body.items.length === 0) {
      break;
    }
    items.push(...body.items);
    if (body.items.length < pageSize) {
      break;
    }
  }

  return {
    items,
    totalCount,
    incompleteResults,
    githubSearchUrl: githubSearchUrl(query, webSearchType),
  };
}

function buildMarkdown(summary) {
  const pullRequests = summary.pull_requests;
  const issues = summary.issues;
  const pullRequestMetricUrl = (qualifiers = []) => githubSearchUrl([pullRequests.query, ...qualifiers].join(" "), "pullrequests");
  const issueMetricUrl = (qualifiers = []) => githubSearchUrl([issues.query, ...qualifiers].join(" "), "issues");
  const rejectionRate = `${(pullRequests.rejection_rate * 100).toFixed(1)}%`;
  const lines = [
    "# Contributor Summary",
    "",
    `User: ${summary.user}`,
    `Public organization memberships: ${
      summary.exclude_organizations
        ? summary.excluded_public_orgs.length > 0
          ? summary.excluded_public_orgs.join(", ")
          : "none"
        : "not checked"
    }`,
    "",
    `## last ${summary.months} month(s) Contributions`,
    "",
    `Exclusions: user-owned repositories ${summary.exclude_self ? "excluded" : "included"}, repositories owned by public organizations the audited user belongs to ${summary.exclude_organizations ? "excluded" : "included"}`,
    "",
    "### Pull requests",
    "",
    "Metric | Count",
    "-- | --:",
    `Unique repositories | ${pullRequests.unique_repository_count}`,
    `[Opened](${pullRequests.github_search_url}) | ${pullRequests.opened_count}`,
    `[Merged](${pullRequestMetricUrl(["is:merged"])}) | ${pullRequests.merged_count}`,
    `[Closed without merge](${pullRequestMetricUrl(["is:closed", "is:unmerged"])}) | ${pullRequests.closed_unmerged_count}`,
    `[Rejection rate](${pullRequestMetricUrl(["is:closed", "is:unmerged"])}) | ${rejectionRate}`,
    `[In progress](${pullRequestMetricUrl(["is:open"])}) | ${pullRequests.open_count}`,
    "",
    "### Issues",
    "",
    "Metric | Count",
    "-- | --:",
    `Unique repositories | ${issues.unique_repository_count}`,
    `[Opened](${issues.github_search_url}) | ${issues.opened_count}`,
    `[Closed](${issueMetricUrl(["is:closed"])}) | ${issues.closed_count}`,
    `[In progress](${issueMetricUrl(["is:open"])}) | ${issues.open_count}`,
  ];

  if (pullRequests.incomplete_results || issues.incomplete_results) {
    lines.push("Warning: GitHub reported incomplete search results.");
  }
  if (pullRequests.total_matches > searchCap || issues.total_matches > searchCap) {
    lines.push(`Warning: GitHub Search API exposes only the first ${searchCap} results.`);
  }

  lines.push("");

  if (summary.opened_count === 0) {
    lines.push("No matching contributions found.");
    return lines.join("\n");
  }

  lines.push("### Top repositories");
  for (const repo of summary.top_repositories) {
    const pullRequestUrl = githubSearchUrl(
      ["type:pr", "is:public", `author:${summary.user}`, `repo:${repo.repo}`, `created:>=${summary.since}`].join(" "),
      "pullrequests",
    );
    const issueUrl = githubSearchUrl(
      ["type:issue", "is:public", `author:${summary.user}`, `repo:${repo.repo}`, `created:>=${summary.since}`].join(" "),
      "issues",
    );
    lines.push(`- [${repo.repo}](https://github.com/${repo.repo}) : ${repo.total} contributions ([${repo.pull_requests} PRs](${pullRequestUrl}), [${repo.issues} issues](${issueUrl}))`);
  }

  return lines.join("\n");
}

async function main() {
  const user = getInput("github-user", { required: true });
  const monthsText = getInput("months") || "3";
  const token = getInput("github-token");
  const excludeSelf = getBooleanInput("exclude-self", "true");
  const excludeOrganizations = getBooleanInput("exclude-organizations", "true");

  validateGitHubLogin(user, "user id");

  if (!/^[0-9]+$/.test(monthsText) || monthsText === "0") {
    throw new Error("months must be a positive integer");
  }
  const months = Number(monthsText);

  const publicOrgs = excludeOrganizations ? await listPublicOrganizations(user, token) : [];
  const since = monthsAgoDate(months);

  const baseQueryParts = ["is:public", `author:${user}`];
  const excludedOwners = new Set();
  if (excludeSelf) {
    baseQueryParts.push(`-user:${user}`);
    excludedOwners.add(user.toLowerCase());
  }
  if (excludeOrganizations) {
    for (const org of publicOrgs) {
      baseQueryParts.push(`-user:${org}`);
      excludedOwners.add(org.toLowerCase());
    }
  }
  baseQueryParts.push(`created:>=${since}`);
  const pullRequestQuery = ["type:pr", ...baseQueryParts].join(" ");
  const issueQuery = ["type:issue", ...baseQueryParts].join(" ");

  const {
    items: rawPullRequestItems,
    totalCount: pullRequestTotalCount,
    incompleteResults: pullRequestIncompleteResults,
    githubSearchUrl: pullRequestSearchUrl,
  } = await searchItems(pullRequestQuery, "pullrequests", "searching pull requests", searchCap, token);
  const {
    items: rawIssueItems,
    totalCount: issueTotalCount,
    incompleteResults: issueIncompleteResults,
    githubSearchUrl: issueSearchUrl,
  } = await searchItems(issueQuery, "issues", "searching issues", searchCap, token);

  const pullRequestItems = excludedOwners.size === 0
    ? rawPullRequestItems
    : rawPullRequestItems.filter((item) => !excludedOwners.has(ownerFromRepositoryUrl(item.repository_url).toLowerCase()));
  const issueItems = excludedOwners.size === 0
    ? rawIssueItems
    : rawIssueItems.filter((item) => !excludedOwners.has(ownerFromRepositoryUrl(item.repository_url).toLowerCase()));

  const pullRequests = summarizePullRequests(pullRequestItems);
  const issues = summarizeIssues(issueItems);
  const summary = {
    user,
    months,
    since,
    exclude_self: excludeSelf,
    exclude_organizations: excludeOrganizations,
    excluded_public_orgs: publicOrgs,
    opened_count: pullRequests.opened_count + issues.opened_count,
    unique_repository_count: uniqueRepositoryCount(pullRequestItems, issueItems),
    top_repositories: combineTopRepositories(pullRequestItems, issueItems),
    pull_requests: {
      query: pullRequestQuery,
      github_search_url: pullRequestSearchUrl,
      total_matches: pullRequestTotalCount,
      fetched: pullRequests.opened_count,
      incomplete_results: pullRequestIncompleteResults,
      ...pullRequests,
    },
    issues: {
      query: issueQuery,
      github_search_url: issueSearchUrl,
      total_matches: issueTotalCount,
      fetched: issues.opened_count,
      incomplete_results: issueIncompleteResults,
      ...issues,
    },
  };
  const summaryJson = JSON.stringify(summary, null, 2);
  const summaryMarkdown = buildMarkdown(summary);

  setOutput("pull-request-search-url", summary.pull_requests.github_search_url);
  setOutput("issue-search-url", summary.issues.github_search_url);
  setOutput("unique-repository-count", summary.unique_repository_count);
  setOutput("opened-count", summary.opened_count);
  setOutput("opened-pull-request-count", summary.pull_requests.opened_count);
  setOutput("opened-issue-count", summary.issues.opened_count);
  setOutput("merged-pull-request-count", summary.pull_requests.merged_count);
  setOutput("closed-unmerged-pull-request-count", summary.pull_requests.closed_unmerged_count);
  setOutput("pull-request-rejection-rate", summary.pull_requests.rejection_rate);
  setOutput("closed-issue-count", summary.issues.closed_count);
  setOutput("open-pull-request-count", summary.pull_requests.open_count);
  setOutput("open-issue-count", summary.issues.open_count);
  setOutput("summary-json", summaryJson);
  setOutput("summary-markdown", summaryMarkdown);
  addStepSummary(summaryMarkdown);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
