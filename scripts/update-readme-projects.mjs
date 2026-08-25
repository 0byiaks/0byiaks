// Regenerates the "Latest Projects" section of README.md between the
// <!--START_SECTION:projects--> / <!--END_SECTION:projects--> markers.
//
// Fully automatic: every public, non-fork repo owned by `owner` is fetched
// live from the GitHub API and sorted by date (newest first, per `sortBy`
// in project-categories.json — "created" or "pushed"). A brand-new repo
// therefore appears the next time this runs with NO config file edits.
//
// Categorization: each repo is placed by matching its GitHub "topics"
// against `topicMap` in project-categories.json (first match wins). A repo
// with none of those topics still shows up — it just falls into
// `defaultCategory` ("Other Projects") instead of being dropped. To
// categorize a repo, add the matching topic on GitHub (repo page → gear
// icon next to "About" → Topics) — no code or config change needed.
//
// `manualEntries` in the config are for repos the API can't/shouldn't
// surface here (e.g. a private repo we still want listed for context) —
// they're merged in and sorted alongside the live-fetched ones.

import { readFile, writeFile } from "node:fs/promises";

const README_PATH = new URL("../README.md", import.meta.url);
const CONFIG_PATH = new URL("../project-categories.json", import.meta.url);
const START_MARKER = "<!--START_SECTION:projects-->";
const END_MARKER = "<!--END_SECTION:projects-->";
const DESCRIPTION_MAX_LEN = 150;
const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;

function truncate(text, max) {
  if (!text) return "";
  const clean = text.trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trim()}…` : clean;
}

async function fetchAllRepos(owner) {
  const repos = [];
  for (let page = 1; ; page++) {
    const res = await fetch(
      `https://api.github.com/users/${owner}/repos?type=owner&per_page=100&page=${page}`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
        },
      }
    );
    if (!res.ok) {
      throw new Error(`Could not list repos for ${owner}: ${res.status} ${res.statusText}`);
    }
    const batch = await res.json();
    repos.push(...batch);
    if (batch.length < 100) break;
  }
  return repos;
}

function categoryFor(repo, config) {
  const topics = repo.topics || [];
  for (const topic of topics) {
    if (config.topicMap[topic]) return config.topicMap[topic];
  }
  return config.defaultCategory;
}

function renderCard(repo) {
  if (repo.private) {
    return [
      `<h4>🔒 ${repo.name} <em>(Private)</em></h4>`,
      `<p>${truncate(repo.description, DESCRIPTION_MAX_LEN)}</p>`,
    ].join("\n");
  }
  return [
    `<h4><a href="${repo.url}">${repo.name}</a></h4>`,
    `<p>${truncate(repo.description, DESCRIPTION_MAX_LEN)}</p>`,
    `<p>⭐ ${repo.stars} &nbsp; 🍴 ${repo.forks} &nbsp; 💻 ${repo.language}</p>`,
  ].join("\n");
}

function renderCategory(title, repos) {
  const rows = [];
  for (let i = 0; i < repos.length; i += 2) {
    const left = repos[i];
    const right = repos[i + 1];
    rows.push(
      [
        "<tr>",
        `<td width="50%" valign="top">`,
        renderCard(left),
        "</td>",
        right
          ? [`<td width="50%" valign="top">`, renderCard(right), "</td>"].join("\n")
          : `<td width="50%"></td>`,
        "</tr>",
      ].join("\n")
    );
  }
  return [`### ${title}`, "", "<table>", rows.join("\n"), "</table>", ""].join("\n");
}

async function main() {
  const config = JSON.parse(await readFile(CONFIG_PATH, "utf8"));
  const readme = await readFile(README_PATH, "utf8");
  const exclude = new Set(config.excludeRepos || []);
  const dateField = config.sortBy === "pushed" ? "pushed_at" : "created_at";

  const liveRepos = await fetchAllRepos(config.owner);
  const normalized = liveRepos
    .filter((r) => !r.fork && !r.archived && !exclude.has(r.name))
    .map((r) => ({
      name: r.name,
      url: r.html_url,
      description: r.description || "No description provided.",
      stars: r.stargazers_count ?? 0,
      forks: r.forks_count ?? 0,
      language: r.language || "—",
      date: r[dateField],
      category: categoryFor(r, config),
      private: false,
    }));

  for (const entry of config.manualEntries || []) {
    normalized.push({
      name: entry.name,
      description: entry.description,
      language: entry.language,
      date: entry.createdAt,
      category: entry.category || config.defaultCategory,
      private: !!entry.private,
    });
  }

  const byCategory = new Map();
  for (const repo of normalized) {
    if (!byCategory.has(repo.category)) byCategory.set(repo.category, []);
    byCategory.get(repo.category).push(repo);
  }
  for (const repos of byCategory.values()) {
    repos.sort((a, b) => new Date(b.date) - new Date(a.date));
  }

  const orderedTitles = [
    ...config.categoryOrder,
    ...[...byCategory.keys()].filter((t) => !config.categoryOrder.includes(t)),
  ];

  const sections = orderedTitles
    .filter((title) => byCategory.has(title))
    .map((title) => renderCategory(title, byCategory.get(title)));

  const body = sections.join("\n---\n\n");
  const newSection = `${START_MARKER}\n${body}\n${END_MARKER}`;

  const startIdx = readme.indexOf(START_MARKER);
  const endIdx = readme.indexOf(END_MARKER);
  if (startIdx === -1 || endIdx === -1) {
    throw new Error("Could not find START_SECTION/END_SECTION markers in README.md");
  }

  const updated =
    readme.slice(0, startIdx) + newSection + readme.slice(endIdx + END_MARKER.length);

  if (updated === readme) {
    console.log("No changes to Latest Projects section.");
    return;
  }

  await writeFile(README_PATH, updated, "utf8");
  console.log("README.md Latest Projects section updated.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
