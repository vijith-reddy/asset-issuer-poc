const views = ["admin", "operator", "users", "activity"];
let activeView = "admin";
let adminTab = "policies";
let operatorTab = "supply";
let userActor = "alice";
let state = null;
let receiptCount = 0;

const output = document.querySelector("#output");
const workspacePanel = document.querySelector("#workspacePanel");
const refreshButton = document.querySelector("#refreshButton");
const clearOutputButton = document.querySelector("#clearOutputButton");

document.querySelectorAll(".nav-button").forEach((button) => {
  button.addEventListener("click", () => {
    switchView(button.dataset.view);
  });
});

refreshButton.addEventListener("click", async () => {
  await refreshState();
  appendOutput("workspace refreshed");
});

clearOutputButton.addEventListener("click", () => {
  output.innerHTML = `<div class="receipt-empty">Receipts will appear here after an action runs.</div>`;
  receiptCount = 0;
});

output.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-copy]");

  if (!button) return;

  await navigator.clipboard?.writeText(button.dataset.copy);
  button.textContent = "Copied";
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

  if (activeView === "admin") renderAdmin();
  if (activeView === "operator") renderOperator();
  if (activeView === "users") renderUsers();
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

function renderAdmin() {
  const token = selectedToken();
  const policy = attachedPolicy(token);

  workspacePanel.innerHTML = `
    <div class="page-heading">
      <div>
        <span class="eyebrow">Issuer admin</span>
        <h2>Configure asset, policy, and roles</h2>
      </div>
      <div class="button-row">
        <button data-action="token-inspect">Inspect Asset</button>
        <button data-action="policy-inspect">Inspect Policy</button>
      </div>
    </div>

    ${subnav("admin", [
      ["asset", "Asset"],
      ["policies", "Attach Policy"],
      ["roles", "TIP-20 Roles"],
    ], adminTab)}

    ${adminTab === "asset" ? renderAdminAssetTab(token, policy) : ""}
    ${adminTab === "policies" ? renderAdminPoliciesTab(token, policy) : ""}
    ${adminTab === "roles" ? renderAdminRolesTab(token) : ""}
  `;

  wireAdminActions();
  wireComplianceActions();
  wireAdminTabs();
}

