const views = ["overview", "policy", "roles", "operator", "investors", "activity"];
let activeView = "overview";
let adminTab = "setup";
let operatorTab = "supply";
let userActor = "alice";
let activeTokenName = "";
let policyCreateMode = "simple";
let simplePolicyType = "whitelist";
let previewPolicyName = "";
let policyEditName = "";
let state = null;
let receiptCount = 0;
let actionInFlight = false;
let tokenSaltDraft = randomSaltHex();

const output = document.querySelector("#output");
const workspacePanel = document.querySelector("#workspacePanel");
const refreshButton = document.querySelector("#refreshButton");
const clearOutputButton = document.querySelector("#clearOutputButton");
const assetPickerShell = document.querySelector("#assetPickerShell");

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

document.querySelectorAll(".status-panel").forEach((panel) => {
  panel.addEventListener("click", () => {
    const view = panel.dataset.view;
    const tab = panel.dataset.tab;

    if (view) {
      switchView(view, tab);
    }
  });
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
  ensureActiveToken();
  render();
}

function render() {
  renderStatus();
  renderAssetPicker();

  if (activeView === "overview") renderAssetOverview();
  if (activeView === "policy") renderAssetPolicy();
  if (activeView === "roles") renderAssetRoles();
  if (activeView === "operator") renderOperator();
  if (activeView === "investors") renderInvestors();
  if (activeView === "activity") renderActivity();
}

function renderStatus() {
  const token = selectedToken();
  const policy = attachedPolicy(token);
  const simplePolicy = simplePolicyFor(policy);
  const eligible = eligibleInvestors(policy);
  const managerAllowed = isOperatorAllowed(simplePolicy);
  const rolesReady = areOperatorRolesReady(token);
  const routeReady = isManagerForToken(token);
  const operatorReady = Boolean(state.manager && routeReady && rolesReady && managerAllowed);

  document.querySelector("#networkLine").textContent = `${state.network.label} | chain ${state.network.chainId}`;
  setStatusPanel("tokenStatus", Boolean(token), token ? `${token.name} ${shortAddress(token.address)}` : "Create asset", "TIP-20 token", "overview");
  setStatusPanel("policyStatus", Boolean(policy), policyLabelForToken(token), policy ? "TIP-403 rules" : "factory default", "policy");
  setStatusPanel(
    "managerStatus",
    Boolean(state.manager && operatorReady),
    state.manager ? `Operator ${shortAddress(state.manager.address)}` : "Deploy operator",
    state.manager ? operatorStatusLabel(token, managerAllowed, rolesReady) : "manager contract",
    "operator",
    "permissions",
  );
  setStatusPanel(
    "investorStatus",
    Boolean(policy && eligible.length > 0),
    policy ? `${eligible.length} eligible` : "Open access",
    policy ? "Alice / Bob access" : "factory default",
    "investors",
  );
}

function renderAssetPicker() {
  const token = selectedToken();
  const policy = attachedPolicy(token);
  const policyText = token
    ? policy
      ? `${policy.name} #${policy.id}`
      : "always-allow #1"
    : "Create an asset first";
  const addressText = token ? shortAddress(token.address) : "No address";
  const assetMark = token ? assetBadgeText(token.name) : "--";

  assetPickerShell.innerHTML = `
    <label class="asset-switcher" for="globalAssetSelect">
      <span class="asset-switcher-label">Active asset</span>
      <span class="asset-switcher-card">
        <span class="asset-switcher-mark">${escapeHtml(assetMark)}</span>
        <span class="asset-switcher-copy">
          <strong>${token ? escapeHtml(token.name) : "No asset"}</strong>
          <small>${escapeHtml(addressText)} | ${escapeHtml(policyText)}</small>
        </span>
        <span class="asset-switcher-action">Change</span>
        <select id="globalAssetSelect" aria-label="Switch active asset">
        ${tokenOptions().map(([value, text]) => `
          <option value="${escapeAttr(value)}"${token?.name === value ? " selected" : ""}>${escapeHtml(text)}</option>
        `).join("")}
        </select>
      </span>
    </label>
  `;

  document.querySelector("#globalAssetSelect")?.addEventListener("change", (event) => {
    activeTokenName = event.target.value;
    render();
  });
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
      ["setup", "Setup"],
      ["asset", "Asset"],
      ["policies", "Attach Policy"],
      ["roles", "TIP-20 Roles"],
    ], adminTab)}

    ${adminTab === "setup" ? renderAdminSetupTab(token, policy) : ""}
    ${adminTab === "asset" ? renderAdminAssetTab(token, policy) : ""}
    ${adminTab === "policies" ? renderAdminPoliciesTab(token, policy) : ""}
    ${adminTab === "roles" ? renderAdminRolesTab(token) : ""}
  `;

  wireAdminActions();
  wireComplianceActions();
  wireAdminTabs();
  wirePolicyControls();
  wireAssetControls();
  wireJumpActions();
}

function renderAssetOverview() {
  const token = selectedToken();
  const policy = attachedPolicy(token);

  workspacePanel.innerHTML = `
    <div class="page-heading">
      <div>
        <span class="eyebrow">Asset workspace</span>
        <h2>${escapeHtml(token?.name ?? "Create asset")}</h2>
      </div>
      <div class="button-row">
        <button data-action="token-inspect">Inspect Asset</button>
        <button data-action="token-list">List Assets</button>
      </div>
    </div>

    ${renderAdminSetupTab(token, policy)}
    ${renderCreateAssetSection(token)}
  `;

  wireAdminActions();
  wireJumpActions();
}

function renderAssetPolicy() {
  const token = selectedToken();
  const policy = attachedPolicy(token);

  workspacePanel.innerHTML = `
    <div class="page-heading">
      <div>
        <span class="eyebrow">Asset policy</span>
        <h2>${escapeHtml(token?.name ?? "Asset")} transfer rules</h2>
      </div>
      <div class="button-row">
        <button data-action="policy-inspect">Inspect Policy</button>
        <button data-action="policy-list">List Policies</button>
      </div>
    </div>

    ${renderAdminPoliciesTab(token, policy)}
  `;

  wireAdminActions();
  wireComplianceActions();
  wirePolicyControls();
}

function renderAssetRoles() {
  const token = selectedToken();

  workspacePanel.innerHTML = `
    <div class="page-heading">
      <div>
        <span class="eyebrow">Asset roles</span>
        <h2>${escapeHtml(token?.name ?? "Asset")} permissions</h2>
      </div>
      <div class="button-row">
        <button data-action="token-roles-manager">Check Operator Roles</button>
      </div>
    </div>

    ${renderAdminRolesTab(token)}
  `;

  wireAdminActions();
}

function renderAdminSetupTab(token, policy) {
  const simplePolicy = simplePolicyFor(policy);
  const eligible = eligibleInvestors(policy);
  const managerAllowed = isOperatorAllowed(simplePolicy);
  const rolesReady = areOperatorRolesReady(token);
  const managerForToken = isManagerForToken(token);
  const operatorAuthorized = Boolean(state.manager && managerForToken && managerAllowed);

  return `
    <div class="section-grid">
      <section class="tool-section wide" id="issuerSetupSection">
        <div class="section-heading">
          <div>
            <span class="label">Issuer Setup</span>
            <h2>Demo readiness checklist</h2>
          </div>
          <span class="score-badge">${readinessScore([token, policy, eligible.length > 0, state.manager && hasReusableManager(), managerForToken, managerAllowed, rolesReady])}/7 ready</span>
        </div>
        <div class="setup-list">
          ${setupStep("1", "Create or select asset", token ? `${token.name} is deployed on ${state.network.label}` : "Create a TIP-20 token before attaching policies.", Boolean(token), "overview")}
          ${setupStep("2", "Attach transfer policy", policy ? `${policy.name} controls transfers and mint recipients.` : `${policyLabelForToken(token)}. Attach a TIP-403 policy before using this as an issuer demo asset.`, Boolean(policy), "policy")}
          ${setupStep("3", "Approve demo investors", eligible.length > 0 ? `${eligible.length} investor profile${eligible.length === 1 ? "" : "s"} can receive the asset.` : "Add Alice and Bob to the active rule set.", eligible.length > 0, "policy")}
          ${setupStep("4", "Deploy and authorize operator", operatorSetupDetail(token, managerAllowed), operatorAuthorized, "operator", "permissions")}
          ${setupStep("5", "Grant operational roles", operatorRoleSetupDetail(token, rolesReady), rolesReady, "roles")}
        </div>
      </section>

      <section class="tool-section">
        <div class="section-heading">
          <div>
            <span class="label">Suggested Next Step</span>
            <h2>${managerForToken ? "Issue and redeem" : "Finish asset setup"}</h2>
          </div>
        </div>
        ${managerForToken ? keyValueList([
          ["Issue flow", "Admin signs an offchain-settled subscribe"],
          ["Redeem flow", "Investor signs current redeem path"],
          ["Receipts", "Show signer, contract call, tx, and balance changes"],
        ]) : keyValueList([
          ["Policy", policy ? policyLabelForToken(token) : "Attach a TIP-403 policy"],
          ["Roles", rolesReady ? "Operator roles recorded" : "Grant token roles as needed"],
          ["Supply route", supplyRouteLabel(token)],
        ])}
        <div class="button-row">
          ${managerForToken
            ? `<button class="primary" data-jump-view="operator" data-jump-tab="supply">Open Supply Operations</button><button data-jump-view="investors">Open Alice / Bob</button>`
            : `<button class="primary" data-jump-view="policy">Attach Policy</button><button data-jump-view="roles">Configure Roles</button>`}
        </div>
      </section>

      <section class="tool-section">
        <div class="section-heading">
          <div>
            <span class="label">Current Asset</span>
            <h2>${escapeHtml(token?.name ?? "No asset")}</h2>
          </div>
        </div>
        ${keyValueList([
          ["Token", token ? `${token.name} ${shortAddress(token.address)}` : "Not created"],
          ["Policy", policyLabelForToken(token)],
          ["Operator", state.manager ? `${shortAddress(state.manager.address)} ${managerForToken ? "" : "(no supply route)"}` : "Not deployed"],
        ])}
        <div class="button-row">
          <button data-action="token-inspect">Inspect Asset</button>
          <button data-action="policy-inspect">Inspect Policy</button>
        </div>
      </section>
    </div>
  `;
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
        <div class="form-grid compact">
          ${select("activeTokenName", "Active Asset", tokenOptions(), token?.name)}
        </div>
        ${keyValueList([
          ["Token", token ? `${token.name} ${shortAddress(token.address)}` : "Not created"],
          ["Currency", token?.metadata?.currency ?? "USD"],
          ["Settlement", token?.metadata?.quoteToken ? shortAddress(token.metadata.quoteToken) : "pathUSD"],
          ["Policy", policyLabelForToken(token)],
          ["Admin", token?.metadata?.admin ?? "admin"],
        ])}
        <div class="button-row">
          <button data-action="token-list">List Assets</button>
          <button class="primary" data-action="token-inspect">Inspect Asset</button>
        </div>
      </section>

      ${renderCreateAssetSection(token)}
    </div>
  `;
}

