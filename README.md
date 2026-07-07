# USDV on Tempo POC

This project is a testnet-only CLI proof of concept for issuing and operating a USDV-style stablecoin on Tempo.

It uses:

- Tempo Moderato testnet
- TIP-20 factory for asset creation
- TIP-403 for whitelist policy enforcement
- Foundry for Solidity contract build/deploy artifacts
- TypeScript + Viem for the interactive CLI

The UX is intentionally terminal-first. You open a shell as an entity, like Alice or Admin, and then issue commands from that identity.

## Authority Model

The POC separates token configuration, policy administration, and lifecycle execution.

```text
admin
  TIP-20 token admin / governance profile.
  Creates TIP-20 assets, attaches TIP-403 policy ids, and grants/revokes TIP-20 roles.

policyAdmin
  TIP-403 policy owner/operator profile when assigned as policy admin.
  Edits whitelist/blacklist membership for a policy id.

manager
  Reusable smart contract that receives operational TIP-20 roles.
  Executes subscribe, redeem, and admin-subscribe flows.

alice/bob
  End-user profiles.
```

Attaching a policy to USDV is a token admin action:

```text
admin> token set-policy USDV usdv-kyc
```

Editing a policy is a policy admin action:

```text
policyadmin> policy allow alice usdv-kyc
policyadmin> policy remove bob usdv-kyc
```

If a policy was originally created with `admin` as its admin, `policyAdmin` cannot edit it until the policy admin is changed:

```text
admin> policy set-admin policyAdmin usdv-kyc
```

## Start Here

### Prerequisites

- Node and npm
- Foundry tools: `forge` and `cast`
- Network access to Tempo Moderato

Check local tools:

```bash
make doctor
```

### Install

```bash
make quickstart
make check
```

`make quickstart` creates `.env` if missing, installs Node and Foundry dependencies, builds contracts, type-checks the CLI, and creates/faucet-funds the default local profiles:

```text
admin policyAdmin deployer alice bob treasury
```

To skip faucet funding during profile generation:

```bash
make quickstart ACCOUNT_ARGS="--no-fund"
```

The CLI reads `.env` on startup. Today it uses only:

- `TEMPO_TESTNET_RPC_URL`: Tempo Moderato RPC endpoint.
- `TEMPO_FEE_TOKEN`: optional fee token override. The default is pathUSD on Moderato.

Default network config is Tempo Testnet (Moderato):

```text
RPC: https://rpc.moderato.tempo.xyz
Chain ID: 42431
Explorer: https://explore.testnet.tempo.xyz
```

### Generate Local Test Profiles

```bash
make accounts-generate NAMES="admin policyAdmin deployer alice bob treasury"
```

This creates local secp256k1 profiles under `.poc/accounts.local.json` and faucet-funds them by default.

Do not commit `.poc/`. It contains local private keys.

To skip faucet funding:

```bash
make accounts-generate NAMES="alice bob" ARGS="--no-fund"
```

## Bootstrap From Clean State

If `.poc/deployments.local.json` and `.poc/policies.local.json` already exist, this workspace may already be bootstrapped. Otherwise, run this sequence once.

Build the manager contract artifact:

```bash
make build-contracts
```

Open an admin console:

```bash
npm run poc -- --as admin --session admin
```

Then run:

```text
policy create usdv-kyc whitelist
policy allow alice
policy allow bob

token create-usdv
token set-policy USDV usdv-kyc

manager deploy
manager register-route USDV
manager grant-operational-roles --asset USDV
manager allow-policy usdv-kyc
manager faucet
```

At this point:

- USDV exists as a TIP-20 token.
- USDV uses the `usdv-kyc` TIP-403 whitelist.
- Alice and Bob are allowed.
- Treasury is not allowed.
- The reusable lifecycle manager has a USDV route.
- The manager has the USDV TIP-20 operational roles used by this POC.
- The manager has pathUSD reserves for redemption tests.

## Play With The CLI

Open the default working sessions in separate macOS Terminal windows:

```bash
make open-sessions
```

This opens:

```text
admin
policyadmin
alice
bob
```

On non-macOS machines, the script prints the commands to run manually.

Or open two terminals yourself.

Terminal 1:

```bash
npm run poc -- --as alice --session alice
```

Terminal 2:

```bash
npm run poc -- --as bob --session bob
```

Try this from Alice:

```text
balance
subscribe 10
send 1 USDV to bob --memo invoice-001
redeem 2
demo policy-failure treasury 0.1
history
receipt last
```

Try this from Bob:

```text
balance
history
```

Open Admin for issuer actions:

```bash
npm run poc -- --as admin --session admin
```

Then:

```text
admin-subscribe bob 5 --memo bank-wire-001
history
```