function renderAdminAssetTab(token, policy) {
  return `
    <div class="section-grid">
      <section class="tool-section">
        <div class="section-heading">
          <div>
            <span class="label">Asset In Use</span>
            <h2>${escapeHtml(token?.name ?? "No token")}</h2>
          </div>
          ${token ? `<span class="score-badge">${escapeHtml(shortAddress(token.address))}</span>` : ""}
        </div>
        ${keyValueList([
          ["Token", token ? `${token.name} ${shortAddress(token.address)}` : "Not created"],
          ["Currency", token?.metadata?.currency ?? "USD"],
          ["Settlement", token?.metadata?.quoteToken ? shortAddress(token.metadata.quoteToken) : "pathUSD"],
          ["Policy", policy ? `${policy.name} #${policy.id}` : "None"],
          ["Admin", token?.metadata?.admin ?? "admin"],
        ])}
        <div class="button-row">
          <button data-action="token-list">List Assets</button>
          <button class="primary" data-action="token-inspect">Inspect Asset</button>
        </div>
      </section>

      <section class="tool-section wide">
        <div class="section-heading">
          <div>
            <span class="label">Create Token</span>
            <h2>New TIP-20 asset</h2>
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
    </div>
  `;
}

function renderAdminPoliciesTab(token, policy) {
  const policyDoc = policy ? policyDocument(policy) : {};

  return `
    <div class="section-grid">
      <section class="tool-section">
        <div class="section-heading">
          <div>
            <span class="label">Policy In Use</span>
            <h2>${escapeHtml(policy?.name ?? "No policy attached")}</h2>
          </div>
          ${policy ? `<span class="score-badge">#${escapeHtml(policy.id)}</span>` : ""}
        </div>
        ${keyValueList([
          ["Current asset", token ? `${token.name} ${shortAddress(token.address)}` : "Not created"],
          ["Attached policy", policy ? `${policy.name} #${policy.id}` : "None"],
          ["Policy type", policy ? policy.type : "None"],
          ["Owner", policy?.admin ?? "None"],
        ])}
        <div class="form-grid">
          ${select("configToken", "Asset", tokenOptions())}
          ${select("configPolicy", "Policy", policyOptions())}
          <button class="primary" data-action="attach-policy">Attach Policy</button>
          <button data-action="policy-list">List Policies</button>
        </div>
      </section>

      <section class="tool-section">
        <div class="section-heading">
          <div>
            <span class="label">Create Policy</span>
            <h2>New TIP-403 rule</h2>
          </div>
        </div>
        <div class="form-grid">
          ${input("policyName", "Policy Name", suggestedPolicyName())}
          ${select("policyType", "Rule Type", [["whitelist", "Allow list"], ["blacklist", "Block list"]])}
          ${select("policyAdmin", "Policy Owner", profileOptions("admin"))}
          <button class="primary" data-action="create-policy">Create Policy</button>
          <button data-action="policy-inspect">Inspect Policy</button>
        </div>
      </section>

      <section class="tool-section wide">
        <div class="section-heading">
          <div>
            <span class="label">Policy Document</span>
            <h2>Readable rule set</h2>
          </div>
        </div>
        <div class="policy-layout">
          <div class="policy-visual">
            ${policyVisual(policy)}
          </div>
          <pre class="json-view">${escapeHtml(JSON.stringify(policyDoc, null, 2))}</pre>
        </div>
      </section>

      <section class="tool-section wide">
        <div class="section-heading">
          <div>
            <span class="label">Membership</span>
            <h2>Address eligibility</h2>
          </div>
        </div>
        <div class="form-grid four">
          ${select("policyEditName", "Policy", simplePolicyOptions())}
          ${select("policyTarget", "Address", profileOptions("alice"))}
          <button class="primary" data-action="policy-allow">Allow</button>
          <button data-action="policy-remove">Remove</button>
          <button data-action="policy-block">Block</button>
          <button data-action="policy-unblock">Unblock</button>
          <button data-action="policy-check">Check</button>
        </div>
      </section>
    </div>
  `;
}

function renderAdminRolesTab(token) {
  return `
    <div class="section-grid">
      <section class="tool-section wide">
        <div class="section-heading">
          <div>
            <span class="label">Role Permissions</span>
            <h2>TIP-20 access control</h2>
          </div>
          <button data-action="token-roles-manager">Check Operator Roles</button>
        </div>
        ${table(["Role", "What It Controls", "Operator Status"], roleRows(token))}
      </section>

      <section class="tool-section">
        <div class="section-heading">
          <div>
            <span class="label">Grant / Revoke</span>
            <h2>Assign role holder</h2>
          </div>
        </div>
        <div class="form-grid">
          ${select("roleToken", "Asset", tokenOptions())}
          ${select("roleTarget", "Holder", roleTargetOptions())}
          ${select("roleName", "Role", tip20RoleOptions())}
          <button class="primary" data-action="grant-role">Grant Role</button>
          <button data-action="revoke-role">Revoke Role</button>
        </div>
      </section>

      <section class="tool-section">
        <div class="section-heading">
          <div>
            <span class="label">Operator Setup</span>
            <h2>Manager contract</h2>
          </div>
        </div>
        ${keyValueList([
          ["Operator", state.manager ? shortAddress(state.manager.address) : "Not deployed"],
          ["Signer", "Admin"],
          ["Role bundle", "issuer, burn, pause, unpause"],
        ])}
        <div class="button-stack">
          <button data-action="manager-deploy">Deploy Operator</button>
          <button class="primary" data-action="manager-grant-roles">Grant Operational Roles</button>
          <button data-action="manager-allow-policy">Allow Operator In Policy</button>
          <button data-action="manager-inspect">Inspect Operator</button>
        </div>
      </section>
    </div>
  `;
}

function wireAdminTabs() {
  document.querySelectorAll("[data-admin-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      adminTab = button.dataset.adminTab;
      render();
    });
  });
}

function renderOperator() {
  const token = selectedToken();

  workspacePanel.innerHTML = `
    <div class="page-heading">
      <div>
        <span class="eyebrow">Issuance operator</span>
        <h2>Manage supply lifecycle</h2>
      </div>
      <div class="button-row">
        <button data-action="manager-inspect">Inspect Operator</button>
        <button data-action="manager-roles">Check Roles</button>
        <button data-action="manager-balance">Check Balances</button>
      </div>
    </div>

    ${subnav("operator", [
      ["permissions", "Roles"],
      ["supply", "Supply Operations"],
      ["reserves", "Reserves"],
    ], operatorTab)}

    ${operatorTab === "permissions" ? renderOperatorPermissionsTab(token) : ""}
    ${operatorTab === "supply" ? renderOperatorSupplyTab(token) : ""}
    ${operatorTab === "reserves" ? renderOperatorReservesTab(token) : ""}
  `;

  wireOperatorActions();
  wireOperatorTabs();
}

function renderOperatorPermissionsTab(token) {
  const checks = readinessChecks();

  return `
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

      <section class="tool-section wide">
        <div class="section-heading">
          <div>
            <span class="label">Role Permissions</span>
            <h2>Operator grants</h2>
          </div>
          <button data-action="manager-roles">List Role Permissions</button>
        </div>
        ${table(["Role", "What It Controls", "Operator Status"], roleRows(token))}
      </section>

      <section class="tool-section">
        <div class="section-heading">
          <div>
            <span class="label">Role Setup</span>
            <h2>Operator permissions</h2>
          </div>
        </div>
        ${keyValueList([
          ["Signer", "Admin"],
          ["Target", state.manager ? shortAddress(state.manager.address) : "Operator not deployed"],
          ["Bundle", "issuer, burn, pause, unpause"],
        ])}
        <div class="form-grid">
          ${select("operatorRoleName", "Role", tip20RoleOptions())}
          <button class="primary" data-action="operator-grant-role">Grant Selected Role</button>
          <button data-action="operator-grant-roles">Grant Operational Roles</button>
          <button data-action="operator-allow-policy">Allow In Policy</button>
        </div>
      </section>

      <section class="tool-section">
        <div class="section-heading">
          <div>
            <span class="label">Operator Contract</span>
            <h2>Deployment</h2>
          </div>
        </div>
        ${keyValueList([
          ["Address", state.manager ? shortAddress(state.manager.address) : "Not deployed"],
          ["Admin", state.manager?.metadata?.admin ?? "admin"],
          ["Managed asset", token?.name ?? "None"],
        ])}
        <div class="button-stack">
          <button data-action="manager-deploy">Deploy Operator</button>
          <button class="primary" data-action="manager-inspect">Inspect Operator</button>
        </div>
      </section>
    </div>
  `;
}

function renderOperatorSupplyTab(token) {
  return `
    <div class="section-grid">
      <section class="tool-section">
        <div class="section-heading">
          <div>
            <span class="label">Increase Supply</span>
            <h2>Offline subscribe</h2>
          </div>
          <span class="score-badge">Admin-signed</span>
        </div>
        <div class="form-grid">
          ${select("adminSubRecipient", "Investor", profileOptions("bob"))}
          ${input("adminSubAmount", "Amount", "5")}
          ${input("adminSubMemo", "Memo", "offchain-settlement")}
          <button class="primary" data-action="admin-subscribe">Issue Asset</button>
        </div>
      </section>

      <section class="tool-section">
        <div class="section-heading">
          <div>
            <span class="label">Decrease Supply</span>
            <h2>Redeem asset</h2>
          </div>
          <span class="score-badge">Investor-signed</span>
        </div>
        <div class="form-grid">
          ${select("operatorRedeemInvestor", "Investor", profileOptions("bob"))}
          ${input("operatorRedeemAmount", "Amount", "2")}
          <button class="primary" data-action="operator-redeem">Redeem Asset</button>
          <button data-action="operator-user-balance">Check Investor Balance</button>
        </div>
      </section>

      <section class="tool-section wide">
        <div class="section-heading">
          <div>
            <span class="label">Supply State</span>
            <h2>${escapeHtml(token?.name ?? "Asset")} lifecycle</h2>
          </div>
        </div>
        <div class="trace-grid">
          ${traceStep("1", "Offline order", "Admin records completed settlement and selects an investor recipient.")}
          ${traceStep("2", "Operator mint", "Manager contract calls TIP-20 mintWithMemo using its issuer permission.")}
          ${traceStep("3", "Investor redeem", "Investor approves USDV and manager burns through burnWithMemo.")}
          ${traceStep("4", "Supply receipt", "Each action returns total supply and balance deltas.")}
        </div>
      </section>
    </div>
  `;
}

function renderOperatorReservesTab(token) {
  return `
    <div class="section-grid">
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

      <section class="tool-section wide">
        <div class="section-heading">
          <div>
            <span class="label">Reserve Model</span>
            <h2>Current balances</h2>
          </div>
        </div>
        <div class="trace-grid">
          ${traceStep("1", "pathUSD reserve", "Manager holds settlement tokens used for redemption payouts.")}
          ${traceStep("2", "USDV reserve", "Manager may temporarily receive USDV before burn during redeem.")}
          ${traceStep("3", "Faucet", "Testnet funding tops up operator settlement capacity.")}
          ${traceStep("4", "Balance check", "Reads USDV and pathUSD balances for the manager contract.")}
        </div>
      </section>
    </div>
  `;
}

function wireOperatorTabs() {
  document.querySelectorAll("[data-operator-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      operatorTab = button.dataset.operatorTab;
      render();
    });
  });
}

function renderUsers() {
  const other = userActor === "alice" ? "bob" : "alice";
  const policy = selectedSimplePolicy();
  const actorAccount = state.accounts.find((account) => account.name === userActor);

  workspacePanel.innerHTML = `
    <div class="page-heading">
      <div>
        <span class="eyebrow">User accounts</span>
        <h2>${capitalize(userActor)} workspace</h2>
      </div>
      <div class="segmented">
        <button class="${userActor === "alice" ? "is-active" : ""}" data-user-actor="alice">Alice</button>
        <button class="${userActor === "bob" ? "is-active" : ""}" data-user-actor="bob">Bob</button>
      </div>
    </div>

    <div class="section-grid">
      <section class="tool-section">
        <div class="section-heading">
          <div>
            <span class="label">Account</span>
            <h2>${capitalize(userActor)}</h2>
          </div>
          <span class="score-badge">${escapeHtml(memberStatus(actorAccount, policy))}</span>
        </div>
        ${actorSummary(userActor)}
        <div class="button-row">
          <button class="primary" data-action="user-balance">Check Balances</button>
          <button data-action="user-history">History</button>
          <button data-action="user-policy-check">Check Policy</button>
        </div>
      </section>

      <section class="tool-section">
        <div class="section-heading">
          <div>
            <span class="label">Primary Market</span>
            <h2>Subscribe / redeem</h2>
          </div>
        </div>
        <div class="form-grid">
          ${input("userSubscribeAmount", "Subscribe Amount", "10")}
          <button class="primary" data-action="user-subscribe">Subscribe</button>
          ${input("userRedeemAmount", "Redeem Amount", "2")}
          <button data-action="user-redeem">Redeem</button>
        </div>
      </section>

      <section class="tool-section wide">
        <div class="section-heading">
          <div>
            <span class="label">Transfer</span>
            <h2>Send asset</h2>
          </div>
        </div>
        <div class="form-grid four">
          ${input("userSendAmount", "Amount", "1")}
          ${select("userSendToken", "Asset", [[selectedTokenName(), selectedTokenName()], ["pathUSD", "pathUSD"]])}
          ${select("userSendTo", "Recipient", profileOptions(other))}
          ${input("userSendMemo", "Memo", "invoice-001")}
          <button class="primary" data-action="user-send">Send</button>
        </div>
      </section>

      <section class="tool-section wide">
        <div class="section-heading">
          <div>
            <span class="label">User Directory</span>
            <h2>Alice and Bob</h2>
          </div>
        </div>
        ${table(["User", "Address", "Policy Status", "Action"], userRows(policy))}
      </section>
    </div>
  `;

  wireUserActions();
}

function wireUserActions() {
  document.querySelectorAll("[data-user-actor]").forEach((button) => {
    button.addEventListener("click", () => {
      userActor = button.dataset.userActor;
      render();
    });
  });

  bind("user-balance", () => run(userActor, "balance", []));
  bind("user-history", () => run(userActor, "history", ["10"]));
  bind("user-policy-check", () => run("admin", "policy", ["check", userActor, selectedSimplePolicyName()]));
  bind("user-subscribe", () => run(userActor, "subscribe", [value("userSubscribeAmount")]));
  bind("user-redeem", () => run(userActor, "redeem", [value("userRedeemAmount")]));
  bind("user-send", () => run(userActor, "send", [value("userSendAmount"), value("userSendToken"), "to", value("userSendTo"), "--memo", value("userSendMemo")]));

  document.querySelectorAll("[data-user-balance]").forEach((button) => {
    button.addEventListener("click", () => run(button.dataset.userBalance, "balance", []));
  });
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
        <button data-action="bob-history">Bob History</button>
      </div>
    </div>

    <section class="tool-section wide">
      ${activityList(40)}
    </section>
  `;

  bind("refresh-activity", () => refreshState());
  bind("admin-history", () => run("admin", "history", ["10"]));
  bind("alice-history", () => run("alice", "history", ["10"]));
  bind("bob-history", () => run("bob", "history", ["10"]));
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
  bind("operator-grant-role", () => run("admin", "token", ["grant-role", selectedTokenName(), "manager", value("operatorRoleName")]));
  bind("operator-grant-roles", () => run("admin", "manager", ["grant-operational-roles"]));
  bind("operator-allow-policy", () => run("admin", "manager", ["allow-policy", selectedSimplePolicyName()]));
  bind("admin-subscribe", () => run("admin", "admin-subscribe", [value("adminSubRecipient"), value("adminSubAmount"), "--memo", value("adminSubMemo")]));
  bind("operator-redeem", () => run(value("operatorRedeemInvestor"), "redeem", [value("operatorRedeemAmount")]));
  bind("operator-user-balance", () => run(value("operatorRedeemInvestor"), "balance", []));
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
  document.querySelectorAll(`[data-action="${action}"]`).forEach((button) => {
    button.addEventListener("click", handler);
  });
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