function renderCreateAssetSection(token) {
  const defaultSymbol = token ? nextDemoSymbol() : "USDV";

  return `
    <section class="tool-section wide" id="createAssetSection">
      <div class="section-heading">
        <div>
          <span class="label">Create Asset</span>
          <h2>New TIP-20 token</h2>
        </div>
        ${signerBadge("Admin")}
      </div>
      <div class="form-grid three">
        ${input("tokenSymbol", "Symbol", defaultSymbol)}
        ${input("tokenName", "Asset Name", token ? "DemoDollar" : "USDV")}
        ${input("tokenCurrency", "Currency", "USD")}
        ${select("tokenQuote", "Settlement Token", [["pathUSD", "pathUSD"], ...tokenOptions()])}
        ${input("tokenSalt", "Salt", tokenSaltDraft)}
        ${select("tokenAdmin", "Administrator", profileOptions("admin"))}
        <button class="primary" data-action="create-token">Create Asset Token</button>
        <button data-action="generate-token-salt">Generate Salt</button>
      </div>
    </section>
  `;
}

function renderAdminPoliciesTab(token, policy) {
  const previewPolicy = selectedPreviewPolicy(policy);
  const editablePolicy = selectedEditablePolicy();
  const policyDoc = previewPolicy ? policyDocument(previewPolicy) : {};

  return `
    <div class="section-grid">
      <section class="tool-section" id="attachPolicySection">
        <div class="section-heading">
          <div>
            <span class="label">Policy In Use</span>
            <h2>${escapeHtml(policy?.name ?? "No policy attached")}</h2>
          </div>
          ${policy ? `<span class="score-badge">#${escapeHtml(policy.id)}</span>` : ""}
        </div>
        ${keyValueList([
          ["Current asset", token ? `${token.name} ${shortAddress(token.address)}` : "Not created"],
          ["Transfer policy", policyLabelForToken(token)],
          ["Policy type", policy ? policy.type : "Factory default"],
          ["Signer", "Admin"],
        ])}
        <div class="form-grid">
          ${select("configToken", "Asset", tokenOptions(), token?.name)}
          ${select("configPolicy", "Policy", policyOptions(), policy?.name)}
          <button class="primary" data-action="attach-policy">Attach Selected Policy</button>
          <button data-action="policy-list">List Policies</button>
        </div>
      </section>

      <section class="tool-section" id="createPolicySection">
        <div class="section-heading">
          <div>
            <span class="label">Create Policy</span>
            <h2>New TIP-403 rule</h2>
          </div>
          ${signerBadge("Admin")}
        </div>
        <div class="segmented small">
          <button class="${policyCreateMode === "simple" ? "is-active" : ""}" data-policy-create-mode="simple">Simple</button>
          <button class="${policyCreateMode === "compound" ? "is-active" : ""}" data-policy-create-mode="compound">Compound</button>
        </div>
        ${policyCreateMode === "simple" ? renderSimplePolicyCreate() : renderCompoundPolicyCreate()}
      </section>

      <section class="tool-section wide" id="policyDocumentSection">
        <div class="section-heading">
          <div>
            <span class="label">Policy Document</span>
            <h2>Readable rule set</h2>
          </div>
        </div>
        <div class="form-grid compact">
          ${select("policyPreviewName", "Preview Policy", [["", "Select policy"], ...policyOptions()], previewPolicy?.name ?? "")}
        </div>
        <div class="policy-layout">
          <div class="policy-visual">
            ${policyVisual(previewPolicy)}
          </div>
          <pre class="json-view">${escapeHtml(JSON.stringify(policyDoc, null, 2))}</pre>
        </div>
      </section>

      <section class="tool-section wide" id="policyMembershipSection">
        <div class="section-heading">
          <div>
            <span class="label">Membership</span>
            <h2>Edit simple policy entries</h2>
          </div>
          ${editablePolicy ? `<span class="score-badge">${editablePolicy.type === "whitelist" ? "Allow list" : "Block list"}</span>` : ""}
        </div>
        <div class="form-grid contextual">
          ${select("policyEditName", "Policy", simplePolicyOptions(), editablePolicy?.name)}
          ${select("policyTarget", "Address", policyTargetOptions("alice"))}
          ${editablePolicy?.type === "blacklist"
            ? `<button class="primary" data-action="policy-block">Block Address</button><button data-action="policy-unblock">Unblock Address</button>`
            : `<button class="primary" data-action="policy-allow">Allow Address</button><button data-action="policy-remove">Remove Address</button>`}
          <button data-action="policy-check">Check</button>
        </div>
      </section>
    </div>
  `;
}

function renderSimplePolicyCreate() {
  const isBlocklist = simplePolicyType === "blacklist";
  const createLabel = isBlocklist ? "Create Block List" : "Create Allow List";
  const entryLabel = isBlocklist ? "Entries denied by this policy" : "Entries allowed by this policy";

  return `
    <div class="form-grid">
      ${input("policyName", "Policy Name", suggestedPolicyName())}
      ${select("policyType", "Rule Type", [["whitelist", "Allow list"], ["blacklist", "Block list"]], simplePolicyType)}
      ${select("policyAdmin", "Policy Owner", profileOptions("admin"))}
    </div>
    <div class="policy-entry-panel">
      <div class="section-heading compact">
        <div>
          <span class="label">Initial Entries</span>
          <h3>${entryLabel}</h3>
        </div>
      </div>
      <div class="checkbox-grid">
        ${policyEntryOptions().map(([value, label], index) => {
          const checked = !isBlocklist && isDefaultInitialPolicyEntry(value);
          return checkbox(`policyInitialEntry${index}`, "policyInitialEntry", value, label, checked);
        }).join("")}
      </div>
    </div>
    <div class="button-row">
      <button class="primary" data-action="create-policy">${createLabel}</button>
      <button data-action="policy-list">List Policies</button>
    </div>
  `;
}

function renderCompoundPolicyCreate() {
  const options = simplePolicyOptions();
  const disabled = options.length === 0 ? " disabled data-locked=\"true\"" : "";

  return `
    <div class="form-grid">
      ${input("compoundPolicyName", "Policy Name", suggestedCompoundPolicyName())}
      ${select("compoundSenderPolicy", "Sender Rule", options)}
      ${select("compoundRecipientPolicy", "Recipient Rule", options)}
      ${select("compoundMintRecipientPolicy", "Mint Recipient Rule", options)}
      <button class="primary" data-action="create-compound-policy"${disabled}>Create Compound Policy</button>
      <p class="field-note">Compound policies attach existing simple policies for sender, recipient, and mint recipient checks.</p>
    </div>
  `;
}

function renderAdminRolesTab(token) {
  const operatorActionDisabled = state.manager && (hasReusableManager() || isManagerForToken(token)) ? "" : " disabled data-locked=\"true\"";
  const routeActionDisabled = routeRegistrationDisabled(token);

  return `
    <div class="section-grid">
      <section class="tool-section wide" id="adminRolePermissionSection">
        <div class="section-heading">
          <div>
            <span class="label">Role Permissions</span>
            <h2>TIP-20 access control</h2>
          </div>
          <button data-action="token-roles-manager">Check Operator Roles</button>
        </div>
        ${table(["Role", "What It Controls", "Operator Status"], roleRows(token))}
      </section>

      <section class="tool-section" id="adminRoleAssignSection">
        <div class="section-heading">
          <div>
            <span class="label">Grant / Revoke</span>
            <h2>Assign role holder</h2>
          </div>
          ${signerBadge("Admin")}
        </div>
        <div class="form-grid">
          ${select("roleToken", "Asset", tokenOptions(), token?.name)}
          ${select("roleTarget", "Holder", roleTargetOptions())}
          ${select("roleName", "Role", tip20RoleOptions())}
          <button class="primary" data-action="grant-role">Grant Role</button>
          <button data-action="revoke-role">Revoke Role</button>
        </div>
      </section>

      <section class="tool-section" id="adminOperatorSetupSection">
        <div class="section-heading">
          <div>
            <span class="label">Operator Setup</span>
            <h2>Operator contract</h2>
          </div>
        </div>
        ${keyValueList([
          ["Operator", state.manager ? shortAddress(state.manager.address) : "Not deployed"],
          ["Role asset", token?.name ?? "None"],
          ["Supply route", supplyRouteLabel(token)],
          ["Signer", "Admin"],
          ["Role bundle", "issuer, burn, pause, unpause"],
        ])}
        <div class="button-stack">
          <button data-action="manager-deploy"${managerDeployDisabled()}>${managerDeployLabel()}</button>
          <button data-action="manager-register-route"${routeActionDisabled}>${routeRegistrationLabel(token)}</button>
          <button class="primary" data-action="manager-grant-roles"${operatorActionDisabled}>Grant Operator Bundle</button>
          <button data-action="manager-allow-policy"${operatorActionDisabled}>Allow Operator In Policy</button>
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

function wireAssetControls() {
  document.querySelector("#activeTokenName")?.addEventListener("change", (event) => {
    activeTokenName = event.target.value;
    render();
  });
}

function renderOperator() {
  const token = selectedToken();

  workspacePanel.innerHTML = `
    <div class="page-heading">
      <div>
        <span class="eyebrow">Issuance operator</span>
        <h2>${escapeHtml(token?.name ?? "Asset")} operator workspace</h2>
      </div>
      <div class="button-row">
        <button data-action="manager-inspect">Inspect Operator</button>
        <button data-action="manager-roles">Check Roles</button>
        <button data-action="manager-balance">Check Balances</button>
      </div>
    </div>

    ${subnav("operator", [
      ["permissions", "Role Setup"],
      ["supply", "Supply Route"],
      ["reserves", "Reserves"],
    ], operatorTab)}

    ${operatorTab === "permissions" ? renderOperatorPermissionsTab(token) : ""}
    ${operatorTab === "supply" ? renderOperatorSupplyTab(token) : ""}
    ${operatorTab === "reserves" ? renderOperatorReservesTab(token) : ""}
  `;

  wireOperatorActions();
  wireOperatorTabs();
  wireJumpActions();
}

function renderOperatorPermissionsTab(token) {
  const checks = readinessChecks();
  const operatorActionDisabled = state.manager && (hasReusableManager() || isManagerForToken(token)) ? "" : " disabled data-locked=\"true\"";
  const routeActionDisabled = routeRegistrationDisabled(token);

  return `
    <div class="section-grid">
      <section class="tool-section wide" id="operatorReadinessSection">
        <div class="section-heading">
          <div>
            <span class="label">Active Asset Readiness</span>
            <h2>Can the operator act on ${escapeHtml(token?.name ?? "this asset")}?</h2>
          </div>
        </div>
        <div class="check-grid">
          ${checks.map((check) => readinessItem(check)).join("")}
        </div>
      </section>

      <section class="tool-section wide" id="operatorRoleTableSection">
        <div class="section-heading">
          <div>
            <span class="label">Role Permissions</span>
            <h2>Operator grants</h2>
          </div>
          <button data-action="manager-roles">List Role Permissions</button>
        </div>
        ${table(["Role", "What It Controls", "Operator Status"], roleRows(token))}
      </section>

      <section class="tool-section" id="operatorRoleSetupSection">
        <div class="section-heading">
          <div>
            <span class="label">Role Setup</span>
            <h2>Admin-signed setup</h2>
          </div>
          ${signerBadge("Admin")}
        </div>
        ${keyValueList([
          ["Purpose", "Grant permissions to the operator contract"],
          ["Target", state.manager ? shortAddress(state.manager.address) : "Operator not deployed"],
          ["Role asset", token?.name ?? "None"],
          ["Bundle", "issuer, burn, pause, unpause"],
        ])}
        <div class="form-grid">
          ${select("operatorRoleName", "Role", tip20RoleOptions())}
          <button class="primary" data-action="operator-grant-role"${operatorActionDisabled}>Admin Grant Selected Role</button>
          <button data-action="operator-grant-roles"${operatorActionDisabled}>Admin Grant Role Bundle</button>
          <button data-action="operator-allow-policy"${operatorActionDisabled}>Admin Allow In Policy</button>
        </div>
      </section>

      <section class="tool-section" id="operatorContractSection">
        <div class="section-heading">
          <div>
            <span class="label">Operator Contract</span>
            <h2>Deployment</h2>
          </div>
        </div>
        ${keyValueList([
          ["Address", state.manager ? shortAddress(state.manager.address) : "Not deployed"],
          ["Admin", state.manager?.metadata?.admin ?? "admin"],
          ["Active asset", token?.name ?? "None"],
          ["Supply route", supplyRouteLabel(token)],
        ])}
        <div class="button-stack">
          <button data-action="manager-deploy"${managerDeployDisabled()}>${managerDeployLabel()}</button>
          <button class="primary" data-action="manager-register-route"${routeActionDisabled}>${routeRegistrationLabel(token)}</button>
          <button class="primary" data-action="manager-inspect">Inspect Operator</button>
        </div>
      </section>
    </div>
  `;
}

function renderOperatorSupplyTab(token) {
  const managerForToken = isManagerForToken(token);
  const policy = attachedPolicy(token);
  const simplePolicy = simplePolicyFor(policy);
  const managerAllowed = isOperatorAllowed(simplePolicy);
  const rolesReady = areOperatorRolesReady(token);
  const supplyReady = managerForToken && managerAllowed && rolesReady;
  const disabled = supplyReady ? "" : " disabled data-locked=\"true\"";

  return `
    <div class="section-grid">
      ${managerForToken ? "" : `
        <section class="tool-section wide notice-section">
          <div class="section-heading">
            <div>
              <span class="label">Supply Route</span>
              <h2>No lifecycle manager for ${escapeHtml(token?.name ?? "this asset")}</h2>
            </div>
          </div>
          <p class="muted">${escapeHtml(supplyRouteInstruction(token))}</p>
          <div class="button-row">
            ${hasReusableManager()
              ? `<button class="primary" data-action="manager-register-route"${routeRegistrationDisabled(token)}>${routeRegistrationLabel(token)}</button>`
              : `<button class="primary" data-action="manager-deploy"${managerDeployDisabled()}>${managerDeployLabel()}</button>`}
          </div>
        </section>
      `}
      ${managerForToken && !supplyReady ? `
        <section class="tool-section wide notice-section">
          <div class="section-heading">
            <div>
              <span class="label">Setup Required</span>
              <h2>Attach role and policy before issuing</h2>
            </div>
          </div>
          <p class="muted">${escapeHtml(supplyReadinessMessage(rolesReady, managerAllowed))}</p>
        </section>
      ` : ""}
      <section class="tool-section">
        <div class="section-heading">
          <div>
            <span class="label">Increase Supply</span>
            <h2>Offline subscribe</h2>
          </div>
          ${signerBadge("Admin")}
        </div>
        <div class="form-grid">
          ${select("adminSubRecipient", "Investor", profileOptions("bob"))}
          ${input("adminSubAmount", "Amount", "5")}
          ${input("adminSubMemo", "Memo", "offchain-settlement")}
          <button class="primary" data-action="admin-subscribe"${disabled}>Issue Asset</button>
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
          <button class="primary" data-action="operator-redeem"${disabled}>Redeem Asset</button>
          <button data-action="operator-user-balance">Check Investor Balance</button>
        </div>
      </section>

      <section class="tool-section wide">
        <div class="section-heading">
          <div>
            <span class="label">Supply State</span>
            <h2>${escapeHtml(token?.name ?? "Asset")} supply route</h2>
          </div>
        </div>
        <div class="trace-grid">
          ${managerForToken
            ? `
              ${traceStep("1", "Offline order", "Admin records completed settlement and selects an investor recipient.")}
              ${traceStep("2", "Operator mint", "Manager contract calls TIP-20 mintWithMemo using its issuer permission.")}
              ${traceStep("3", "Investor redeem", "Investor signs the current redeem path and manager burns with memo.")}
              ${traceStep("4", "Supply receipt", "Each action returns total supply and balance deltas.")}
            `
            : `
              ${traceStep("1", "Asset selected", `${token?.name ?? "This asset"} is the active TIP-20 asset.`)}
              ${traceStep("2", "Roles attached", operatorRoleSummary(token))}
              ${traceStep("3", "Route missing", "No lifecycle manager is connected to this selected asset yet.")}
              ${traceStep("4", "Supply locked", "Issue and redeem actions remain disabled until the route exists.")}
            `}
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
          ["Settlement token", state.manager?.metadata?.settlementToken ? shortAddress(state.manager.metadata.settlementToken) : "pathUSD"],
          ["Active asset", token?.name ?? "None"],
          ["Supply route", supplyRouteLabel(token)],
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
          ${traceStep("2", "Asset reserve", "The route asset may temporarily sit with the manager before burn during redeem.")}
          ${traceStep("3", "Faucet", "Testnet funding tops up operator settlement capacity.")}
          ${traceStep("4", "Balance check", "Reads route asset and pathUSD balances for the manager contract.")}
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

function renderInvestors() {
  const token = selectedToken();
  const other = userActor === "alice" ? "bob" : "alice";
  const policy = simplePolicyFor(attachedPolicy(token));
  const actorAccount = state.accounts.find((account) => account.name === userActor);
  const lifecycleAvailable = isManagerForToken(token);
  const lifecycleDisabled = lifecycleAvailable ? "" : " disabled data-locked=\"true\"";

  workspacePanel.innerHTML = `
    <div class="page-heading">
      <div>
        <span class="eyebrow">Asset investors</span>
        <h2>${escapeHtml(token?.name ?? "Asset")} holders</h2>
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
          <span class="score-badge">${escapeHtml(memberStatusForAsset(actorAccount, policy))}</span>
        </div>
        ${actorSummary(userActor)}
        <div class="button-row">
          <button class="primary" data-action="user-balance">Check Balances</button>
          <button data-action="user-history">History</button>
          <button data-action="user-policy-check"${policy ? "" : " disabled data-locked=\"true\""}>Check Policy</button>
        </div>
      </section>

      ${lifecycleAvailable ? "" : `
        <section class="tool-section notice-section">
          <div class="section-heading">
            <div>
              <span class="label">Primary Market</span>
              <h2>No subscribe/redeem route for ${escapeHtml(token?.name ?? "this asset")}</h2>
            </div>
          </div>
          <p class="muted">The selected asset can be transferred if balances exist. Subscribe and redeem stay disabled until a lifecycle manager exists for this asset.</p>
        </section>
      `}

      <section class="tool-section">
        <div class="section-heading">
          <div>
            <span class="label">Primary Market</span>
            <h2>${escapeHtml(token?.name ?? "Asset")} subscribe / redeem</h2>
          </div>
          ${signerBadge(capitalize(userActor))}
        </div>
        <div class="form-grid">
          ${input("userSubscribeAmount", "Subscribe Amount", "10")}
          <button class="primary" data-action="user-subscribe"${lifecycleDisabled}>Subscribe</button>
          ${input("userRedeemAmount", "Redeem Amount", "2")}
          <button data-action="user-redeem"${lifecycleDisabled}>Redeem</button>
        </div>
      </section>

      <section class="tool-section wide">
        <div class="section-heading">
          <div>
            <span class="label">Transfer</span>
            <h2>Send asset</h2>
          </div>
          ${signerBadge(capitalize(userActor))}
        </div>
        <div class="form-grid four">
          ${input("userSendAmount", "Amount", "1")}
          ${select("userSendToken", "Asset", [[selectedTokenName(), selectedTokenName()], ["pathUSD", "pathUSD"]], selectedTokenName())}
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
        ${table(["User", "Address", "Asset Access", "Action"], userRows(policy))}
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
  bind("user-policy-check", () => run("admin", "policy", ["check", userActor, activeSimplePolicyName()]));
  bind("user-subscribe", () => run(userActor, "subscribe", [value("userSubscribeAmount"), "--asset", selectedTokenName()], undefined, [], ["userSubscribeAmount"]));
  bind("user-redeem", () => run(userActor, "redeem", [value("userRedeemAmount"), "--asset", selectedTokenName()], undefined, [], ["userRedeemAmount"]));
  bind("user-send", () => run(userActor, "send", [value("userSendAmount"), value("userSendToken"), "to", value("userSendTo"), "--memo", value("userSendMemo")], undefined, [
    ["userSendToken", "Asset"],
    ["userSendTo", "Recipient"],
    ["userSendMemo", "Memo"],
  ], ["userSendAmount"]));

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
  bind("generate-token-salt", () => {
    tokenSaltDraft = randomSaltHex();
    const input = document.querySelector("#tokenSalt");

    if (input) {
      input.value = tokenSaltDraft;
    }
  });
  bind("create-token", async () => {
    const requestedSymbol = value("tokenSymbol").trim().toUpperCase();
    const result = await run("admin", "token", [
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
    ], undefined, [
      ["tokenSymbol", "Symbol"],
      ["tokenName", "Asset name"],
      ["tokenSalt", "Salt"],
    ]);

    if (result?.ok) {
      activeTokenName = requestedSymbol;
      tokenSaltDraft = randomSaltHex();
      adminTab = "setup";
      render();
    }
  });
  bind("attach-policy", () => {
    if (!validateRequired("configToken", "Asset")) return;
    if (!validateRequired("configPolicy", "Policy")) return;

    return confirmAndRun(`Attach ${value("configPolicy")} to ${value("configToken")}?`, () => run("admin", "token", ["set-policy", value("configToken"), value("configPolicy")]));
  });
  bind("token-list", () => run("admin", "token", ["list"]));
  bind("token-inspect", () => run("admin", "token", ["inspect", value("configToken") || selectedTokenName()]));
  bind("token-roles-manager", () => run("admin", "token", ["roles", value("roleToken") || selectedTokenName(), "manager"]));
  bind("grant-role", () => run("admin", "token", ["grant-role", value("roleToken"), value("roleTarget"), value("roleName")], undefined, [
    ["roleToken", "Asset"],
    ["roleTarget", "Holder"],
    ["roleName", "Role"],
  ]));
  bind("revoke-role", () => {
    if (!validateRequired("roleToken", "Asset")) return;
    if (!validateRequired("roleTarget", "Holder")) return;
    if (!validateRequired("roleName", "Role")) return;

    return confirmAndRun(`Revoke ${value("roleName")} from ${value("roleTarget")}?`, () => run("admin", "token", ["revoke-role", value("roleToken"), value("roleTarget"), value("roleName")]));
  });
  bind("manager-deploy", () => run("admin", "manager", managerDeployArgs()));
  bind("manager-register-route", () => run("admin", "manager", ["register-route", selectedTokenName()]));
  bind("manager-grant-roles", () => grantOperatorRoleBundle());
  bind("manager-allow-policy", () => run("admin", "manager", ["allow-policy", selectedSimplePolicyName()]));
  bind("manager-faucet", () => run("admin", "manager", ["faucet"]));
  bind("manager-inspect", () => run("admin", "manager", ["inspect"]));
}

function wireComplianceActions() {
  bind("policy-list", () => run("admin", "policy", ["list"]));
  bind("policy-inspect", () => {
    const policyName = activePolicyForInspectName();

    if (!policyName) {
      appendOutput("admin> policy inspect\nError: Select or attach a policy first.");
      return undefined;
    }

    return run("admin", "policy", ["inspect", policyName]);
  });
  bind("create-policy", () => {
    if (!validateRequired("policyName", "Policy name")) return;

    const policyName = value("policyName");
    const policyType = value("policyType");
    const initialEntries = checkedValues("policyInitialEntry");
    const args = ["create", value("policyName"), value("policyType")];
    const admin = value("policyAdmin");

    if (admin) {
      args.push("--admin", admin);
    }

    return createSimplePolicy(policyName, policyType, initialEntries, args);
  });
  bind("create-compound-policy", () => {
    if (!validateRequired("compoundPolicyName", "Compound policy name")) return;
    if (!validateRequired("compoundSenderPolicy", "Sender rule")) return;
    if (!validateRequired("compoundRecipientPolicy", "Recipient rule")) return;
    if (!validateRequired("compoundMintRecipientPolicy", "Mint recipient rule")) return;

    return run("admin", "policy", [
      "create-compound",
      value("compoundPolicyName"),
      "--sender",
      value("compoundSenderPolicy"),
      "--recipient",
      value("compoundRecipientPolicy"),
      "--mint-recipient",
      value("compoundMintRecipientPolicy"),
    ]);
  });
  bind("policy-allow", () => run("admin", "policy", ["allow", value("policyTarget"), value("policyEditName")]));
  bind("policy-remove", () => confirmAndRun(`Remove ${value("policyTarget")} from ${value("policyEditName")}?`, () => run("admin", "policy", ["remove", value("policyTarget"), value("policyEditName")])));
  bind("policy-block", () => confirmAndRun(`Block ${value("policyTarget")} in ${value("policyEditName")}?`, () => run("admin", "policy", ["block", value("policyTarget"), value("policyEditName")])));
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

async function createSimplePolicy(policyName, policyType, initialEntries, args) {
  const result = await run("admin", "policy", args);

  if (!result?.ok) {
    return result;
  }

  policyEditName = policyName;
  previewPolicyName = policyName;

  const memberAction = policyType === "blacklist" ? "block" : "allow";

  for (const entry of initialEntries) {
    const memberResult = await run(
      "admin",
      "policy",
      [memberAction, entry, policyName],
      `admin> policy ${memberAction} ${entry} ${policyName}`,
    );

    if (!memberResult?.ok) {
      return memberResult;
    }
  }

  render();
  return result;
}

async function grantOperatorRoleBundle() {
  const tokenName = selectedTokenName();

  return run(
    "admin",
    "manager",
    ["grant-operational-roles", "--asset", tokenName],
    `admin> manager grant-operational-roles --asset ${tokenName}`,
  );
}

function wirePolicyControls() {
  document.querySelectorAll("[data-policy-create-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      policyCreateMode = button.dataset.policyCreateMode;
      render();
    });
  });

  document.querySelector("#policyType")?.addEventListener("change", (event) => {
    simplePolicyType = event.target.value;
    render();
  });

  document.querySelector("#policyPreviewName")?.addEventListener("change", (event) => {
    previewPolicyName = event.target.value;
    render();
  });

  document.querySelector("#policyEditName")?.addEventListener("change", (event) => {
    policyEditName = event.target.value;
    render();
  });
}

