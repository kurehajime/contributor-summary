(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.ContributorSummary = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const apiVersion = "2022-11-28";
  const searchCap = 1000;
  const perPage = 100;

  function validateGitHubLogin(value, label = "user id") {
    if (!/^[A-Za-z0-9]([A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(value)) {
      throw new Error(`Invalid GitHub ${label}: ${value}`);
    }
  }

  function parseMonths(value) {
    const monthsText = String(value ?? "3").trim() || "3";
    if (!/^[0-9]+$/.test(monthsText) || monthsText === "0") {
      throw new Error("months must be a positive integer");
    }
    return Number(monthsText);
  }

  function monthsAgoDate(months, now = new Date()) {
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
    };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    if (typeof window === "undefined") {
      headers["User-Agent"] = "github-contributor-summary";
    }
    return headers;
  }

  async function githubGetJson(url, token, context, fetchImpl = globalThis.fetch) {
    if (typeof fetchImpl !== "function") {
      throw new Error("fetch is not available");
    }

    const response = await fetchImpl(url, { headers: githubHeaders(token) });
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

  async function listPublicOrganizations(user, token, options = {}) {
    const orgs = [];
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    for (let page = 1; ; page += 1) {
      const url = new URL(`https://api.github.com/users/${user}/orgs`);
      url.searchParams.set("per_page", String(perPage));
      url.searchParams.set("page", String(page));

      const pageOrgs = await githubGetJson(url, token, "listing public organizations", fetchImpl);
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

  async function searchItems(query, webSearchType, context, maxItems, token, options = {}) {
    const items = [];
    let totalCount = 0;
    let incompleteResults = false;
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;

    for (let page = 1; items.length < maxItems; page += 1) {
      const remaining = maxItems - items.length;
      const pageSize = Math.min(perPage, remaining);
      const url = new URL("https://api.github.com/search/issues");
      url.searchParams.set("q", query);
      url.searchParams.set("sort", "created");
      url.searchParams.set("order", "desc");
      url.searchParams.set("per_page", String(pageSize));
      url.searchParams.set("page", String(page));

      const body = await githubGetJson(url, token, context, fetchImpl);
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

  async function summarizeContributorActivity(options) {
    const user = String(options.user ?? "").trim();
    const months = parseMonths(options.months);
    const token = String(options.token ?? "").trim();
    const excludeSelf = options.excludeSelf ?? true;
    const excludeOrganizations = options.excludeOrganizations ?? true;
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    const now = options.now ?? new Date();
    const maxItems = options.maxItems ?? searchCap;

    validateGitHubLogin(user, "user id");

    const publicOrgs = excludeOrganizations ? await listPublicOrganizations(user, token, { fetchImpl }) : [];
    const since = monthsAgoDate(months, now);

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
    } = await searchItems(pullRequestQuery, "pullrequests", "searching pull requests", maxItems, token, { fetchImpl });
    const {
      items: rawIssueItems,
      totalCount: issueTotalCount,
      incompleteResults: issueIncompleteResults,
      githubSearchUrl: issueSearchUrl,
    } = await searchItems(issueQuery, "issues", "searching issues", maxItems, token, { fetchImpl });

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

    return {
      summary,
      summaryJson: JSON.stringify(summary, null, 2),
      summaryMarkdown: buildMarkdown(summary),
    };
  }

  return {
    apiVersion,
    searchCap,
    perPage,
    buildMarkdown,
    combineTopRepositories,
    githubSearchUrl,
    listPublicOrganizations,
    monthsAgoDate,
    parseMonths,
    pullRequestStatus,
    repoFromRepositoryUrl,
    searchItems,
    summarizeContributorActivity,
    summarizeIssues,
    summarizePullRequests,
    uniqueRepositoryCount,
    validateGitHubLogin,
  };
});
