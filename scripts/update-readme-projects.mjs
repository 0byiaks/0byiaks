// Regenerates the "Latest Projects" section of README.md between the
// <!--START_SECTION:projects--> / <!--END_SECTION:projects--> markers,
// grouped into categories defined in project-categories.json.
//
// - Repos are pulled live from the GitHub API (stars, forks, top language,
//   description) unless the config entry has "manual": true, in which case
//   the config's own fields are used as-is (used for private repos that
//   should stay hidden from the API listing but still show on the profile).
// - Edit project-categories.json to add, remove, or re-categorize a repo —
//   no code changes needed.

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

async function fetchRepo(owner, name) {
  const res = await fetch(`https://api.github.com/repos/${owner}/${name}`, {
    headers: {
      Accept: "application/vnd.github+json",
      ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
    },
  });
  if (!res.ok) {
    console.warn(`⚠️  Could not fetch ${owner}/${name}: ${res.status} ${res.statusText}`);
    return null;
  }
  const data = await res.json();
  return {
    name: data.name,
    url: data.html_url,
    description: data.description || "No description provided.",
    stars: data.stargazers_count ?? 0,
    forks: data.forks_count ?? 0,
    language: data.language || "—",
  };
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

  const sections = [];
  for (const category of config.categories) {
    const repos = [];
    for (const entry of category.repos) {
      if (entry.manual) {
        repos.push({
          name: entry.name,
          description: entry.description,
          language: entry.language,
          private: !!entry.private,
        });
        continue;
      }
      const repo = await fetchRepo(config.owner, entry.name);
      if (repo) repos.push(repo);
    }
    if (repos.length) sections.push(renderCategory(category.title, repos));
  }

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