function wireOperatorActions() {
  bind("manager-deploy", () => run("admin", "manager", managerDeployArgs()));
  bind("manager-register-route", () => run("admin", "manager", ["register-route", selectedTokenName()]));
  bind("manager-inspect", () => run("manager", "manager", ["inspect"]));
  bind("manager-roles", () => run("manager", "token", ["roles", selectedTokenName(), "manager"]));
  bind("manager-balance", () => run("manager", "balance", state.manager ? [state.manager.address] : ["manager"]));
  bind("manager-faucet", () => run("manager", "manager", ["faucet"]));
  bind("operator-grant-role", () => run("admin", "token", ["grant-role", selectedTokenName(), "manager", value("operatorRoleName")], undefined, [
    ["operatorRoleName", "Role"],
  ]));
  bind("operator-grant-roles", () => grantOperatorRoleBundle());
  bind("operator-allow-policy", () => run("admin", "manager", ["allow-policy", selectedSimplePolicyName()]));
  bind("admin-subscribe", () => run("admin", "admin-subscribe", [value("adminSubRecipient"), value("adminSubAmount"), "--asset", selectedTokenName(), "--memo", value("adminSubMemo")], undefined, [
    ["adminSubRecipient", "Investor"],
    ["adminSubMemo", "Memo"],
  ], ["adminSubAmount"]));
  bind("operator-redeem", () => run(value("operatorRedeemInvestor"), "redeem", [value("operatorRedeemAmount"), "--asset", selectedTokenName()], undefined, [
    ["operatorRedeemInvestor", "Investor"],
  ], ["operatorRedeemAmount"]));
  bind("operator-user-balance", () => run(value("operatorRedeemInvestor"), "balance", []));
}

