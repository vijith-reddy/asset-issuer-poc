const actors = ["admin", "manager", "alice", "bob"];
let activeActor = "admin";
let state = null;

const output = document.querySelector("#output");
const actorPanel = document.querySelector("#actorPanel");
const refreshButton = document.querySelector("#refreshButton");
const clearOutputButton = document.querySelector("#clearOutputButton");

document.querySelectorAll(".tab-button").forEach((button) => {
  button.addEventListener("click", () => {
    activeActor = button.dataset.tab;
    document.querySelectorAll(".tab-button").forEach((tab) => tab.classList.toggle("is-active", tab === button));
    render();
  });
});

refreshButton.addEventListener("click", async () => {
  await refreshState();
  appendOutput("refreshed state");
});

clearOutputButton.addEventListener("click", () => {
  output.textContent = "Ready.";
});

await refreshState();

async function refreshState() {
  const response = await fetch("/api/state");
  const payload = await response.json();

  if (!payload.ok) {
    throw new Error(payload.error ?? "Failed to load state");
  }

  state = payload.state;
  render();
}

function render() {
  renderStatus();

  if (activeActor === "admin") renderAdmin();
  if (activeActor === "manager") renderManager();
  if (activeActor === "alice" || activeActor === "bob") renderUser(activeActor);
}

function renderStatus() {
  const token = selectedToken();
  const policy = selectedPolicy();

  document.querySelector("#networkLine").textContent = `${state.network.label} · chain ${state.network.chainId}`;
  document.querySelector("#tokenStatus").textContent = token ? `${token.name} ${shortAddress(token.address)}` : "No token";
  document.querySelector("#policyStatus").textContent = policy ? `${policy.name} #${policy.id} ${policy.type}` : "No policy";
  document.querySelector("#managerStatus").textContent = state.manager ? shortAddress(state.manager.address) : "Not deployed";
}

function renderAdmin() {
  actorPanel.innerHTML = `
    <div class="section-grid">
      <section class="tool-section wide">
        <h2>Token Onboarding</h2>
        <div class="form-grid three">
          ${input("tokenSymbol", "Symbol", "DEMO")}
          ${input("tokenName", "Name", "DemoDollar")}
          ${input("tokenCurrency", "Currency", "USD")}
          ${select("tokenQuote", "Quote", [["pathUSD", "pathUSD"], ...tokenOptions()])}
          ${input("tokenSalt", "Salt", "demo-dollar")}
          ${select("tokenAdmin", "Admin", actorOptions("admin"))}
          <button class="primary" data-action="create-token">Create Token</button>
        </div>
      </section>

      <section class="tool-section">
        <h2>Token Configuration</h2>
        <div class="form-grid">
          ${select("configToken", "Token", tokenOptions())}
          ${select("configPolicy", "Policy", policyOptions())}
          <button class="primary" data-action="attach-policy">Attach Policy</button>
          <button data-action="token-list">Token List</button>
          <button data-action="token-inspect">Inspect Token</button>
          <button data-action="token-roles-manager">Manager Roles</button>
        </div>
      </section>

      <section class="tool-section">
        <h2>Policy</h2>
        <div class="form-grid">
          ${input("policyName", "Name", "usdv-kyc")}
          ${select("policyType", "Type", [["whitelist", "whitelist"], ["blacklist", "blacklist"]])}
          <button class="primary" data-action="create-policy">Create Policy</button>
          <button data-action="policy-list">Policy List</button>
          ${select("policyEditName", "Policy", policyOptions())}
          ${select("policyTarget", "Target", actorOptions("alice"))}
          <button data-action="policy-allow">Allow</button>
          <button data-action="policy-remove">Remove</button>
          <button data-action="policy-block">Block</button>
          <button data-action="policy-unblock">Unblock</button>
        </div>
      </section>

      <section class="tool-section">
        <h2>Manager Setup</h2>
        <div class="button-row">
          <button data-action="manager-deploy">Deploy Manager</button>
          <button class="primary" data-action="manager-grant-roles">Grant Operational Roles</button>
          <button data-action="manager-allow-policy">Allow In Policy</button>
          <button data-action="manager-faucet">Faucet Manager</button>
          <button data-action="manager-inspect">Inspect Manager</button>
        </div>
      </section>

      <section class="tool-section wide">
        <h2>Workspace</h2>
        ${summaryTable()}
      </section>
    </div>
  `;

  wireAdminActions();
}

