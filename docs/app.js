const form = document.querySelector("#summary-form");
const runButton = document.querySelector("#run-button");
const statusBox = document.querySelector("#status");
const results = document.querySelector("#results");
const markdownPreview = document.querySelector("#markdown-preview");
const copyButton = document.querySelector("#copy-markdown");
let currentMarkdown = "";

function setStatus(message, tone = "neutral") {
  statusBox.textContent = message;
  statusBox.dataset.tone = tone;
}

function appendInlineMarkdown(parent, text) {
  const linkPattern = /\[([^\]]+)\]\(([^)]+)\)/g;
  let lastIndex = 0;
  let match;

  while ((match = linkPattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parent.append(document.createTextNode(text.slice(lastIndex, match.index)));
    }

    const link = document.createElement("a");
    link.href = match[2];
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = match[1];
    parent.append(link);
    lastIndex = linkPattern.lastIndex;
  }

  if (lastIndex < text.length) {
    parent.append(document.createTextNode(text.slice(lastIndex)));
  }
}

function appendParagraph(container, line) {
  const paragraph = document.createElement("p");
  appendInlineMarkdown(paragraph, line);
  container.append(paragraph);
}

function appendHeading(container, line) {
  const depth = line.match(/^#+/)?.[0].length ?? 1;
  const level = Math.min(depth, 3);
  const heading = document.createElement(`h${level}`);
  heading.textContent = line.replace(/^#+\s*/, "");
  container.append(heading);
}

function appendList(container, lines, startIndex) {
  const list = document.createElement("ul");
  let index = startIndex;

  while (index < lines.length && lines[index].startsWith("- ")) {
    const item = document.createElement("li");
    appendInlineMarkdown(item, lines[index].slice(2));
    list.append(item);
    index += 1;
  }

  container.append(list);
  return index;
}

function isTableSeparator(line) {
  return /^\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+$/.test(line);
}

function parseTableRow(line) {
  return line.split("|").map((cell) => cell.trim());
}

function appendTable(container, lines, startIndex) {
  const table = document.createElement("table");
  const thead = document.createElement("thead");
  const tbody = document.createElement("tbody");
  const headerRow = document.createElement("tr");

  for (const cellText of parseTableRow(lines[startIndex])) {
    const cell = document.createElement("th");
    appendInlineMarkdown(cell, cellText);
    headerRow.append(cell);
  }
  thead.append(headerRow);

  let index = startIndex + 2;
  while (index < lines.length && lines[index].includes("|") && lines[index].trim() !== "") {
    const row = document.createElement("tr");
    for (const cellText of parseTableRow(lines[index])) {
      const cell = document.createElement("td");
      appendInlineMarkdown(cell, cellText);
      row.append(cell);
    }
    tbody.append(row);
    index += 1;
  }

  table.append(thead, tbody);
  container.append(table);
  return index;
}

function renderMarkdown(markdown) {
  currentMarkdown = markdown;
  const lines = markdown.split(/\r?\n/);
  const fragment = document.createDocumentFragment();
  let index = 0;

  while (index < lines.length) {
    const line = lines[index].trimEnd();

    if (line.trim() === "") {
      index += 1;
    } else if (line.startsWith("#")) {
      appendHeading(fragment, line);
      index += 1;
    } else if (line.startsWith("- ")) {
      index = appendList(fragment, lines, index);
    } else if (index + 1 < lines.length && lines[index].includes("|") && isTableSeparator(lines[index + 1])) {
      index = appendTable(fragment, lines, index);
    } else {
      appendParagraph(fragment, line);
      index += 1;
    }
  }

  markdownPreview.replaceChildren(fragment);
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.setAttribute("readonly", "");
  textArea.style.position = "fixed";
  textArea.style.opacity = "0";
  document.body.append(textArea);
  textArea.select();
  document.execCommand("copy");
  textArea.remove();
}

async function copyMarkdown() {
  if (!currentMarkdown) {
    return;
  }

  await copyText(currentMarkdown);
  const originalText = copyButton.textContent;
  copyButton.textContent = "Copied";
  window.setTimeout(() => {
    copyButton.textContent = originalText;
  }, 1200);
}

async function runSummary(event) {
  event.preventDefault();
  const data = new FormData(form);
  const user = String(data.get("github-user") ?? "").trim();
  const months = String(data.get("months") ?? "12").trim();

  runButton.disabled = true;
  copyButton.disabled = true;
  results.hidden = true;
  currentMarkdown = "";
  setStatus("Fetching public GitHub activity...");

  try {
    const { summary, summaryMarkdown } = await window.ContributorSummary.summarizeContributorActivity({
      user,
      months,
      excludeSelf: data.has("exclude-self"),
      excludeOrganizations: data.has("exclude-organizations"),
    });
    renderMarkdown(summaryMarkdown);
    results.hidden = false;
    copyButton.disabled = false;
    setStatus(`Summary ready for ${summary.user}.`, "success");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), "error");
  } finally {
    runButton.disabled = false;
  }
}

form.addEventListener("submit", runSummary);
copyButton.addEventListener("click", () => {
  copyMarkdown().catch((error) => {
    setStatus(error instanceof Error ? error.message : String(error), "error");
  });
});