## Play With The Web Client

The web client is another client for the same POC command handlers. It keeps demo actor keys on the Node side and presents an issuer-console workflow:

```text
Overview
Policy
Roles
Operator
Investors
Activity
```

Start it:

```bash
make web
```

Then open:

```text
http://localhost:5177
```

The main tabs are scoped to the active asset selected in the top bar:

- Overview shows the asset setup checklist and token creation.
- Policy attaches TIP-403 rules and shows policy documents.
- Roles grants or revokes TIP-20 roles for the selected asset.
- Operator shows lifecycle readiness, reserves, and issuance actions for the selected asset route.
- Investors shows Alice/Bob access, balances, transfers, and supported subscribe/redeem actions.
- Activity aggregates local CLI and web receipts.

New TIP-20 assets start with factory defaults. To use subscribe/redeem for a new asset, attach a TIP-403 policy, register an operator route for that asset, grant the operator role bundle on that token, and allow the operator in the attached policy.

The web server reuses the same CLI command handlers through a small local HTTP API:

```text
GET  /api/state
POST /api/action
```

`POST /api/action` takes an actor, a command, and command arguments:

```json
{
  "actor": "alice",
  "command": "send",
  "args": ["1", "USDV", "to", "bob", "--memo", "invoice-001"]
}
```

### Hosted Vercel Mode

When `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are set, the web app switches from local `.poc` files to hosted demo sessions.

Hosted sessions work like this:

- a fresh session id is stored in an HTTP-only cookie;
- admin, alice, bob, deployer, policyAdmin, and treasury keys are generated for that session;
- accounts, deployments, policies, actor sessions, and history are stored in Redis;
- every write refreshes the TTL;
- default TTL is 12 hours;
- `Reset Project` deletes the hosted session and starts over with new keys and empty app state.

Required Vercel env vars:

```text
TEMPO_TESTNET_RPC_URL=https://rpc.moderato.tempo.xyz
TEMPO_FEE_TOKEN=0x20c0000000000000000000000000000000000000
UPSTASH_REDIS_REST_URL=...
UPSTASH_REDIS_REST_TOKEN=...
POC_SESSION_TTL_SECONDS=43200
POC_HOSTED_AUTO_FAUCET=true
```

The reset only deletes app session state. Tempo testnet contracts, tokens, and policies already created onchain remain onchain but are forgotten by the new session.

## CLI API Specification

The CLI is stateful. Each terminal session has:

- an active profile, like `alice`
- a session id, like `alice`
- a local history file under `.poc/history/`

Command format:

```bash
npm run poc -- --as <profile> --session <session-id> --network moderato
```

### Session API

#### `use <profile>`

Switch the current terminal identity.

Request:

```text
use alice
```

Response:

```text
using alice (user) 0x...
```

Side effects:

- Updates `.poc/sessions/<session>.session.json`
- Does not copy or print the private key

#### `use policy <name>`

Shortcut for `policy use <name>`.

Example:

```text
use policy usdv-kyc
```

#### `whoami`

Show the active profile.

Request:

```text
whoami
```

#### `accounts`

List local profiles and mark the active one.

#### `session`

Show the current session id, network, active profile, and trace setting.

#### `network`

Show active network, RPC URL, explorer, and fee token.

#### `trace [on|off]`

Turn lifecycle traces on or off for the current terminal session.

Example:

```text
trace off
trace on
```

When trace is on, `subscribe`, `redeem`, and `admin-subscribe` print the call route: signer, manager call, TIP-20 mint/burn call, issuer-role note, tx hashes, and before/after balances.

### Policy API

TIP-403 policies are managed through the Tempo policy registry.

#### `policy create <name> <whitelist|blacklist> [--admin <profile|address>]`

Create a named local policy and an onchain TIP-403 policy.

Example:

```text
policy create usdv-kyc whitelist
```

Side effects:

- Sends `createPolicy(...)` to TIP-403 registry
- Saves policy id in `.poc/policies.local.json`
- Sets the policy as active for the session

#### `policy create-compound <name> --sender <policy|id> --recipient <policy|id> --mint-recipient <policy|id>`

Create a TIP-1015 compound policy from three existing simple policies.

Example:

```text
policy create senders whitelist
policy create recipients whitelist
policy create mint-recipients whitelist
policy create-compound usdv-compound --sender senders --recipient recipients --mint-recipient mint-recipients
```

Meaning:

- `sender`: who can send during transfers and transfer-from flows.
- `recipient`: who can receive during transfers and transfer-from flows.
- `mint-recipient`: who can receive newly minted tokens.

Compound policies are immutable. To change one, edit the child policies or create a new compound policy.

#### `policy allow <profile|address> [name]`

Add a member to a whitelist policy.

Example:

```text
policy allow alice usdv-kyc
```

#### `policy remove <profile|address> [name]`

Remove a member from a whitelist policy.

For a whitelist, removing a member is how you block that address from USDV transfers.

#### `policy block <profile|address> [name]`

Add a member to a blacklist policy.

#### `policy unblock <profile|address> [name]`

Remove a member from a blacklist policy.

#### `policy check <profile|address> [name]`

Ask TIP-403 if an address is authorized.

Example:

```text
policy check treasury usdv-kyc
```

For compound policies, this prints sender, recipient, and mint-recipient authorization separately.

#### `policy inspect [name]`

Show local policy data plus onchain type/admin data.

#### `policy use <name>`

Set active policy for the session.

Shortcut:

```text
use policy usdv-kyc
```

### Token API

USDV is created through the Tempo TIP-20 factory, not by deploying an ERC-20 contract.

#### `token create <symbol> [--name <name>] [--currency <currency>] [--quote <pathUSD|address>] [--admin <profile|address>] [--salt <salt>]`

Create a new TIP-20 token through the Tempo TIP-20 factory.

If `--salt` is omitted, the CLI generates a random 32-byte salt to avoid factory address collisions. Pass `--salt` only when you intentionally want a deterministic predicted address.

Example:

```text
token create DEMO --name DemoDollar --currency USD --quote pathUSD
```

This is the generic onboarding path used by the web client when someone wants a token other than USDV.

New TIP-20 tokens start with the factory default transfer policy, `always-allow #1`. Attach a TIP-403 policy with `token set-policy <symbol> <policy-name>` when you want the token to use the demo compliance rules.

