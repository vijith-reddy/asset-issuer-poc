const views = ["overview", "admin", "compliance", "operator", "investors", "simulation", "activity"];
let activeView = "overview";
let simulationActor = "alice";
let state = null;

const output = document.querySelector("#output");
const workspacePanel = document.querySelector("#workspacePanel");
const refreshButton = document.querySelector("#refreshButton");
const clearOutputButton = document.querySelector("#clearOutputButton");

document.querySelectorAll(".nav-button").forEach((button) => {
  button.addEventListener("click", () => {
    activeView = button.dataset.view;
    document.querySelectorAll(".nav-button").forEach((tab) => {
      tab.classList.toggle("is-active", tab === button);
    });
    render();
  });
});

refreshButton.addEventListener("click", async () => {
  await refreshState();
  appendOutput("workspace refreshed");
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

  if (activeView === "overview") renderOverview();
  if (activeView === "admin") renderAdmin();
  if (activeView === "compliance") renderCompliance();
  if (activeView === "operator") renderOperator();
  if (activeView === "investors") renderInvestors();
  if (activeView === "simulation") renderSimulation();
  if (activeView === "activity") renderActivity();
}

function renderStatus() {
  const token = selectedToken();
  const policy = attachedPolicy(token) ?? selectedPolicy();
  const eligible = eligibleInvestors(policy);

  document.querySelector("#networkLine").textContent = `${state.network.label} | chain ${state.network.chainId}`;
  document.querySelector("#tokenStatus").textContent = token ? `${token.name} ${shortAddress(token.address)}` : "Create an asset token";
  document.querySelector("#policyStatus").textContent = policy ? `${policy.name} #${policy.id}` : "Create or attach policy";
  document.querySelector("#managerStatus").textContent = state.manager ? `Operator ${shortAddress(state.manager.address)}` : "Deploy operator";
  document.querySelector("#investorStatus").textContent = `${eligible.length} eligible`;
}

function renderOverview() {
  const token = selectedToken();
  const policy = attachedPolicy(token);
  const checks = readinessChecks();
  const complete = checks.filter((check) => check.ok).length;

  workspacePanel.innerHTML = `
    <section class="hero-panel">
      <div>
        <span class="eyebrow">Issuer workspace</span>
        <h2>${escapeHtml(token?.name ?? "New Asset")}</h2>
        <p class="hero-line">${complete} of ${checks.length} operational checks complete</p>
      </div>
      <div class="hero-actions">
        <button class="primary" data-action="go-issue">Issue Asset</button>
        <button data-action="go-policy">Edit Compliance</button>
        <button data-action="go-sim">Run Simulation</button>
      </div>
    </section>

    <div class="section-grid">
      <section class="tool-section wide">
        <div class="section-heading">
          <div>
            <span class="label">Readiness</span>
            <h2>Operational setup</h2>
          </div>
          <span class="score-badge">${complete}/${checks.length}</span>
        </div>
        <div class="check-grid">
          ${checks.map((check) => readinessItem(check)).join("")}
        </div>
      </section>

      <section class="tool-section">
        <div class="section-heading">
          <div>
            <span class="label">Asset</span>
            <h2>Configuration</h2>
          </div>
        </div>
        ${keyValueList([
          ["Token", token ? `${token.name} ${shortAddress(token.address)}` : "Not created"],
          ["Settlement", token?.metadata?.quoteToken ? shortAddress(token.metadata.quoteToken) : "pathUSD"],
          ["Policy", policy ? `${policy.name} #${policy.id}` : "Not attached"],
          ["Operator", state.manager ? shortAddress(state.manager.address) : "Not deployed"],
        ])}
      </section>

      <section class="tool-section">
        <div class="section-heading">
          <div>
            <span class="label">Next Actions</span>
            <h2>Setup queue</h2>
          </div>
        </div>
        <div class="button-stack">
          ${!token ? `<button class="primary" data-action="go-admin">Create Asset Token</button>` : ""}
          ${!selectedPolicy() ? `<button class="primary" data-action="go-policy">Create Compliance Policy</button>` : ""}
          ${token && selectedPolicy() && !policy ? `<button class="primary" data-action="attach-default-policy">Attach Compliance Policy</button>` : ""}
          ${!state.manager ? `<button class="primary" data-action="manager-deploy">Deploy Operator</button>` : ""}
          ${state.manager ? `<button data-action="manager-roles">Check Operator Roles</button>` : ""}
          <button data-action="show-activity">Review Activity</button>
        </div>
      </section>

      <section class="tool-section wide">
        <div class="section-heading">
          <div>
            <span class="label">Recent Activity</span>
            <h2>Issuer receipts</h2>
          </div>
        </div>
        ${activityList(5)}
      </section>
    </div>
  `;

  bind("go-issue", () => switchView("operator"));
  bind("go-policy", () => switchView("compliance"));
  bind("go-sim", () => switchView("simulation"));
  bind("go-admin", () => switchView("admin"));
  bind("show-activity", () => switchView("activity"));
  bind("attach-default-policy", () => run("admin", "token", ["set-policy", selectedTokenName(), selectedPolicyName()]));
  bind("manager-deploy", () => run("admin", "manager", ["deploy"]));
  bind("manager-roles", () => run("admin", "token", ["roles", selectedTokenName(), "manager"]));
}

function renderAdmin() {
  const token = selectedToken();
  const policy = attachedPolicy(token);

  workspacePanel.innerHTML = `
    <div class="page-heading">
      <div>
        <span class="eyebrow">Asset administrator</span>
        <h2>Asset configuration</h2>
      </div>
      <div class="button-row">
        <button data-action="token-list">List Assets</button>
        <button data-action="token-inspect">Inspect Asset</button>
      </div>
    </div>

    <div class="section-grid">
      <section class="tool-section wide">
        <div class="section-heading">
          <div>
            <span class="label">Onboarding</span>
            <h2>Create asset token</h2>
          </div>
        </div>
        <div class="form-grid three">
          ${input("tokenSymbol", "Symbol", token ? nextDemoSymbol() : "USDV")}
          ${input("tokenName", "Asset Name", token ? "DemoDollar" : "USDV")}
          ${input("tokenCurrency", "Currency", "USD")}
          ${select("tokenQuote", "Settlement Token", [["pathUSD", "pathUSD"], ...tokenOptions()])}
          ${input("tokenSalt", "Salt", token ? "demo-dollar" : "usdv-poc")}
          ${select("tokenAdmin", "Administrator", profileOptions("admin"))}
          <button class="primary" data-action="create-token">Create Asset Token</button>
        </div>
      </section>

      <section class="tool-section">
        <div class="section-heading">
          <div>
            <span class="label">Compliance Attachment</span>
            <h2>Asset policy</h2>
          </div>
        </div>
        ${keyValueList([
          ["Current asset", token ? `${token.name} ${shortAddress(token.address)}` : "Not created"],
          ["Attached policy", policy ? `${policy.name} #${policy.id}` : "None"],
        ])}
        <div class="form-grid">
          ${select("configToken", "Asset", tokenOptions())}
          ${select("configPolicy", "Policy", policyOptions())}
          <button class="primary" data-action="attach-policy">Attach Policy</button>
          <button data-action="go-compliance">Open Policy Studio</button>
        </div>
      </section>

      <section class="tool-section">
        <div class="section-heading">
          <div>
            <span class="label">Permissions</span>
            <h2>TIP-20 roles</h2>
          </div>
        </div>
        <div class="form-grid">
          ${select("roleToken", "Asset", tokenOptions())}
          ${select("roleTarget", "Holder", roleTargetOptions())}
          ${select("roleName", "Role", [["issuer", "Issuer"], ["burn-blocked", "Burn"], ["pause", "Pause"], ["unpause", "Unpause"]])}
          <button class="primary" data-action="grant-role">Grant Role</button>
          <button data-action="revoke-role">Revoke Role</button>
          <button data-action="token-roles-manager">Check Operator Roles</button>
        </div>
      </section>

      <section class="tool-section wide">
        <div class="section-heading">
          <div>
            <span class="label">Operator Setup</span>
            <h2>Lifecycle contract</h2>
          </div>
        </div>
        <div class="button-row">
          <button data-action="manager-deploy">Deploy Operator</button>
          <button class="primary" data-action="manager-grant-roles">Grant Operational Roles</button>
          <button data-action="manager-allow-policy">Allow Operator In Policy</button>
          <button data-action="manager-faucet">Fund Operator Reserves</button>
          <button data-action="manager-inspect">Inspect Operator</button>
        </div>
      </section>
    </div>
  `;

  wireAdminActions();
  bind("go-compliance", () => switchView("compliance"));
}

function renderCompliance() {
  const policy = selectedPolicy();
  const policyDoc = policy ? policyDocument(policy) : {};

  workspacePanel.innerHTML = `
    <div class="page-heading">
      <div>
        <span class="eyebrow">Compliance control plane</span>
        <h2>Policy studio</h2>
      </div>
      <div class="button-row">
        <button data-action="policy-list">List Policies</button>
        <button data-action="policy-inspect">Inspect Policy</button>
      </div>
    </div>

    <div class="section-grid">
      <section class="tool-section wide">
        <div class="section-heading">
          <div>
            <span class="label">Policy Document</span>
            <h2>${escapeHtml(policy?.name ?? "No policy")}</h2>
          </div>
          ${policy ? `<span class="score-badge">#${escapeHtml(policy.id)}</span>` : ""}
        </div>
        <div class="policy-layout">
          <div class="policy-visual">
            ${policyVisual(policy)}
          </div>
          <pre class="json-view">${escapeHtml(JSON.stringify(policyDoc, null, 2))}</pre>
        </div>
      </section>

      <section class="tool-section">
        <div class="section-heading">
          <div>
            <span class="label">Create</span>
            <h2>New policy</h2>
          </div>
        </div>
        <div class="form-grid">
          ${input("policyName", "Policy Name", "usdv-kyc")}
          ${select("policyType", "Rule Type", [["whitelist", "Allow list"], ["blacklist", "Block list"]])}
          ${select("policyAdmin", "Policy Owner", profileOptions("admin"))}
          <button class="primary" data-action="create-policy">Create Policy</button>
        </div>
      </section>

      <section class="tool-section">
        <div class="section-heading">
          <div>
            <span class="label">Membership</span>
            <h2>Investor access</h2>
          </div>
        </div>
        <div class="form-grid">
          ${select("policyEditName", "Policy", simplePolicyOptions())}
          ${select("policyTarget", "Address", profileOptions("alice"))}
          <button class="primary" data-action="policy-allow">Allow</button>
          <button data-action="policy-remove">Remove</button>
          <button data-action="policy-block">Block</button>
          <button data-action="policy-unblock">Unblock</button>
          <button data-action="policy-check">Check</button>
        </div>
      </section>

      <section class="tool-section wide">
        <div class="section-heading">
          <div>
            <span class="label">Simulator</span>
            <h2>Policy decision preview</h2>
          </div>
        </div>
        <div class="simulator-grid">
          <div class="preview-card">
            <span class="label">Simple Policy</span>
            <h3>Address eligibility</h3>
            <div class="form-grid">
              ${select("simSimplePolicy", "Allow/Block Policy", simplePolicyOptions())}
              ${select("simSimpleTarget", "Address", profileOptions("alice"))}
              <button class="primary" data-action="simulate-simple-policy">Check Address</button>
              <button data-action="attach-simple-policy">Attach Simple Policy</button>
            </div>
          </div>
          <div class="preview-card">
            <span class="label">Compound Policy</span>
            <h3>Transfer / mint decision</h3>
            <div class="form-grid">
              ${select("simCompoundPolicy", "Compound Policy", compoundPolicyOptions())}
              ${select("simCompoundAction", "Action", [["transfer", "Transfer"], ["mint", "Mint"], ["redeem", "Redeem"]])}
              ${select("simCompoundSender", "Sender", profileOptions("alice"))}
              ${select("simCompoundRecipient", "Recipient", profileOptions("bob"))}
              <button class="primary" data-action="simulate-compound-policy">Preview Decision</button>
              <button data-action="attach-compound-policy">Attach Compound Policy</button>
            </div>
          </div>
        </div>
      </section>
    </div>
  `;

  wireComplianceActions();
}

function renderOperator() {
  const checks = readinessChecks();
  const token = selectedToken();

  workspacePanel.innerHTML = `
    <div class="page-heading">
      <div>
        <span class="eyebrow">Issuance operator</span>
        <h2>Lifecycle operations</h2>
      </div>
      <div class="button-row">
        <button data-action="manager-inspect">Inspect Operator</button>
        <button data-action="manager-roles">Check Roles</button>
        <button data-action="manager-balance">Balances</button>
      </div>
    </div>

    <div class="section-grid">
      <section class="tool-section wide">
        <div class="section-heading">
          <div>
            <span class="label">Readiness</span>
            <h2>Can the operator execute?</h2>
          </div>
        </div>
        <div class="check-grid">
          ${checks.map((check) => readinessItem(check)).join("")}
        </div>
      </section>

      <section class="tool-section">
        <div class="section-heading">
          <div>
            <span class="label">Reserves</span>
            <h2>Settlement capacity</h2>
          </div>
        </div>
        ${keyValueList([
          ["Operator", state.manager ? shortAddress(state.manager.address) : "Not deployed"],
          ["Settlement token", token?.metadata?.quoteToken ? shortAddress(token.metadata.quoteToken) : "pathUSD"],
          ["Managed asset", token?.name ?? "None"],
        ])}
        <div class="button-row">
          <button class="primary" data-action="manager-faucet">Fund Reserves</button>
          <button data-action="manager-balance">Check Balances</button>
        </div>
      </section>

      <section class="tool-section">
        <div class="section-heading">
          <div>
            <span class="label">Offchain Settlement</span>
            <h2>Admin issue</h2>
          </div>
        </div>
        <div class="form-grid">
          ${select("adminSubRecipient", "Investor", profileOptions("bob"))}
          ${input("adminSubAmount", "Amount", "5")}
          ${input("adminSubMemo", "Memo", "offchain-settlement")}
          <button class="primary" data-action="admin-subscribe">Issue Asset</button>
        </div>
      </section>

      <section class="tool-section wide">
        <div class="section-heading">
          <div>
            <span class="label">Execution Model</span>
            <h2>Lifecycle trace</h2>
          </div>
        </div>
        <div class="trace-grid">
          ${traceStep("1", "Investor approval", "Investor authorizes the operator to pull settlement tokens or asset tokens.")}
          ${traceStep("2", "Operator execution", "Operator collects funds, checks token permissions, then calls the asset token.")}
          ${traceStep("3", "Asset update", "TIP-20 mint or burn changes balances and total supply.")}
          ${traceStep("4", "Receipt", "The POC records transaction hashes and before/after balances.")}
        </div>
      </section>
    </div>
  `;

  wireOperatorActions();
}

function renderInvestors() {
  const policy = selectedSimplePolicy();
  const rows = investorAccounts().map((account) => [
    account.name,
    account.kind,
    html(`<span class="mono">${escapeHtml(account.address)}</span>`),
    memberStatus(account, policy),
    html(`<button data-balance="${escapeAttr(account.name)}">Balance</button>`),
  ]);

  workspacePanel.innerHTML = `
    <div class="page-heading">
      <div>
        <span class="eyebrow">Investor operations</span>
        <h2>Eligibility and balances</h2>
      </div>
      <div class="button-row">
        <button data-action="policy-list">Policy List</button>
        <button data-action="go-compliance">Policy Studio</button>
      </div>
    </div>

    <div class="section-grid">
      <section class="tool-section wide">
        ${table(["Investor", "Type", "Address", "Eligibility", "Action"], rows)}
      </section>

      <section class="tool-section">
        <div class="section-heading">
          <div>
            <span class="label">Eligibility</span>
            <h2>Manage access</h2>
          </div>
        </div>
        <div class="form-grid">
          ${select("investorPolicy", "Policy", simplePolicyOptions())}
          ${select("investorTarget", "Investor", profileOptions("alice"))}
          <button class="primary" data-action="investor-allow">Allow</button>
          <button data-action="investor-remove">Remove</button>
          <button data-action="investor-check">Check</button>
        </div>
      </section>

      <section class="tool-section">
        <div class="section-heading">
          <div>
            <span class="label">Balances</span>
            <h2>Account view</h2>
          </div>
        </div>
        <div class="form-grid">
          ${select("balanceTarget", "Account", profileOptions("alice"))}
          ${select("balanceAsset", "Asset", [["all", "All"], [selectedTokenName(), selectedTokenName()], ["pathUSD", "pathUSD"]])}
          <button class="primary" data-action="investor-balance">Check Balance</button>
        </div>
      </section>
    </div>
  `;

  bind("policy-list", () => run("admin", "policy", ["list"]));
  bind("go-compliance", () => switchView("compliance"));
  bind("investor-allow", () => run("admin", "policy", ["allow", value("investorTarget"), value("investorPolicy")]));
  bind("investor-remove", () => run("admin", "policy", ["remove", value("investorTarget"), value("investorPolicy")]));
  bind("investor-check", () => run("admin", "policy", ["check", value("investorTarget"), value("investorPolicy")]));
  bind("investor-balance", () => run("admin", "balance", balanceArgs(value("balanceTarget"), value("balanceAsset"))));

  document.querySelectorAll("[data-balance]").forEach((button) => {
    button.addEventListener("click", () => run("admin", "balance", [button.dataset.balance]));
  });
}

function renderSimulation() {
  const other = simulationActor === "alice" ? "bob" : "alice";

  workspacePanel.innerHTML = `
    <div class="page-heading">
      <div>
        <span class="eyebrow">Simulation mode</span>
        <h2>Act as ${capitalize(simulationActor)}</h2>
      </div>
      <div class="segmented">
        <button class="${simulationActor === "alice" ? "is-active" : ""}" data-sim="alice">Alice</button>
        <button class="${simulationActor === "bob" ? "is-active" : ""}" data-sim="bob">Bob</button>
      </div>
    </div>

    <div class="section-grid">
      <section class="tool-section">
        <div class="section-heading">
          <div>
            <span class="label">Wallet</span>
            <h2>${capitalize(simulationActor)} balances</h2>
          </div>
        </div>
        ${actorSummary(simulationActor)}
        <div class="button-row">
          <button class="primary" data-action="sim-balance">Balance</button>
          <button data-action="sim-history">History</button>
        </div>
      </section>

      <section class="tool-section">
        <div class="section-heading">
          <div>
            <span class="label">Primary Market</span>
            <h2>Subscribe / Redeem</h2>
          </div>
        </div>
        <div class="form-grid">
          ${input("subscribeAmount", "Subscribe Amount", "10")}
          <button class="primary" data-action="subscribe">Subscribe</button>
          ${input("redeemAmount", "Redeem Amount", "2")}
          <button data-action="redeem">Redeem</button>
        </div>
      </section>

      <section class="tool-section wide">
        <div class="section-heading">
          <div>
            <span class="label">Secondary Transfer</span>
            <h2>Send asset</h2>
          </div>
        </div>
        <div class="form-grid four">
          ${input("sendAmount", "Amount", "1")}
          ${select("sendToken", "Asset", [[selectedTokenName(), selectedTokenName()], ["pathUSD", "pathUSD"]])}
          ${select("sendTo", "Recipient", profileOptions(other))}
          ${input("sendMemo", "Memo", "invoice-001")}
          <button class="primary" data-action="send">Send</button>
        </div>
      </section>
    </div>
  `;

  document.querySelectorAll("[data-sim]").forEach((button) => {
    button.addEventListener("click", () => {
      simulationActor = button.dataset.sim;
      render();
    });
  });

  bind("sim-balance", () => run(simulationActor, "balance", []));
  bind("sim-history", () => run(simulationActor, "history", ["10"]));
  bind("subscribe", () => run(simulationActor, "subscribe", [value("subscribeAmount")]));
  bind("redeem", () => run(simulationActor, "redeem", [value("redeemAmount")]));
  bind("send", () => run(simulationActor, "send", [value("sendAmount"), value("sendToken"), "to", value("sendTo"), "--memo", value("sendMemo")]));
}

function renderActivity() {
  workspacePanel.innerHTML = `
    <div class="page-heading">
      <div>
        <span class="eyebrow">Audit trail</span>
        <h2>Issuer activity</h2>
      </div>
      <div class="button-row">
        <button data-action="refresh-activity">Refresh</button>
        <button data-action="admin-history">Admin History</button>
        <button data-action="alice-history">Alice History</button>
      </div>
    </div>

    <section class="tool-section wide">
      ${activityList(40)}
    </section>
  `;

  bind("refresh-activity", () => refreshState());
  bind("admin-history", () => run("admin", "history", ["10"]));
  bind("alice-history", () => run("alice", "history", ["10"]));
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
  bind("token-inspect", () => run("admin", "token", ["inspect", value("configToken") || selectedTokenName()]));
  bind("token-roles-manager", () => run("admin", "token", ["roles", value("roleToken") || selectedTokenName(), "manager"]));
  bind("grant-role", () => run("admin", "token", ["grant-role", value("roleToken"), value("roleTarget"), value("roleName")]));
  bind("revoke-role", () => run("admin", "token", ["revoke-role", value("roleToken"), value("roleTarget"), value("roleName")]));
  bind("manager-deploy", () => run("admin", "manager", ["deploy"]));
  bind("manager-grant-roles", () => run("admin", "manager", ["grant-operational-roles"]));
  bind("manager-allow-policy", () => run("admin", "manager", ["allow-policy", selectedSimplePolicyName()]));
  bind("manager-faucet", () => run("admin", "manager", ["faucet"]));
  bind("manager-inspect", () => run("admin", "manager", ["inspect"]));
}

function wireComplianceActions() {
  bind("policy-list", () => run("admin", "policy", ["list"]));
  bind("policy-inspect", () => run("admin", "policy", ["inspect", selectedPolicyName()]));
  bind("create-policy", () => {
    const args = ["create", value("policyName"), value("policyType")];
    const admin = value("policyAdmin");

    if (admin) {
      args.push("--admin", admin);
    }

    return run("admin", "policy", args);
  });
  bind("policy-allow", () => run("admin", "policy", ["allow", value("policyTarget"), value("policyEditName")]));
  bind("policy-remove", () => run("admin", "policy", ["remove", value("policyTarget"), value("policyEditName")]));
  bind("policy-block", () => run("admin", "policy", ["block", value("policyTarget"), value("policyEditName")]));
  bind("policy-unblock", () => run("admin", "policy", ["unblock", value("policyTarget"), value("policyEditName")]));
  bind("policy-check", () => run("admin", "policy", ["check", value("policyTarget"), value("policyEditName")]));
  bind("attach-simple-policy", () => run("admin", "token", ["set-policy", selectedTokenName(), value("simSimplePolicy")]));
  bind("attach-compound-policy", () => run("admin", "token", ["set-policy", selectedTokenName(), value("simCompoundPolicy")]));
  bind("simulate-simple-policy", () => run(
    "admin",
    "policy",
    ["check", value("simSimpleTarget"), value("simSimplePolicy")],
    `simulator> simple policy ${value("simSimplePolicy")} checks ${value("simSimpleTarget")}`,
  ));
  bind("simulate-compound-policy", async () => {
    const policy = value("simCompoundPolicy");
    const action = value("simCompoundAction");
    const sender = value("simCompoundSender");
    const recipient = value("simCompoundRecipient");

    if (action === "mint") {
      await run("admin", "policy", ["check", recipient, policy], `simulator> mint recipient ${recipient} under ${policy}`);
      return;
    }

    await run("admin", "policy", ["check", sender, policy], `simulator> ${action} sender ${sender} under ${policy}`);
    await run("admin", "policy", ["check", recipient, policy], `simulator> ${action} recipient ${recipient} under ${policy}`);
  });
}

function wireOperatorActions() {
  bind("manager-inspect", () => run("manager", "manager", ["inspect"]));
  bind("manager-roles", () => run("manager", "token", ["roles", selectedTokenName(), "manager"]));
  bind("manager-balance", () => run("manager", "balance", state.manager ? [state.manager.address] : ["manager"]));
  bind("manager-faucet", () => run("manager", "manager", ["faucet"]));
  bind("admin-subscribe", () => run("admin", "admin-subscribe", [value("adminSubRecipient"), value("adminSubAmount"), "--memo", value("adminSubMemo")]));
}

async function run(actor, command, args, label) {
  const heading = label ?? `${actor}> ${[command, ...args].join(" ")}`;

  try {
    const response = await fetch("/api/action", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ actor, command, args }),
    });
    const payload = await response.json();

    if (!payload.ok) {
      appendOutput(`${heading}\nError: ${payload.error ?? "Unknown error"}`);
      return;
    }

    appendOutput(payload.output ? `${heading}\n${payload.output}` : heading);
    state = payload.state;
    render();
  } catch (error) {
    appendOutput(`${heading}\nError: ${error.message}`);
  }
}

function switchView(view) {
  if (!views.includes(view)) return;

  activeView = view;
  document.querySelectorAll(".nav-button").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.view === view);
  });
  render();
}

function bind(action, handler) {
  document.querySelector(`[data-action="${action}"]`)?.addEventListener("click", handler);
}

function input(id, label, defaultValue) {
  return `<label>${label}<input id="${id}" value="${escapeAttr(defaultValue)}" /></label>`;
}

function select(id, label, options, selectedValue) {
  const items = options.length > 0 ? options : [["", "None"]];
  return `
    <label>${label}
      <select id="${id}">
        ${items.map(([value, text]) => {
          const selected = selectedValue === value ? " selected" : "";
          return `<option value="${escapeAttr(value)}"${selected}>${escapeHtml(text)}</option>`;
        }).join("")}
      </select>
    </label>
  `;
}

function readinessChecks() {
  const token = selectedToken();
  const policy = attachedPolicy(token);
  const simplePolicy = selectedSimplePolicy();
  const managerAllowed = state.manager && simplePolicy
    ? Object.values(simplePolicy.members).some((member) => sameAddress(member.address, state.manager.address) && member.included)
    : false;
  const eligible = eligibleInvestors(simplePolicy);

  return [
    {
      label: "Asset token",
      detail: token ? `${token.name} deployed` : "No token in local state",
      ok: Boolean(token),
    },
    {
      label: "Compliance policy",
      detail: policy ? `${policy.name} attached` : "No transfer policy attached",
      ok: Boolean(policy),
    },
    {
      label: "Operator contract",
      detail: state.manager ? shortAddress(state.manager.address) : "No operator deployment",
      ok: Boolean(state.manager),
    },
    {
      label: "Operator roles",
      detail: state.manager?.metadata?.issuerRoleTx ? "Issuer role recorded" : "Run role check or grant roles",
      ok: Boolean(state.manager?.metadata?.issuerRoleTx),
    },
    {
      label: "Operator eligibility",
      detail: managerAllowed ? "Operator is policy-eligible" : "Operator is not recorded in policy",
      ok: Boolean(managerAllowed),
    },
    {
      label: "Investors",
      detail: `${eligible.length} eligible investor${eligible.length === 1 ? "" : "s"}`,
      ok: eligible.length > 0,
    },
  ];
}

function readinessItem(check) {
  return `
    <div class="check-item ${check.ok ? "is-ok" : "is-warn"}">
      <span class="check-dot"></span>
      <div>
        <strong>${escapeHtml(check.label)}</strong>
        <p>${escapeHtml(check.detail)}</p>
      </div>
    </div>
  `;
}

function policyVisual(policy) {
  if (!policy) {
    return `<p class="muted">No policy selected.</p>`;
  }

  if (policy.type === "compound") {
    const rules = [
      ["Sender Rule", policy.compound?.senderPolicyName, policy.compound?.senderPolicyId],
      ["Recipient Rule", policy.compound?.recipientPolicyName, policy.compound?.recipientPolicyId],
      ["Mint Recipient Rule", policy.compound?.mintRecipientPolicyName, policy.compound?.mintRecipientPolicyId],
    ];

    return `
      <div class="rule-stack">
        ${rules.map(([label, name, id]) => `
          <div class="rule-row">
            <span>${escapeHtml(label)}</span>
            <strong>${escapeHtml(name ?? "unknown")}</strong>
            <code>#${escapeHtml(id ?? "unknown")}</code>
          </div>
        `).join("")}
      </div>
    `;
  }

  const members = Object.values(policy.members);
  const included = members.filter((member) => member.included);
  const mode = policy.type === "whitelist" ? "Allowed addresses" : "Blocked addresses";

  return `
    <div class="rule-stack">
      <div class="rule-row">
        <span>Rule Type</span>
        <strong>${policy.type === "whitelist" ? "Allow list" : "Block list"}</strong>
        <code>#${escapeHtml(policy.id)}</code>
      </div>
      <div class="member-list">
        <span class="label">${mode}</span>
        ${included.length === 0 ? `<p class="muted">No addresses recorded.</p>` : included.map((member) => `
          <div class="member-line">
            <strong>${escapeHtml(member.name)}</strong>
            <span class="mono">${escapeHtml(shortAddress(member.address))}</span>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

function policyDocument(policy) {
  const attachedTo = state.tokens
    .filter((token) => token.metadata?.transferPolicy === policy.name || token.metadata?.transferPolicyId === policy.id)
    .map((token) => token.name);

  if (policy.type === "compound") {
    return {
      name: policy.name,
      policyId: policy.id,
      type: "compound",
      rules: {
        sender: childPolicyDocument(policy.compound?.senderPolicyName, policy.compound?.senderPolicyId),
        recipient: childPolicyDocument(policy.compound?.recipientPolicyName, policy.compound?.recipientPolicyId),
        mintRecipient: childPolicyDocument(policy.compound?.mintRecipientPolicyName, policy.compound?.mintRecipientPolicyId),
      },
      attachedTo,
    };
  }

  const included = Object.values(policy.members).filter((member) => member.included);

  return {
    name: policy.name,
    policyId: policy.id,
    type: policy.type,
    mode: policy.type === "whitelist" ? "allowlist" : "blocklist",
    owner: policy.admin,
    members: included.map((member) => ({
      name: member.name,
      address: member.address,
    })),
    attachedTo,
  };
}

function childPolicyDocument(name, id) {
  const policy = state.policies.find((item) => item.name === name || item.id === id);

  return {
    policy: name ?? "unknown",
    policyId: id ?? "unknown",
    mode: policy?.type === "blacklist" ? "blocklist" : "allowlist",
  };
}

function traceStep(number, title, detail) {
  return `
    <div class="trace-step">
      <span>${number}</span>
      <strong>${escapeHtml(title)}</strong>
      <p>${escapeHtml(detail)}</p>
    </div>
  `;
}

function activityList(limit) {
  const entries = (state.activity ?? []).slice(0, limit);

  if (entries.length === 0) {
    return `<p class="muted">No activity recorded yet.</p>`;
  }

  return `
    <div class="activity-list">
      ${entries.map((entry) => `
        <article class="activity-item">
          <div>
            <span class="activity-meta">${escapeHtml(formatDate(entry.createdAt))} | ${escapeHtml(entry.profile ?? entry.sessionId)}</span>
            <strong>${escapeHtml(entry.summary)}</strong>
            <p>${escapeHtml(entry.action)} | ${escapeHtml(entry.status)}</p>
          </div>
          <div class="tx-list">
            ${(entry.txs ?? []).map((tx) => `<code>${escapeHtml(tx.label)} ${escapeHtml(shortAddress(tx.hash))}</code>`).join("")}
          </div>
        </article>
      `).join("")}
    </div>
  `;
}

function actorSummary(actor) {
  const account = state.accounts.find((item) => item.name === actor);

  if (!account) {
    return `<p class="muted">Profile not found.</p>`;
  }

  return keyValueList([
    ["Profile", account.name],
    ["Address", shortAddress(account.address)],
    ["Role", account.kind],
  ]);
}

function keyValueList(rows) {
  return `
    <dl class="kv-list">
      ${rows.map(([key, val]) => `
        <div>
          <dt>${escapeHtml(key)}</dt>
          <dd>${escapeHtml(val)}</dd>
        </div>
      `).join("")}
    </dl>
  `;
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

function appendOutput(text) {
  output.textContent = output.textContent === "Ready." ? text.trimStart() : `${text.trimStart()}\n\n${output.textContent}`;
  output.scrollTop = 0;
}

function tokenOptions() {
  return state.tokens.map((token) => [token.name, token.name]);
}

function policyOptions() {
  return state.policies.map((policy) => [policy.name, `${policy.name} #${policy.id}`]);
}

function simplePolicyOptions() {
  return state.policies
    .filter((policy) => policy.type !== "compound")
    .map((policy) => [policy.name, `${policy.name} #${policy.id}`]);
}

function compoundPolicyOptions() {
  return state.policies
    .filter((policy) => policy.type === "compound")
    .map((policy) => [policy.name, `${policy.name} #${policy.id}`]);
}

function profileOptions(defaultName) {
  const names = ["admin", "alice", "bob", "treasury", "policyadmin"];
  const accounts = state.accounts.filter((account) => names.includes(account.name));
  const ordered = [...accounts].sort((left, right) => {
    if (left.name === defaultName) return -1;
    if (right.name === defaultName) return 1;
    return left.name.localeCompare(right.name);
  });

  return ordered.map((account) => [account.name, capitalize(account.name)]);
}

function roleTargetOptions() {
  const options = state.manager ? [["manager", "Operator Contract"]] : [];
  return [...options, ...profileOptions("admin")];
}

function investorAccounts() {
  return state.accounts.filter((account) => ["user", "treasury"].includes(account.kind));
}

function selectedToken() {
  return state.tokens.find((token) => token.name === "USDV") ?? state.tokens[0];
}

function selectedTokenName() {
  return selectedToken()?.name ?? "USDV";
}

function selectedPolicy() {
  const tokenPolicy = attachedPolicy(selectedToken());
  return tokenPolicy ?? state.policies.find((policy) => policy.name === "usdv-kyc") ?? state.policies[0];
}

function selectedPolicyName() {
  return selectedPolicy()?.name ?? "";
}

function selectedSimplePolicy() {
  const attached = selectedPolicy();

  if (attached?.type !== "compound") {
    return attached;
  }

  return state.policies.find((policy) => policy.name === attached.compound?.senderPolicyName)
    ?? state.policies.find((policy) => policy.type !== "compound");
}

function selectedSimplePolicyName() {
  return selectedSimplePolicy()?.name ?? "";
}

function attachedPolicy(token) {
  if (!token) return undefined;

  const name = token.metadata?.transferPolicy;
  const id = token.metadata?.transferPolicyId;
  return state.policies.find((policy) => policy.name === name || policy.id === id);
}

function eligibleInvestors(policy) {
  if (!policy) return [];

  const simple = policy.type === "compound"
    ? state.policies.find((item) => item.name === policy.compound?.mintRecipientPolicyName) ?? selectedSimplePolicy()
    : policy;

  if (!simple) return [];

  return investorAccounts().filter((account) => {
    const member = Object.values(simple.members).find((item) => sameAddress(item.address, account.address));
    return simple.type === "whitelist" ? Boolean(member?.included) : !member?.included;
  });
}

function memberStatus(account, policy) {
  if (!policy) return "No policy";

  const member = Object.values(policy.members).find((item) => sameAddress(item.address, account.address));

  if (policy.type === "whitelist") {
    return member?.included ? "Eligible" : "Not eligible";
  }

  return member?.included ? "Blocked" : "Allowed";
}

function balanceArgs(target, asset) {
  if (!asset || asset === "all") {
    return [target];
  }

  return [target, asset];
}

function nextDemoSymbol() {
  let index = state.tokens.length + 1;
  let symbol = `DEMO${index}`;

  while (state.tokens.some((token) => token.name === symbol)) {
    index += 1;
    symbol = `DEMO${index}`;
  }

  return symbol;
}

function value(id) {
  return document.querySelector(`#${id}`)?.value ?? "";
}

function sameAddress(left, right) {
  return String(left).toLowerCase() === String(right).toLowerCase();
}

function shortAddress(address) {
  if (!address) return "unknown";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatDate(value) {
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
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