function subnav(scope, tabs, active) {
  return `
    <div class="subnav" aria-label="${escapeAttr(scope)} sections">
      ${tabs.map(([id, label]) => `
        <button type="button" class="${active === id ? "is-active" : ""}" data-${escapeAttr(scope)}-tab="${escapeAttr(id)}">
          ${escapeHtml(label)}
        </button>
      `).join("")}
    </div>
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

function tip20RoleOptions() {
  return tip20Roles().map((role) => [role.id, role.label]);
}

function tip20Roles() {
  return [
    { id: "issuer", label: "Issuer", detail: "Mint asset supply" },
    { id: "burn-blocked", label: "Burn", detail: "Burn asset supply" },
    { id: "pause", label: "Pause", detail: "Pause token activity" },
    { id: "unpause", label: "Unpause", detail: "Resume token activity" },
  ];
}

function roleRows(token) {
  return tip20Roles().map((role) => [
    role.label,
    role.detail,
    roleStatus(role.id, token),
  ]);
}

function roleStatus(role, token) {
  if (!state.manager) {
    return "Operator not deployed";
  }

  const metadata = token?.metadata ?? {};
  const bundle = metadata.managerOperationalRoles ?? state.manager?.metadata?.operationalRoles ?? "";
  const directStatus = metadata[`role.${role}.manager.status`];

  if (directStatus === "granted" || bundle.split(",").includes(role)) {
    return "Granted to operator";
  }

  return "Not recorded";
}

function userRows(policy) {
  return ["alice", "bob"].map((name) => {
    const account = state.accounts.find((item) => item.name === name);

    return [
      capitalize(name),
      html(`<span class="mono">${escapeHtml(account ? shortAddress(account.address) : "missing")}</span>`),
      memberStatus(account, policy),
      html(`<button data-user-balance="${escapeAttr(name)}">Balance</button>`),
    ];
  });
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
  if (receiptCount === 0) {
    output.innerHTML = "";
  }

  output.insertAdjacentHTML("afterbegin", receiptCard(parseReceipt(text)));
  receiptCount += 1;
  output.scrollTop = 0;
}

function parseReceipt(text) {
  const raw = text.trim();
  const [heading = "Action", ...rest] = raw.split("\n");
  const lines = rest.map((line) => line.trimEnd()).filter(Boolean);
  const hasError = [heading, ...lines].some((line) => isErrorLine(line.trim()));
  const txs = [];
  const balances = [];
  const flow = [];
  const details = [];
  let inTrace = false;

  for (const line of lines) {
    if (line.trim() === "trace:") {
      inTrace = true;
      continue;
    }

    if (isTraceLine(line, inTrace)) {
      flow.push(line.trim());
      continue;
    }

    const tx = parseTransactionLine(line);

    if (tx) {
      txs.push(tx);
      continue;
    }

    if (/balance|USDV:|pathUSD:|total supply|->/.test(line)) {
      balances.push(line.trim());
      continue;
    }

    details.push(line.trim());
  }

  return {
    title: receiptTitle(heading),
    command: heading,
    status: hasError ? "Error" : "Success",
    summary: details[0] ?? balances[0] ?? flow[0] ?? heading,
    details: details.slice(1, 7),
    balances,
    flow,
    txs,
    raw,
  };
}

function isErrorLine(line) {
  return /^Error\b:?/i.test(line)
    || /^execution reverted\b/i.test(line)
    || /^Details:\s*execution reverted\b/i.test(line)
    || /^failed\b/i.test(line)
    || /not authorized/i.test(line);
}

function isTraceLine(line, inTrace) {
  const trimmed = line.trim();

  return /^\s*(\d+\.|-)\s+/.test(line)
    || (inTrace && /^\s+/.test(line) && trimmed !== "");
}

function parseTransactionLine(line) {
  const tx = line.match(/^\s*([^:]+):\s*(0x[a-fA-F0-9]{64})$/);

  if (!tx) return undefined;

  const label = tx[1].trim();

  if (!isTransactionLabel(label)) return undefined;

  return { label, hash: tx[2] };
}

function isTransactionLabel(label) {
  const normalized = label.toLowerCase();

  if (normalized === "tx" || normalized.endsWith(" tx")) return true;

  return /transaction|transfer|approve|subscribe|redeem|grant|create|modify|change|mint|burn/.test(normalized);
}

function receiptCard(receipt) {
  return `
    <article class="receipt-card ${receipt.status === "Error" ? "is-error" : "is-success"}">
      <div class="receipt-card-header">
        <div>
          <span class="receipt-command">${escapeHtml(receipt.command)}</span>
          <h3>${escapeHtml(receipt.title)}</h3>
        </div>
        <span class="receipt-status">${escapeHtml(receipt.status)}</span>
      </div>
      <p class="receipt-summary">${escapeHtml(receipt.summary)}</p>
      ${receipt.txs.length > 0 ? receiptSection("Transactions", receipt.txs.map((tx) => `
        <div class="receipt-tx">
          <span>${escapeHtml(tx.label)}</span>
          <code>${escapeHtml(shortAddress(tx.hash))}</code>
          <button type="button" data-copy="${escapeAttr(tx.hash)}">Copy</button>
        </div>
      `).join("")) : ""}
      ${receipt.flow.length > 0 ? receiptSection("Flow", orderedLines(receipt.flow)) : ""}
      ${receipt.balances.length > 0 ? receiptSection("Balances", plainLines(receipt.balances)) : ""}
      ${receipt.details.length > 0 ? receiptSection("Details", plainLines(receipt.details)) : ""}
      <details class="raw-receipt">
        <summary>Raw output</summary>
        <pre>${escapeHtml(receipt.raw)}</pre>
      </details>
    </article>
  `;
}

function receiptSection(title, content) {
  return `
    <section class="receipt-section">
      <span class="label">${escapeHtml(title)}</span>
      ${content}
    </section>
  `;
}

function orderedLines(lines) {
  return `<ol>${lines.map((line) => `<li>${escapeHtml(line.replace(/^\d+\.\s*/, "").replace(/^-\s*/, ""))}</li>`).join("")}</ol>`;
}

function plainLines(lines) {
  return `<div class="receipt-lines">${lines.map((line) => `<div>${escapeHtml(line)}</div>`).join("")}</div>`;
}

function receiptTitle(heading) {
  const lower = heading.toLowerCase();

  if (lower.includes("subscribe")) return "Subscribe";
  if (lower.includes("redeem")) return "Redeem";
  if (lower.includes("send")) return "Transfer";
  if (lower.includes("balance")) return "Balance";
  if (lower.includes("policy")) return "Policy Update";
  if (lower.includes("grant-role") || lower.includes("grant-operational-roles")) return "Role Grant";
  if (lower.includes("manager") || lower.includes("operator")) return "Operator Action";
  if (lower.includes("token")) return "Asset Configuration";
  if (lower.includes("history")) return "History";
  if (lower.includes("refresh")) return "Workspace Refresh";

  return "Action";
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
  if (!account) return "Unknown";
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

function suggestedPolicyName() {
  if (!state.policies.some((policy) => policy.name === "usdv-kyc")) {
    return "usdv-kyc";
  }

  let index = state.policies.length + 1;
  let name = `policy-${index}`;

  while (state.policies.some((policy) => policy.name === name)) {
    index += 1;
    name = `policy-${index}`;
  }

  return name;
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