async function run(actor, command, args, label, requiredFields = [], amountFields = []) {
  if (actionInFlight) return;

  if (!validateRequiredFields(requiredFields) || !validateAmountFields(amountFields)) {
    return;
  }

  const heading = label ?? `${actor}> ${[command, ...args].join(" ")}`;

  try {
    setBusy(true, heading);
    const response = await fetch("/api/action", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ actor, command, args }),
    });
    const payload = await response.json();

    if (!payload.ok) {
      appendOutput(`${heading}\nError: ${payload.error ?? "Unknown error"}`);
      return payload;
    }

    appendOutput(payload.output ? `${heading}\n${payload.output}` : heading);
    state = payload.state;
    ensureActiveToken();
    render();
    return payload;
  } catch (error) {
    appendOutput(`${heading}\nError: ${error.message}`);
    return { ok: false, error: error.message };
  } finally {
    setBusy(false);
  }
}

function switchView(view, tab) {
  if (!views.includes(view)) return;

  activeView = view;
  if (view === "admin" && tab) adminTab = tab;
  if (view === "operator" && tab) operatorTab = tab;
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

function setBusy(isBusy, label = "") {
  actionInFlight = isBusy;
  document.body.classList.toggle("is-busy", isBusy);

  document.querySelectorAll("[data-action]").forEach((button) => {
    button.disabled = isBusy || button.dataset.locked === "true";
  });

  refreshButton.disabled = isBusy;

  if (isBusy) {
    document.body.dataset.busyLabel = label;
  } else {
    delete document.body.dataset.busyLabel;
  }
}

function validateRequiredFields(fields) {
  for (const [id, label] of fields) {
    if (!validateRequired(id, label)) {
      return false;
    }
  }

  return true;
}

function validateRequired(id, label) {
  if (value(id).trim()) {
    return true;
  }

  appendOutput(`form> validation\nError: ${label} is required.`);
  return false;
}

function validateAmountFields(fields) {
  for (const id of fields) {
    const raw = value(id).trim();
    const amount = Number(raw);

    if (!raw || !Number.isFinite(amount) || amount <= 0) {
      appendOutput(`form> validation\nError: ${fieldLabel(id)} must be a positive amount.`);
      return false;
    }
  }

  return true;
}

function confirmAndRun(message, handler) {
  if (actionInFlight) return undefined;
  if (!window.confirm(message)) return undefined;

  return handler();
}

function fieldLabel(id) {
  const input = document.querySelector(`#${id}`);
  const label = input?.closest("label")?.childNodes?.[0]?.textContent?.trim();

  return label || "Amount";
}

function input(id, label, defaultValue) {
  return `<label>${label}<input id="${id}" value="${escapeAttr(defaultValue)}" /></label>`;
}

function checkbox(id, name, value, label, checked = false) {
  return `
    <label class="checkbox-row" for="${escapeAttr(id)}">
      <input id="${escapeAttr(id)}" name="${escapeAttr(name)}" type="checkbox" value="${escapeAttr(value)}"${checked ? " checked" : ""} />
      <span>${escapeHtml(label)}</span>
    </label>
  `;
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

function checkedValues(name) {
  return Array.from(document.querySelectorAll(`input[name="${name}"]:checked`)).map((input) => input.value);
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

function setStatusPanel(id, ok, primary, secondary, view, tab) {
  const target = document.querySelector(`#${id}`);
  const panel = target?.closest(".status-panel");

  if (!target || !panel) return;

  target.innerHTML = `${escapeHtml(primary)}<small>${escapeHtml(secondary)}</small>`;
  panel.classList.toggle("is-ok", ok);
  panel.classList.toggle("is-warn", !ok);
  panel.dataset.view = view;

  if (tab) {
    panel.dataset.tab = tab;
  } else {
    delete panel.dataset.tab;
  }
}

function setupStep(number, title, detail, complete, view, tab) {
  return `
    <div class="setup-step ${complete ? "is-ok" : "is-warn"}">
      <span class="setup-number">${escapeHtml(number)}</span>
      <div>
        <strong>${escapeHtml(title)}</strong>
        <p>${escapeHtml(detail)}</p>
      </div>
      <button type="button" data-jump-view="${escapeAttr(view)}"${tab ? ` data-jump-tab="${escapeAttr(tab)}"` : ""}>
        ${complete ? "Review" : "Open"}
      </button>
    </div>
  `;
}

function wireJumpActions() {
  document.querySelectorAll("[data-jump-view]").forEach((button) => {
    button.addEventListener("click", () => {
      switchView(button.dataset.jumpView, button.dataset.jumpTab);
      scrollToAnchor(button.dataset.jumpAnchor);
    });
  });
}

function scrollToAnchor(anchor) {
  if (!anchor) return;

  requestAnimationFrame(() => {
    document.getElementById(anchor)?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  });
}

function readinessScore(items) {
  return items.filter(Boolean).length;
}

function signerBadge(actor) {
  return `<span class="score-badge signer-badge">Signer: ${escapeHtml(actor)}</span>`;
}

function readinessChecks() {
  const token = selectedToken();
  const policy = attachedPolicy(token);
  const simplePolicy = simplePolicyFor(policy);
  const managerAllowed = isOperatorAllowed(simplePolicy);
  const eligible = eligibleInvestors(policy);
  const reusableReady = hasReusableManager();
  const routeReady = isManagerForToken(token);

  return [
    {
      label: "Asset token",
      detail: token ? `${token.name} deployed` : "No token in local state",
      ok: Boolean(token),
      action: "Create",
      view: "overview",
      anchor: "createAssetSection",
    },
    {
      label: "Compliance policy",
      detail: policy ? `${policy.name} attached` : "No transfer policy attached",
      ok: Boolean(policy),
      action: "Attach",
      view: "policy",
      anchor: "attachPolicySection",
    },
    {
      label: "Operator contract",
      detail: state.manager
        ? reusableReady
          ? `Reusable operator ${shortAddress(state.manager.address)} deployed`
          : "Legacy USDV-only operator; deploy reusable operator"
        : "No operator deployment",
      ok: Boolean(state.manager && reusableReady),
      action: state.manager ? "Upgrade" : "Deploy",
      view: "operator",
      tab: "permissions",
      anchor: "operatorContractSection",
    },
    {
      label: "Asset route",
      detail: routeReady ? `${token?.name ?? "Asset"} route registered` : supplyRouteLabel(token),
      ok: routeReady,
      action: "Register",
      view: "operator",
      tab: "permissions",
      anchor: "operatorContractSection",
    },
    {
      label: "Operator roles",
      detail: operatorRoleSummary(token),
      ok: areOperatorRolesReady(token),
      action: "Grant",
      view: "operator",
      tab: "permissions",
      anchor: "operatorRoleSetupSection",
    },
    {
      label: "Operator eligibility",
      detail: managerAllowed ? "Operator is policy-eligible" : "Operator is not recorded in policy",
      ok: Boolean(managerAllowed),
      action: "Allow",
      view: "policy",
      anchor: "policyMembershipSection",
    },
    {
      label: "Investors",
      detail: `${eligible.length} eligible investor${eligible.length === 1 ? "" : "s"}`,
      ok: eligible.length > 0,
      action: "Edit",
      view: "policy",
      anchor: "policyMembershipSection",
    },
  ];
}

function isOperatorAllowed(policy) {
  if (!state.manager || !policy || policy.type === "compound") return false;

  const member = Object.values(policy.members).find((item) => sameAddress(item.address, state.manager.address));

  return policy.type === "whitelist" ? Boolean(member?.included) : !member?.included;
}

function areOperatorRolesReady(token) {
  if (!state.manager || !token) return false;

  const granted = operatorGrantedRoles(token);

  return tip20Roles().every((role) => granted.includes(role.id));
}

function isOperatorRoleReady(token, role) {
  return operatorGrantedRoles(token).includes(role);
}

function operatorGrantedRoles(token) {
  if (!state.manager || !token) return [];

  const metadata = token.metadata ?? {};
  const direct = tip20Roles()
    .filter((role) => (
      metadata[`role.${role.id}.manager.status`] === "granted"
      && sameAddress(metadata[`role.${role.id}.manager.address`], state.manager.address)
    ))
    .map((role) => role.id);
  const managerBundle = sameAddress(state.manager.metadata?.operationalRolesGrantedOn, token.address)
    ? state.manager?.metadata?.operationalRoles
    : "";
  const localBundle = sameAddress(metadata.managerOperationalRolesGrantedTo, state.manager.address)
    ? metadata.managerOperationalRoles
    : "";
  const bundle = `${localBundle ?? ""},${managerBundle ?? ""}`
    .split(",")
    .map((role) => role.trim())
    .filter(Boolean);

  return [...new Set([...direct, ...bundle])];
}

function missingOperatorRoles(token) {
  const granted = operatorGrantedRoles(token);

  return tip20Roles().filter((role) => !granted.includes(role.id));
}

function operatorRoleSummary(token) {
  if (!state.manager) return "Deploy operator contract";
  if (!token) return "Select an asset";

  const granted = operatorGrantedRoles(token);
  const missing = missingOperatorRoles(token);

  if (missing.length === 0) return "All operator roles granted";
  if (granted.includes("issuer")) return `Issuer granted; ${missing.length} role${missing.length === 1 ? "" : "s"} missing`;
  if (granted.length > 0) return `${granted.length}/4 roles granted; issuer missing`;

  return "Grant issuer role first";
}

function supplyReadinessMessage(rolesReady, managerAllowed) {
  if (!rolesReady && !managerAllowed) {
    return "Grant the operator role bundle and allow the operator in the attached policy.";
  }

  if (!rolesReady) {
    return "Grant the operator role bundle before issuing or redeeming through the manager.";
  }

  return "Allow the operator contract in the attached policy before minting.";
}

function readinessItem(check) {
  const action = !check.ok && check.view
    ? `<button type="button" class="check-action" data-jump-view="${escapeAttr(check.view)}"${check.tab ? ` data-jump-tab="${escapeAttr(check.tab)}"` : ""}${check.anchor ? ` data-jump-anchor="${escapeAttr(check.anchor)}"` : ""}>${escapeHtml(check.action ?? "Open")}</button>`
    : "";

  return `
    <div class="check-item ${check.ok ? "is-ok" : "is-warn"}">
      <span class="check-dot"></span>
      <div>
        <strong>${escapeHtml(check.label)}</strong>
        <p>${escapeHtml(check.detail)}</p>
        ${action}
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
            <strong>${escapeHtml(policyMemberLabel(member))}</strong>
            <code class="policy-address">${escapeHtml(member.address)}</code>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

function policyMemberLabel(member) {
  if (state.manager && sameAddress(member.address, state.manager.address)) {
    return "Operator contract";
  }

  if (isAddressLike(member.name)) {
    return "Address";
  }

  return member.name;
}

function isAddressLike(value) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(value));
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

  if (isOperatorRoleReady(token, role)) {
    return "Granted to operator";
  }

  return "Not granted";
}

function userRows(policy) {
  return ["alice", "bob"].map((name) => {
    const account = state.accounts.find((item) => item.name === name);

    return [
      capitalize(name),
      html(`<span class="mono">${escapeHtml(account ? shortAddress(account.address) : "missing")}</span>`),
      memberStatusForAsset(account, policy),
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
    <div class="table-wrap">
      <table class="inline-table">
        <thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead>
        <tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${renderCell(cell)}</td>`).join("")}</tr>`).join("")}</tbody>
      </table>
    </div>
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
    signer: receiptSigner(heading),
    status: hasError ? "Error" : "Success",
    summary: hasError ? friendlyErrorSummary(lines) : details[0] ?? balances[0] ?? flow[0] ?? heading,
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

function receiptSigner(heading) {
  const match = heading.match(/^([^>]+)>/);

  return match?.[1]?.trim();
}

function friendlyErrorSummary(lines) {
  const joined = lines.join(" ");

  if (/PolicyForbids/i.test(joined)) {
    return "Policy rejected this action. Check sender, recipient, and mint-recipient eligibility.";
  }

  if (/Unknown profile/i.test(joined)) {
    return "The selected profile does not exist in local account state.";
  }

  if (/already exists/i.test(joined)) {
    return "That local record already exists. Choose a new name or inspect the existing item.";
  }

  return lines.find((line) => isErrorLine(line.trim())) ?? lines[0] ?? "Action failed.";
}

function receiptCard(receipt) {
  const txCount = receipt.txs.length;
  const flowCount = receipt.flow.length;

  return `
    <article class="receipt-card ${receipt.status === "Error" ? "is-error" : "is-success"}">
      <div class="receipt-card-header">
        <div class="receipt-title-block">
          <span class="receipt-command">${escapeHtml(receipt.command)}</span>
          <h3>${escapeHtml(receipt.title)}</h3>
        </div>
        <span class="receipt-status">${escapeHtml(receipt.status)}</span>
      </div>
      <div class="receipt-chip-row">
        ${receipt.signer ? receiptChip("Signer", capitalize(receipt.signer)) : ""}
        ${txCount > 0 ? receiptChip("Tx", String(txCount)) : ""}
        ${flowCount > 0 ? receiptChip("Trace", `${flowCount} steps`) : ""}
      </div>
      <p class="receipt-summary">${escapeHtml(receipt.summary)}</p>
      ${receipt.txs.length > 0 ? receiptSection("Transactions", receipt.txs.map((tx) => `
        <div class="receipt-tx">
          <span class="receipt-tx-label">${escapeHtml(tx.label)}</span>
          <code title="${escapeAttr(tx.hash)}">${escapeHtml(shortAddress(tx.hash))}</code>
          <span class="receipt-tx-actions">
            ${txUrl(tx.hash) ? `<a href="${escapeAttr(txUrl(tx.hash))}" target="_blank" rel="noreferrer">Explorer</a>` : ""}
            <button type="button" data-copy="${escapeAttr(tx.hash)}">Copy</button>
          </span>
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

function receiptChip(label, value) {
  return `<span class="receipt-chip"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></span>`;
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
  return `<ol class="receipt-steps">${lines.map((line) => `<li>${escapeHtml(cleanReceiptLine(line))}</li>`).join("")}</ol>`;
}

function plainLines(lines) {
  return `<div class="receipt-lines">${lines.map((line) => receiptLine(line)).join("")}</div>`;
}

function receiptLine(line) {
  const pair = line.match(/^([^:]{2,34}):\s+(.+)$/);

  if (!pair) {
    return `<div class="receipt-line full">${escapeHtml(line)}</div>`;
  }

  return `
    <div class="receipt-line">
      <span>${escapeHtml(pair[1])}</span>
      <strong>${escapeHtml(pair[2])}</strong>
    </div>
  `;
}

function cleanReceiptLine(line) {
  return line.replace(/^\d+\.\s*/, "").replace(/^-\s*/, "").trim();
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

function txUrl(hash) {
  const base = state?.network?.explorerUrl;

  return base ? `${base.replace(/\/$/, "")}/tx/${hash}` : "";
}

function tokenOptions() {
  return state.tokens.map((token) => [token.name, token.name]);
}

function assetBadgeText(value) {
  return value.replace(/[^a-z0-9]/gi, "").slice(0, 3).toUpperCase() || "TOK";
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
  const names = ["admin", "alice", "bob", "treasury"];
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

function policyTargetOptions(defaultName) {
  const options = state.manager ? [[state.manager.address, `Operator Contract ${shortAddress(state.manager.address)}`]] : [];
  return [...options, ...profileOptions(defaultName)];
}

function policyEntryOptions() {
  return policyTargetOptions("alice").filter(([value]) => {
    if (state.manager && sameAddress(value, state.manager.address)) return true;

    return ["alice", "bob", "treasury"].includes(value);
  });
}

function isDefaultInitialPolicyEntry(value) {
  if (["alice", "bob"].includes(value)) return true;

  return Boolean(state.manager && sameAddress(value, state.manager.address));
}

function investorAccounts() {
  return state.accounts.filter((account) => ["user", "treasury"].includes(account.kind));
}

function ensureActiveToken() {
  if (state.tokens.some((token) => token.name === activeTokenName)) {
    return;
  }

  activeTokenName = defaultTokenName();
}

function defaultTokenName() {
  return state.tokens.find((token) => token.name === "USDV")?.name
    ?? state.tokens[0]?.name
    ?? "";
}

function selectedToken() {
  return state.tokens.find((token) => token.name === activeTokenName)
    ?? state.tokens.find((token) => token.name === "USDV")
    ?? state.tokens[0];
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

function activePolicyForInspectName() {
  return attachedPolicy(selectedToken())?.name
    ?? previewPolicyName
    ?? "";
}

function selectedPreviewPolicy(fallback) {
  return state.policies.find((policy) => policy.name === previewPolicyName)
    ?? fallback;
}

function selectedEditablePolicy() {
  const simplePolicies = state.policies.filter((policy) => policy.type !== "compound");

  return simplePolicies.find((policy) => policy.name === policyEditName)
    ?? selectedSimplePolicy()
    ?? simplePolicies[0];
}

function selectedSimplePolicy() {
  const attached = selectedPolicy();

  return simplePolicyFor(attached) ?? state.policies.find((policy) => policy.type !== "compound");
}

function selectedSimplePolicyName() {
  return selectedSimplePolicy()?.name ?? "";
}

function activeSimplePolicyName() {
  return simplePolicyFor(attachedPolicy(selectedToken()))?.name ?? "";
}

function simplePolicyFor(policy) {
  if (!policy) return undefined;

  if (policy.type !== "compound") {
    return policy;
  }

  return state.policies.find((item) => item.name === policy.compound?.senderPolicyName)
    ?? state.policies.find((item) => item.id === policy.compound?.senderPolicyId);
}

function attachedPolicy(token) {
  if (!token) return undefined;

  const name = token.metadata?.transferPolicy;
  const id = token.metadata?.transferPolicyId;
  return state.policies.find((policy) => policy.name === name || policy.id === id);
}

function policyLabelForToken(token) {
  const policy = attachedPolicy(token);

  if (policy) {
    return `${policy.name} #${policy.id}`;
  }

  const id = token?.metadata?.transferPolicyId;

  if (id === "0") return "always-reject #0";
  if (!id || id === "1") return "always-allow #1";

  return `policy #${id}`;
}

function managerTokenName() {
  const managerToken = state.tokens.find((token) => sameAddress(token.address, state.manager?.metadata?.usdv));

  return managerToken?.name ?? "USDV";
}

function hasReusableManager() {
  return state.manager?.metadata?.managerVersion === "multi-asset";
}

function managerDeployArgs() {
  return state.manager && !hasReusableManager() ? ["deploy", "--replace"] : ["deploy"];
}

function managerDeployLabel() {
  if (hasReusableManager()) return "Operator Deployed";
  if (state.manager) return "Upgrade Operator";

  return "Deploy Operator";
}

function managerDeployDisabled() {
  return hasReusableManager() ? " disabled data-locked=\"true\"" : "";
}

function routeRegistrationDisabled(token) {
  return hasReusableManager() && token && !isManagerForToken(token) ? "" : " disabled data-locked=\"true\"";
}

function routeRegistrationLabel(token) {
  if (!hasReusableManager()) return "Deploy Reusable Operator First";
  if (!token) return "Select Asset";
  if (isManagerForToken(token)) return "Route Registered";

  return "Register Asset Route";
}

function supplyRouteLabel(token) {
  if (!state.manager) return "Not deployed";
  if (!token) return "Select an asset";
  if (isManagerForToken(token)) return `${token.name} route available`;
  if (!hasReusableManager()) return "Deploy reusable operator";

  return `No route for ${token.name}`;
}

function supplyRouteInstruction(token) {
  if (!state.manager) {
    return "Deploy the reusable operator first, then register this asset as a supply route.";
  }

  if (!hasReusableManager()) {
    return "The current operator is the old USDV-only contract. Upgrade to the reusable operator before routing this asset.";
  }

  if (!token) {
    return "Select an asset before registering a lifecycle route.";
  }

  return `Register ${token.name} with the reusable operator, then grant roles and allow the operator in policy.`;
}

function isManagerForToken(token) {
  if (!state.manager || !token) return false;

  if (hasReusableManager()) {
    return state.manager.metadata?.[`route.${token.name}.enabled`] === "true"
      && sameAddress(state.manager.metadata?.[`route.${token.name}.asset`], token.address);
  }

  return sameAddress(token.address, state.manager.metadata?.usdv);
}

function operatorStatusLabel(token, managerAllowed, rolesReady) {
  const roleText = operatorRoleSummary(token);

  if (!isManagerForToken(token)) {
    return `${roleText}; ${supplyRouteLabel(token)}`;
  }

  return `${rolesReady ? "roles ready" : roleText} / ${managerAllowed ? "policy-ready" : "policy needed"}`;
}

function operatorSetupDetail(token, managerAllowed) {
  if (!state.manager) {
    return "Deploy the manager contract and allow it in policy.";
  }

  if (!hasReusableManager()) {
    return "Upgrade the old USDV-only operator to a reusable operator.";
  }

  if (!isManagerForToken(token)) {
    return `Reusable operator exists. ${supplyRouteLabel(token)}.`;
  }

  return `Operator ${shortAddress(state.manager.address)} is deployed${managerAllowed ? " and policy-eligible" : "; allow it in the attached policy"}.`;
}

function operatorRoleSetupDetail(token, rolesReady) {
  return rolesReady
    ? "Operator can mint, burn, pause, and unpause this asset."
    : operatorRoleSummary(token);
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

function memberStatusForAsset(account, policy) {
  if (!account) return "Unknown";
  if (!policy) return "Open access";

  return memberStatus(account, policy);
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

function suggestedCompoundPolicyName() {
  const base = `${selectedTokenName().toLowerCase()}-compound`;

  if (!state.policies.some((policy) => policy.name === base)) {
    return base;
  }

  let index = state.policies.length + 1;
  let name = `${base}-${index}`;

  while (state.policies.some((policy) => policy.name === name)) {
    index += 1;
    name = `${base}-${index}`;
  }

  return name;
}

function value(id) {
  return document.querySelector(`#${id}`)?.value ?? "";
}

function randomSaltHex() {
  const bytes = new Uint8Array(32);

  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }

  return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
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