function renderManager() {
  actorPanel.innerHTML = `
    <div class="section-grid">
      <section class="tool-section">
        <h2>Manager</h2>
        <div class="button-row">
          <button data-action="manager-inspect">Inspect</button>
          <button data-action="manager-roles">Check Roles</button>
          <button data-action="manager-balance">Balances</button>
          <button data-action="manager-faucet">Faucet</button>
        </div>
      </section>
      <section class="tool-section">
        <h2>Admin Subscribe</h2>
        <div class="form-grid">
          ${select("adminSubRecipient", "Recipient", actorOptions("bob"))}
          ${input("adminSubAmount", "Amount", "5")}
          ${input("adminSubMemo", "Memo", "offchain-settlement")}
          <button class="primary" data-action="admin-subscribe">Admin Subscribe</button>
        </div>
      </section>
      <section class="tool-section wide">
        <h2>Manager State</h2>
        ${managerTable()}
      </section>
    </div>
  `;

  wireManagerActions();
}

function renderUser(actor) {
  const other = actor === "alice" ? "bob" : "alice";

  actorPanel.innerHTML = `
    <div class="section-grid">
      <section class="tool-section">
        <h2>${capitalize(actor)} Balances</h2>
        <div class="button-row">
          <button class="primary" data-action="balance">Balance</button>
          <button data-action="history">History</button>
        </div>
      </section>
      <section class="tool-section">
        <h2>Subscribe / Redeem</h2>
        <div class="form-grid">
          ${input("subscribeAmount", "Subscribe", "10")}
          <button class="primary" data-action="subscribe">Subscribe</button>
          ${input("redeemAmount", "Redeem", "2")}
          <button data-action="redeem">Redeem</button>
        </div>
      </section>
      <section class="tool-section wide">
        <h2>Send</h2>
        <div class="form-grid three">
          ${input("sendAmount", "Amount", "1")}
          ${select("sendToken", "Token", [["USDV", "USDV"], ["pathUSD", "pathUSD"]])}
          ${select("sendTo", "To", actorOptions(other))}
          ${input("sendMemo", "Memo", "invoice-001")}
          <button class="primary" data-action="send">Send</button>
        </div>
      </section>
      <section class="tool-section wide">
        <h2>Actor</h2>
        ${actorTable(actor)}
      </section>
    </div>
  `;

  wireUserActions(actor);
}

function wireAdminActions() {
  bind("create-token", () => run("admin", "token", [
    "create",
    value("tokenSymbol"),
    "--name",
    value("tokenName"),
    "--currency",
    value("tokenCurrency"),
    "--quote",
    value("tokenQuote"),
    "--admin",
    value("tokenAdmin"),
    "--salt",
    value("tokenSalt"),
  ]));
  bind("attach-policy", () => run("admin", "token", ["set-policy", value("configToken"), value("configPolicy")]));
  bind("token-list", () => run("admin", "token", ["list"]));
  bind("token-inspect", () => run("admin", "token", ["inspect", value("configToken")]));
  bind("token-roles-manager", () => run("admin", "token", ["roles", value("configToken"), "manager"]));
  bind("create-policy", () => run("admin", "policy", ["create", value("policyName"), value("policyType")]));
  bind("policy-list", () => run("admin", "policy", ["list"]));
  bind("policy-allow", () => run("admin", "policy", ["allow", value("policyTarget"), value("policyEditName")]));
  bind("policy-remove", () => run("admin", "policy", ["remove", value("policyTarget"), value("policyEditName")]));
  bind("policy-block", () => run("admin", "policy", ["block", value("policyTarget"), value("policyEditName")]));
  bind("policy-unblock", () => run("admin", "policy", ["unblock", value("policyTarget"), value("policyEditName")]));
  bind("manager-deploy", () => run("admin", "manager", ["deploy"]));
  bind("manager-grant-roles", () => run("admin", "manager", ["grant-operational-roles"]));
  bind("manager-allow-policy", () => run("admin", "manager", ["allow-policy", value("configPolicy")]));
  bind("manager-faucet", () => run("admin", "manager", ["faucet"]));
  bind("manager-inspect", () => run("admin", "manager", ["inspect"]));
}

function wireManagerActions() {
  bind("manager-inspect", () => run("manager", "manager", ["inspect"]));
  bind("manager-roles", () => run("manager", "token", ["roles", selectedTokenName(), "manager"]));
  bind("manager-balance", () => run("manager", "balance", [state.manager?.address ?? "manager"]));
  bind("manager-faucet", () => run("manager", "manager", ["faucet"]));
  bind("admin-subscribe", () => run("admin", "admin-subscribe", [value("adminSubRecipient"), value("adminSubAmount"), "--memo", value("adminSubMemo")]));
}