#### `token create-usdv [--salt <salt>] [--admin <profile|address>] [--quote <pathUSD|address>]`

Create USDV through the TIP-20 factory.

Defaults:

- name: `USDV`
- symbol: `USDV`
- currency: `USD`
- quote token: `pathUSD`
- salt: random 32-byte value when `--salt` is omitted
- admin: active profile

Side effects:

- Sends `createToken(...)` to TIP-20 factory
- Saves USDV deployment in `.poc/deployments.local.json`

#### `token set-policy <symbol> <policy-name>`

Set a TIP-403 policy on a TIP-20 token.

Example:

```text
token set-policy USDV usdv-kyc
```

Alias:

```text
token attach-policy USDV usdv-kyc
```

#### `token inspect [symbol]`

Read token metadata from chain.

#### `token list`

List locally known TIP-20 deployments and the token transfer policy.

#### `token roles [symbol] [profile|address|manager]`

List supported TIP-20 roles and optionally check whether a profile, raw address, or the manager contract has each role.

Supported role names:

```text
issuer
burn-blocked
pause
unpause
```

Examples:

```text
token roles USDV
token roles USDV manager
token roles USDV alice
```

TIP-20 roles are membership based. More than one account can hold the same role, but this POC expects the manager contract to hold operational roles.

#### `token role-check <symbol> <profile|address|manager> <role>`

Check one role assignment.

Example:

```text
token role-check USDV manager issuer
```

#### `token grant-role <symbol> <profile|address|manager> <role>`

Grant a TIP-20 role. This should normally be run from the token admin profile.

Example:

```text
token grant-role USDV manager issuer
```

#### `token revoke-role <symbol> <profile|address|manager> <role>`

Revoke a TIP-20 role. Revoking `issuer` from `manager` breaks the subscribe and admin-subscribe mint path.

Example:

```text
token revoke-role USDV alice issuer
```

### Manager API

The manager models issuer lifecycle actions through a reusable multi-asset operator.

#### `manager deploy [--admin <profile|address>] [--replace]`

Deploy `MultiAssetLifecycleManager`.

Use `--replace` when local state still points at the older USDV-only mock manager. The old local record is archived and the new reusable operator becomes `manager`.

Constructor input:

- admin address

#### `manager register-route [symbol] [--settlement <pathUSD|address>]`

Register an asset route on the reusable manager.

Example:

```text
manager register-route VUSDTEST
```

The route tells the operator which TIP-20 asset it can issue/redeem and which settlement token backs the flow. The default settlement token is pathUSD.

#### `manager routes`

List locally known asset routes for the reusable manager.

#### `manager grant-issuer [--asset <symbol>]`

Grant one asset's `ISSUER_ROLE` to the manager.

#### `manager grant-operational-roles [--asset <symbol>]`

Grant the manager contract the full TIP-20 role bundle this POC uses:

```text
issuer
burn-blocked
pause
unpause
```

This is the preferred bootstrap command for the POC because the manager contract should stay the operational holder of mint/burn lifecycle authority.

Example:

```text
manager grant-operational-roles --asset VUSDTEST
```

