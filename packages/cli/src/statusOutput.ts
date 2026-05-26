import type { CapabilityStatusReport } from "@capabilitykit/core";

export function filterStatusReportByRelease(report: CapabilityStatusReport, release: string): CapabilityStatusReport {
  const capabilities = report.capabilities.filter((capability) => capability.storyMap?.release === release);

  return {
    ...report,
    capabilities,
    byStoryMap: {
      releases: report.byStoryMap.releases
        .filter((entry) => entry.release === release)
        .map((entry) => ({
          ...entry,
          capabilities: entry.capabilities.filter((capability) => capability.storyMap?.release === release)
        })),
      unassigned: []
    },
    summary: {
      total: capabilities.length,
      ok: capabilities.filter((capability) => capability.health === "ok").length,
      review: capabilities.filter((capability) => capability.health === "review").length,
      action: capabilities.filter((capability) => capability.health === "action").length,
      planned: capabilities.filter((capability) => capability.health === "planned").length
    }
  };
}

export function formatStoryMapStatusReport(
  report: CapabilityStatusReport,
  options: { recommendOrder?: boolean } = {}
): string {
  const lines: string[] = [
    `CapabilityKit Story Map Status: ${report.project}`,
    "",
    `Capabilities: ${report.summary.total}  ok: ${report.summary.ok}  needs-review: ${report.summary.review}  needs-action: ${report.summary.action}  planned: ${report.summary.planned}`
  ];

  for (const release of report.byStoryMap.releases) {
    lines.push("", `Release: ${release.release}`);
    const grouped = new Map<string, typeof release.capabilities>();
    for (const capability of release.capabilities) {
      const key = `${capability.storyMap?.backbone ?? "Unknown"}|||${capability.storyMap?.step ?? "Unknown"}`;
      grouped.set(key, [...(grouped.get(key) ?? []), capability]);
    }
    for (const [key, capabilities] of [...grouped.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const [backbone, step] = key.split("|||");
      lines.push(`  ${backbone} > ${step}`);
      for (const capability of capabilities.sort((a, b) => a.capabilityId.localeCompare(b.capabilityId))) {
        lines.push(`    - ${capability.capabilityId} [${capability.status}] (${capability.health})`);
      }
    }
    if (options.recommendOrder && release.deliveryStrategy.recommendations.length > 0) {
      lines.push("", "  Recommended delivery strategy:");
      for (const recommendation of release.deliveryStrategy.recommendations) {
        lines.push(
          `    ${recommendation.order}. ${recommendation.phase}: ${recommendation.name}`,
          `       Release: ${recommendation.releaseStrategy}`,
          `       Development: ${recommendation.developmentStrategy}`,
          `       Capabilities: ${recommendation.capabilityIds.join(", ")}`,
          `       Backbone coverage: ${recommendation.backboneCoverage.length > 0 ? recommendation.backboneCoverage.join(", ") : "none"}`,
          `       Risk intent: ${recommendation.riskIntent}`,
          `       Learning intent: ${recommendation.learningIntent}`,
          `       Rationale: ${recommendation.rationale}`
        );
        if (recommendation.missingBackbones.length > 0) {
          lines.push(`       Missing backbones: ${recommendation.missingBackbones.join(", ")}`);
        }
        if (recommendation.stepCoverageGaps.length > 0) {
          lines.push(`       Step coverage gaps: ${recommendation.stepCoverageGaps.join("; ")}`);
        }
      }
    }
  }

  if (report.byStoryMap.unassigned.length > 0) {
    lines.push("", `Unassigned (${report.byStoryMap.unassigned.length}):`);
    for (const capability of report.byStoryMap.unassigned.sort((a, b) => a.capabilityId.localeCompare(b.capabilityId))) {
      lines.push(`  - ${capability.capabilityId} [${capability.status}] (${capability.health})`);
    }
  }

  return `${lines.join("\n")}\n`;
}

export function formatStoryMapViewerHtml(report: CapabilityStatusReport): string {
  const storyMapData = JSON.stringify(report).replaceAll("</", "<\\/");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(report.project)} story map</title>
    <style>
      :root {
        --bg: #f4f7fb;
        --ink: #121826;
        --muted: #65758b;
        --panel: #ffffff;
        --line: #d7e0ea;
        --core: #2563eb;
        --cli: #0891b2;
        --site: #16a34a;
        --plan: #7c3aed;
        --risk: #e11d48;
        --warn: #d97706;
        --soft: #f8fafc;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        color: var(--ink);
        background:
          linear-gradient(135deg, rgba(37, 99, 235, 0.08), transparent 28%),
          linear-gradient(315deg, rgba(22, 163, 74, 0.08), transparent 26%),
          var(--bg);
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .app { min-height: 100vh; }
      header {
        position: sticky;
        top: 0;
        z-index: 5;
        border-bottom: 1px solid rgba(148, 163, 184, 0.35);
        background: rgba(244, 247, 251, 0.88);
        backdrop-filter: blur(16px);
      }
      .header-inner {
        max-width: 1540px;
        margin: 0 auto;
        padding: 22px 28px 18px;
      }
      .title-row {
        display: flex;
        justify-content: space-between;
        gap: 24px;
        align-items: end;
      }
      h1 {
        margin: 0;
        font-size: 30px;
        line-height: 1.08;
        letter-spacing: 0;
      }
      .subtitle {
        margin: 8px 0 0;
        color: var(--muted);
        font-size: 14px;
        line-height: 1.45;
        font-weight: 560;
      }
      .summary {
        display: grid;
        grid-template-columns: repeat(5, minmax(84px, 1fr));
        gap: 8px;
        min-width: 520px;
      }
      .metric {
        min-height: 58px;
        padding: 10px 12px;
        border: 1px solid rgba(148, 163, 184, 0.34);
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.72);
      }
      .metric strong {
        display: block;
        font-size: 20px;
        line-height: 1;
      }
      .metric span {
        display: block;
        margin-top: 6px;
        color: var(--muted);
        font-size: 11px;
        font-weight: 780;
        text-transform: uppercase;
      }
      .toolbar {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        align-items: center;
        margin-top: 18px;
      }
      .tabs {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      button, input, select {
        font: 700 13px Inter, ui-sans-serif, system-ui, sans-serif;
      }
      button {
        min-height: 34px;
        border: 1px solid var(--line);
        border-radius: 7px;
        background: rgba(255,255,255,0.82);
        color: #334155;
        padding: 0 12px;
        cursor: pointer;
      }
      button.active {
        border-color: rgba(37, 99, 235, 0.4);
        background: #dbeafe;
        color: #1d4ed8;
      }
      .filters {
        margin-left: auto;
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
      }
      input, select {
        height: 34px;
        border: 1px solid var(--line);
        border-radius: 7px;
        background: rgba(255,255,255,0.9);
        color: var(--ink);
        padding: 0 11px;
      }
      input { width: 260px; }
      select { width: 168px; }
      main {
        max-width: 1540px;
        margin: 0 auto;
        padding: 22px 28px 38px;
      }
      .board {
        display: grid;
        gap: 18px;
      }
      .release {
        border: 1px solid rgba(148, 163, 184, 0.38);
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.62);
        overflow: hidden;
        box-shadow: 0 18px 45px rgba(15, 23, 42, 0.07);
      }
      .release-head {
        display: flex;
        justify-content: space-between;
        gap: 16px;
        padding: 16px 18px;
        border-bottom: 1px solid var(--line);
        background: linear-gradient(90deg, rgba(255,255,255,0.88), rgba(248,250,252,0.66));
      }
      .release-title {
        display: flex;
        align-items: center;
        gap: 10px;
        min-width: 0;
      }
      .release-title h2 {
        margin: 0;
        font-size: 18px;
        line-height: 1.2;
        letter-spacing: 0;
      }
      .release-chip {
        display: inline-flex;
        align-items: center;
        min-height: 25px;
        padding: 3px 8px;
        border-radius: 999px;
        background: #eef2ff;
        color: #4338ca;
        font-size: 11px;
        font-weight: 840;
        text-transform: uppercase;
      }
      .release-stats {
        display: flex;
        flex-wrap: wrap;
        justify-content: end;
        gap: 8px;
        color: var(--muted);
        font-size: 12px;
        font-weight: 760;
      }
      .steps {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(286px, 1fr));
        gap: 12px;
        padding: 14px;
      }
      .step {
        min-width: 0;
        border: 1px solid var(--line);
        border-radius: 8px;
        background: rgba(255,255,255,0.82);
        overflow: hidden;
      }
      .step-head {
        min-height: 84px;
        padding: 13px 13px 11px;
        border-bottom: 1px solid #e2e8f0;
        background: var(--soft);
      }
      .backbone {
        color: var(--core);
        font-size: 11px;
        font-weight: 850;
        text-transform: uppercase;
      }
      .step h3 {
        margin: 6px 0 0;
        font-size: 15px;
        line-height: 1.25;
        letter-spacing: 0;
      }
      .cards {
        display: grid;
        gap: 9px;
        padding: 10px;
      }
      .card {
        display: grid;
        gap: 8px;
        padding: 11px;
        border: 1px solid #e2e8f0;
        border-left: 4px solid var(--site);
        border-radius: 7px;
        background: #ffffff;
        cursor: pointer;
        transition: transform 120ms ease, box-shadow 120ms ease, border-color 120ms ease;
      }
      .card:hover {
        transform: translateY(-1px);
        box-shadow: 0 12px 26px rgba(15, 23, 42, 0.09);
      }
      .card.action { border-left-color: var(--risk); }
      .card.review { border-left-color: var(--core); }
      .card.planned { border-left-color: var(--warn); }
      .card-title {
        display: flex;
        justify-content: space-between;
        gap: 10px;
        align-items: start;
      }
      .card h4 {
        margin: 0;
        font-size: 14px;
        line-height: 1.3;
        letter-spacing: 0;
      }
      .pill {
        display: inline-flex;
        align-items: center;
        min-height: 22px;
        white-space: nowrap;
        padding: 3px 7px;
        border-radius: 999px;
        background: #ecfdf5;
        color: #047857;
        font-size: 11px;
        font-weight: 850;
      }
      .pill.action { background: #fff1f2; color: #be123c; }
      .pill.review { background: #dbeafe; color: #1d4ed8; }
      .pill.planned { background: #fffbeb; color: #b45309; }
      .card p {
        margin: 0;
        color: #475569;
        font-size: 12px;
        line-height: 1.45;
      }
      .card-id {
        color: #64748b;
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 11px;
        overflow-wrap: anywhere;
      }
      .unassigned {
        margin-top: 18px;
      }
      .empty {
        padding: 28px;
        border: 1px dashed #cbd5e1;
        border-radius: 8px;
        background: rgba(255,255,255,0.7);
        color: var(--muted);
        text-align: center;
        font-weight: 720;
      }
      dialog {
        width: min(760px, calc(100vw - 32px));
        max-height: calc(100vh - 44px);
        border: 1px solid var(--line);
        border-radius: 8px;
        padding: 0;
        box-shadow: 0 28px 90px rgba(15, 23, 42, 0.24);
      }
      dialog::backdrop { background: rgba(15, 23, 42, 0.34); }
      .detail {
        padding: 22px;
      }
      .detail-top {
        display: flex;
        justify-content: space-between;
        gap: 18px;
        align-items: start;
        border-bottom: 1px solid var(--line);
        padding-bottom: 16px;
      }
      .detail h2 {
        margin: 0;
        font-size: 22px;
        line-height: 1.2;
        letter-spacing: 0;
      }
      .close {
        width: 34px;
        min-width: 34px;
        padding: 0;
        font-size: 18px;
      }
      .detail-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 14px;
        margin-top: 16px;
      }
      .detail-section {
        border: 1px solid var(--line);
        border-radius: 8px;
        padding: 13px;
        background: #f8fafc;
      }
      .detail-section.full { grid-column: 1 / -1; }
      .detail-section h3 {
        margin: 0 0 8px;
        color: #334155;
        font-size: 12px;
        letter-spacing: 0;
        text-transform: uppercase;
      }
      .detail-section p, .detail-section li {
        color: #475569;
        font-size: 13px;
        line-height: 1.48;
      }
      .detail-section p { margin: 0; }
      ul { margin: 0; padding-left: 18px; }
      li { margin: 6px 0; overflow-wrap: anywhere; }
      code {
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 12px;
      }
      @media (max-width: 900px) {
        .title-row { display: grid; }
        .summary { min-width: 0; grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .filters { margin-left: 0; width: 100%; }
        input, select { width: 100%; }
        .detail-grid { grid-template-columns: 1fr; }
      }
    </style>
  </head>
  <body>
    <div class="app">
      <header>
        <div class="header-inner">
          <div class="title-row">
            <div>
              <h1>${escapeHtml(report.project)} story map</h1>
              <p class="subtitle">Plan by release, backbone, and step while keeping delivery status and verification risk visible.</p>
            </div>
            <div class="summary" id="summary"></div>
          </div>
          <div class="toolbar">
            <div class="tabs" id="release-tabs"></div>
            <div class="filters">
              <input id="search" type="search" placeholder="Search capabilities" aria-label="Search capabilities" />
              <select id="health-filter" aria-label="Filter by health">
                <option value="">All health states</option>
                <option value="ok">OK</option>
                <option value="review">Needs review</option>
                <option value="action">Needs action</option>
                <option value="planned">Planned</option>
              </select>
            </div>
          </div>
        </div>
      </header>
      <main>
        <div class="board" id="board"></div>
      </main>
      <dialog id="detail-dialog"></dialog>
    </div>
    <script>
const report = ${storyMapData};
let selectedRelease = "";
let selectedHealth = "";
let searchText = "";
const board = document.getElementById("board");
const tabs = document.getElementById("release-tabs");
const summary = document.getElementById("summary");
const search = document.getElementById("search");
const healthFilter = document.getElementById("health-filter");
const detailDialog = document.getElementById("detail-dialog");

function healthLabel(value) {
  if (value === "action") return "needs action";
  if (value === "review") return "needs review";
  return value;
}
function matches(capability) {
  if (selectedHealth && capability.health !== selectedHealth) return false;
  if (!searchText) return true;
  const haystack = [capability.capabilityId, capability.title, capability.summary, capability.intent, capability.storyMap?.backbone, capability.storyMap?.step].join(" ").toLowerCase();
  return haystack.includes(searchText);
}
function filteredCapabilities(capabilities) {
  return capabilities.filter(matches).sort((a, b) => a.capabilityId.localeCompare(b.capabilityId));
}
function activeCapabilities() {
  if (selectedRelease) {
    return report.byStoryMap.releases.find((release) => release.release === selectedRelease)?.capabilities || [];
  }
  return [
    ...report.byStoryMap.releases.flatMap((release) => release.capabilities),
    ...report.byStoryMap.unassigned
  ];
}
function counts(capabilities) {
  return {
    total: capabilities.length,
    ok: capabilities.filter((item) => item.health === "ok").length,
    review: capabilities.filter((item) => item.health === "review").length,
    action: capabilities.filter((item) => item.health === "action").length,
    planned: capabilities.filter((item) => item.health === "planned").length
  };
}
function renderSummary() {
  const visible = activeCapabilities().filter(matches);
  const current = counts(visible);
  summary.replaceChildren(
    metric("Total", current.total),
    metric("OK", current.ok),
    metric("Review", current.review),
    metric("Action", current.action),
    metric("Planned", current.planned)
  );
}
function metric(label, value) {
  const node = document.createElement("div");
  node.className = "metric";
  const strong = document.createElement("strong");
  strong.textContent = value;
  const span = document.createElement("span");
  span.textContent = label;
  node.append(strong, span);
  return node;
}
function renderTabs() {
  tabs.replaceChildren();
  const all = document.createElement("button");
  all.type = "button";
  all.textContent = "All releases";
  all.className = selectedRelease === "" ? "active" : "";
  all.addEventListener("click", () => { selectedRelease = ""; render(); });
  tabs.append(all);
  for (const release of report.byStoryMap.releases) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = release.release;
    button.className = selectedRelease === release.release ? "active" : "";
    button.addEventListener("click", () => { selectedRelease = release.release; render(); });
    tabs.append(button);
  }
}
function groupByStep(capabilities) {
  const grouped = new Map();
  for (const capability of capabilities) {
    const story = capability.storyMap || { backbone: "Unassigned", step: "Needs planning" };
    const key = story.backbone + "|||" + story.step;
    if (!grouped.has(key)) grouped.set(key, { backbone: story.backbone, step: story.step, capabilities: [] });
    grouped.get(key).capabilities.push(capability);
  }
  return [...grouped.values()].sort((a, b) => a.backbone.localeCompare(b.backbone) || a.step.localeCompare(b.step));
}
function renderRelease(release) {
  const visible = filteredCapabilities(release.capabilities);
  if (visible.length === 0) return null;
  const releaseNode = document.createElement("section");
  releaseNode.className = "release";
  const releaseCounts = counts(visible);
  const head = document.createElement("div");
  head.className = "release-head";
  const title = document.createElement("div");
  title.className = "release-title";
  const chip = document.createElement("span");
  chip.className = "release-chip";
  chip.textContent = release.release;
  const h2 = document.createElement("h2");
  h2.textContent = release.release;
  title.append(chip, h2);
  const stats = document.createElement("div");
  stats.className = "release-stats";
  stats.textContent = releaseCounts.total + " capabilities | " + releaseCounts.ok + " ok | " + releaseCounts.action + " action | " + releaseCounts.planned + " planned";
  head.append(title, stats);
  const steps = document.createElement("div");
  steps.className = "steps";
  for (const group of groupByStep(visible)) steps.append(renderStep(group));
  releaseNode.append(head, steps);
  return releaseNode;
}
function renderStep(group) {
  const step = document.createElement("article");
  step.className = "step";
  const head = document.createElement("div");
  head.className = "step-head";
  const backbone = document.createElement("div");
  backbone.className = "backbone";
  backbone.textContent = group.backbone;
  const h3 = document.createElement("h3");
  h3.textContent = group.step;
  head.append(backbone, h3);
  const cards = document.createElement("div");
  cards.className = "cards";
  for (const capability of group.capabilities) cards.append(renderCard(capability));
  step.append(head, cards);
  return step;
}
function renderCard(capability) {
  const card = document.createElement("article");
  card.className = "card " + capability.health;
  card.tabIndex = 0;
  const title = document.createElement("div");
  title.className = "card-title";
  const h4 = document.createElement("h4");
  h4.textContent = capability.title;
  const pill = document.createElement("span");
  pill.className = "pill " + capability.health;
  pill.textContent = healthLabel(capability.health);
  title.append(h4, pill);
  const summary = document.createElement("p");
  summary.textContent = capability.summary;
  const id = document.createElement("div");
  id.className = "card-id";
  id.textContent = capability.capabilityId;
  card.append(title, summary, id);
  card.addEventListener("click", () => showDetail(capability));
  card.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      showDetail(capability);
    }
  });
  return card;
}
function render() {
  renderTabs();
  renderSummary();
  board.replaceChildren();
  const releases = report.byStoryMap.releases.filter((release) => !selectedRelease || release.release === selectedRelease);
  for (const release of releases) {
    const node = renderRelease(release);
    if (node) board.append(node);
  }
  const existingUnassigned = document.querySelector(".unassigned");
  if (existingUnassigned) existingUnassigned.remove();
  if (!selectedRelease) {
    const visible = filteredCapabilities(report.byStoryMap.unassigned);
    if (visible.length > 0) {
      const node = renderRelease({ release: "Unassigned", capabilities: visible });
      if (node) {
        node.classList.add("unassigned");
        board.after(node);
      }
    }
  }
  if (!board.children.length && (!document.querySelector(".unassigned"))) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "No capabilities match the current filters.";
    board.append(empty);
  }
}
function section(title, body) {
  const wrap = document.createElement("section");
  wrap.className = "detail-section";
  const h3 = document.createElement("h3");
  h3.textContent = title;
  wrap.append(h3, body);
  return wrap;
}
function paragraph(text) {
  const p = document.createElement("p");
  p.textContent = text || "None";
  return p;
}
function list(items, formatter) {
  if (!items || items.length === 0) return paragraph("None");
  const ul = document.createElement("ul");
  for (const item of items) {
    const li = document.createElement("li");
    if (formatter) {
      const value = formatter(item);
      if (value instanceof Node) li.append(value);
      else li.textContent = value;
    } else {
      li.textContent = item;
    }
    ul.append(li);
  }
  return ul;
}
function showDetail(capability) {
  detailDialog.replaceChildren();
  const detail = document.createElement("div");
  detail.className = "detail";
  const top = document.createElement("div");
  top.className = "detail-top";
  const title = document.createElement("div");
  const h2 = document.createElement("h2");
  h2.textContent = capability.title;
  const id = document.createElement("p");
  id.className = "card-id";
  id.textContent = capability.capabilityId;
  title.append(h2, id);
  const close = document.createElement("button");
  close.className = "close";
  close.type = "button";
  close.textContent = "x";
  close.setAttribute("aria-label", "Close details");
  close.addEventListener("click", () => detailDialog.close());
  top.append(title, close);
  const grid = document.createElement("div");
  grid.className = "detail-grid";
  grid.append(section("Status", paragraph(capability.status + " / " + healthLabel(capability.health))));
  grid.append(section("Story Map", paragraph(capability.storyMap ? capability.storyMap.release + " / " + capability.storyMap.backbone + " / " + capability.storyMap.step : "Unassigned")));
  const summarySection = section("Summary", paragraph(capability.summary));
  summarySection.classList.add("full");
  const intentSection = section("Intent", paragraph(capability.intent));
  intentSection.classList.add("full");
  const findings = section("Next Action", paragraph(capability.nextAction));
  findings.classList.add("full");
  grid.append(summarySection, intentSection, section("Verification Gaps", list(capability.verification.gaps, (gap) => gap.message)), findings);
  detail.append(top, grid);
  detailDialog.append(detail);
  detailDialog.showModal();
}
search.addEventListener("input", () => { searchText = search.value.trim().toLowerCase(); render(); });
healthFilter.addEventListener("change", () => { selectedHealth = healthFilter.value; render(); });
detailDialog.addEventListener("click", (event) => {
  if (event.target === detailDialog) detailDialog.close();
});
render();
    </script>
  </body>
</html>
`;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