function wireUserActions(actor) {
  bind("balance", () => run(actor, "balance", []));
  bind("history", () => run(actor, "history", ["10"]));
  bind("subscribe", () => run(actor, "subscribe", [value("subscribeAmount")]));
  bind("redeem", () => run(actor, "redeem", [value("redeemAmount")]));
  bind("send", () => run(actor, "send", [value("sendAmount"), value("sendToken"), "to", value("sendTo"), "--memo", value("sendMemo")]));
}

async function run(actor, command, args) {
  appendOutput(`\n${actor}> ${[command, ...args].join(" ")}`);

  const response = await fetch("/api/action", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ actor, command, args }),
  });
  const payload = await response.json();

  if (!payload.ok) {
    appendOutput(`Error: ${payload.error ?? "Unknown error"}`);
    return;
  }

  if (payload.output) appendOutput(payload.output);
  state = payload.state;
  render();
}

function bind(action, handler) {
  document.querySelector(`[data-action="${action}"]`)?.addEventListener("click", handler);
}

function input(id, label, defaultValue) {
  return `<label>${label}<input id="${id}" value="${escapeAttr(defaultValue)}" /></label>`;
}

function select(id, label, options) {
  const items = options.length > 0 ? options : [["", "none"]];
  return `<label>${label}<select id="${id}">${items.map(([value, text]) => `<option value="${escapeAttr(value)}">${escapeHtml(text)}</option>`).join("")}</select></label>`;
}

function actorOptions(defaultActor) {
  const accounts = state.accounts.filter((account) => ["admin", "alice", "bob", "policyadmin"].includes(account.name));
  const ordered = [...accounts].sort((left, right) => {
    if (left.name === defaultActor) return -1;
    if (right.name === defaultActor) return 1;
    return left.name.localeCompare(right.name);
  });

  return ordered.map((account) => [account.name, account.name]);
}

function tokenOptions() {
  return state.tokens.map((token) => [token.name, token.name]);
}

function policyOptions() {
  return state.policies.map((policy) => [policy.name, `${policy.name} #${policy.id}`]);
}

function selectedToken() {
  return state.tokens.find((token) => token.name === "USDV") ?? state.tokens[0];
}

function selectedTokenName() {
  return selectedToken()?.name ?? "USDV";
}

function selectedPolicy() {
  return state.policies.find((policy) => policy.name === "usdv-kyc") ?? state.policies[0];
}

function value(id) {
  return document.querySelector(`#${id}`)?.value ?? "";
}

function appendOutput(text) {
  output.textContent = output.textContent === "Ready." ? text : `${output.textContent}\n${text}`;
  output.scrollTop = output.scrollHeight;
}

function summaryTable() {
  const rows = [
    ...state.tokens.map((token) => ["Token", token.name, shortAddress(token.address)]),
    ...state.policies.map((policy) => ["Policy", policy.name, `${policy.type} #${policy.id}`]),
  ];

  return table(["Type", "Name", "Detail"], rows);
}

function managerTable() {
  if (!state.manager) return `<p class="muted">No manager deployment in local state.</p>`;

  return table(["Field", "Value"], [
    ["Address", html(`<span class="mono">${escapeHtml(state.manager.address)}</span>`)],
    ["USDV", html(`<span class="mono">${escapeHtml(state.manager.metadata.usdv ?? "unknown")}</span>`)],
    ["Roles", state.manager.metadata.operationalRoles ?? "not recorded"],
  ]);
}

function actorTable(actor) {
  const account = state.accounts.find((item) => item.name === actor);

  if (!account) return `<p class="muted">No local profile for ${escapeHtml(actor)}.</p>`;

  return table(["Field", "Value"], [
    ["Name", account.name],
    ["Kind", account.kind],
    ["Address", html(`<span class="mono">${escapeHtml(account.address)}</span>`)],
  ]);
}

function table(headers, rows) {
  return `
    <table class="inline-table">
      <thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead>
      <tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${renderCell(cell)}</td>`).join("")}</tr>`).join("")}</tbody>
    </table>
  `;
}

function html(value) {
  return { html: value };
}

function renderCell(cell) {
  if (cell && typeof cell === "object" && Object.hasOwn(cell, "html")) {
    return cell.html;
  }

  return escapeHtml(cell);
}

function shortAddress(address) {
  if (!address) return "unknown";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}