#### `manager allow-policy [policy-name]`

Authorize the manager in a TIP-403 policy.

For a whitelist, this adds the manager to the whitelist. This matters because lifecycle flows can move the asset into or out of the manager contract.

#### `manager faucet`

Fund the manager with testnet pathUSD. This provides redemption reserves.

#### `manager subscribe <amount> [--asset <symbol>] [--min <amount>] [--trace|--no-trace]`

Subscribe pathUSD into the selected asset. `--asset` defaults to USDV.

Flow:

1. Approve manager to spend pathUSD.
2. Call manager `subscribe`.
3. Manager pulls pathUSD.
4. Manager calls asset `mintWithMemo`.
5. Mint succeeds because the manager has the required TIP-20 issuer role.

Alias:

```text
subscribe 10
subscribe 10 --asset VUSDTEST
```

#### `manager redeem <amount> [--asset <symbol>] [--min <amount>] [--trace|--no-trace]`

Redeem the selected asset back to pathUSD. `--asset` defaults to USDV.

Flow:

1. Approve manager to spend the selected asset.
2. Call manager `redeem`.
3. Manager pulls the selected asset.
4. Manager calls asset `burnWithMemo`.
5. Manager returns pathUSD.
6. Burn succeeds because the manager is the operational lifecycle contract.

Alias:

```text
redeem 2
redeem 2 --asset VUSDTEST
```

#### `manager admin-subscribe <recipient> <amount> [--asset <symbol>] [--min <amount>] [--memo <text>] [--trace|--no-trace]`

Admin-only mint path for offchain settlement demos.

Alias:

```text
admin-subscribe bob 5 --memo bank-wire-001
admin-subscribe bob 5 --asset VUSDTEST --memo bank-wire-001
```

### Payment API

#### `balance [profile|address] [symbol|pathUSD|all]`

Read onchain balances.

Examples:

```text
balance
balance bob
balance bob USDV
balance bob VUSDTEST
balance pathUSD
```

#### `send <amount> <symbol|pathUSD> to <profile|address> [--memo <text>]`

Send a TIP-20 payment with a 32-byte memo.

Example:

```text
send 1 USDV to bob --memo invoice-001
send 1 VUSDTEST to bob --memo invoice-001
```

Flow:

1. Resolve token.
2. Resolve recipient.
3. Parse amount with 6 decimals.
4. Pack short memo text into `bytes32`, or hash longer text.
5. Call `transferWithMemo`.

If TIP-403 blocks the sender or recipient, the CLI reports `PolicyForbids` and suggests `policy check` commands. This is an onchain rejection, not a client-side preflight.

Fee token:

- Moderato transactions default to pathUSD for fees.
- This avoids USDV fee collection colliding with the USDV whitelist policy.

### Demo API

#### `demo policy-failure [recipient] [amount]`

Attempt a USDV transfer that should fail because the recipient is not authorized by TIP-403.

Default:

```text
demo policy-failure treasury 0.1
```

Expected result:

```text
expected failure: USDV policy blocked transfer to treasury
reason: PolicyForbids
```

This command is educational. Normal commands do not preflight policy membership, because real integrations should let the chain enforce TIP-403.

### History API

#### `history [limit]`

Show recent entries for this terminal session.

Example:

```text
history
history 5
```

Entries include:

- timestamp
- status
- action
- summary
- transaction hashes when the chain accepted a transaction
- expected failure reason when a demo intentionally fails

#### `receipt [last|history-number|entry-id]`

Show one history entry in detail.

Examples:

```text
receipt
receipt last
receipt 2
```

## Validation Model

The CLI validates input shape and local readability:

- active profile exists
- amount is greater than zero
- address is valid or profile exists
- token is known
- local USDV deployment exists
- sender has enough balance for direct `send`

The CLI does not normally preflight policy membership.

TIP-403 and TIP-20 are onchain controls. If a transfer violates policy, the chain rejects it. That is the behavior this POC wants to demonstrate.

## Local State

Generated runtime state lives under `.poc/`:

```text
.poc/accounts.local.json      Local profiles and private keys
.poc/deployments.local.json   USDV and manager addresses
.poc/policies.local.json      Local names for TIP-403 policies
.poc/sessions/*.json          Active profile per terminal session
.poc/history/*.json           Session command receipts
```

`.poc/` is ignored by git.

Reset local state:

```bash
make reset-local-state
```

This deletes generated accounts, deployments, policies, sessions, and history from the local machine.

## Checks

Run:

```bash
make check
```

This runs:

- tool version checks
- Foundry contract build
- TypeScript typecheck

## More Detail

Local implementation notes live under `docs/implementation-log.md`. The `docs/` folder is intentionally ignored by git so development notes do not publish to the repository.
