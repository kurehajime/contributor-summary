const fs = require("node:fs");
const os = require("node:os");
const { summarizeContributorActivity } = require("./core");

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

function setSummaryOutputs(summary, summaryJson, summaryMarkdown) {
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
}

async function main() {
  const { summary, summaryJson, summaryMarkdown } = await summarizeContributorActivity({
    user: getInput("github-user", { required: true }),
    months: getInput("months") || "3",
    token: getInput("github-token"),
    excludeSelf: getBooleanInput("exclude-self", "true"),
    excludeOrganizations: getBooleanInput("exclude-organizations", "true"),
  });

  setSummaryOutputs(summary, summaryJson, summaryMarkdown);
  addStepSummary(summaryMarkdown);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
