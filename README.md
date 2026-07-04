# USDV on Tempo POC

This project is a testnet-only CLI proof of concept for issuing and operating a USDV-style stablecoin on Tempo.

It uses:

- Tempo Moderato testnet
- TIP-20 factory for USDV creation
- TIP-403 for whitelist policy enforcement
- Foundry for Solidity contract build/deploy artifacts
- TypeScript + Viem for the interactive CLI

The UX is intentionally terminal-first. You open a shell as an entity, like Alice or Admin, and then issue commands from that identity.

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
cp .env.example .env
make setup
make check
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
manager grant-issuer
manager allow-policy usdv-kyc
manager faucet
```

At this point:

- USDV exists as a TIP-20 token.
- USDV uses the `usdv-kyc` TIP-403 whitelist.
- Alice and Bob are allowed.
- Treasury is not allowed.
- The lifecycle manager can mint and burn USDV.
- The manager has pathUSD reserves for redemption tests.

## Play With The CLI

Open two terminals.

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

#### `token create-usdv [--salt <salt>] [--admin <profile|address>] [--quote <pathUSD|address>]`

Create USDV through the TIP-20 factory.

Defaults:

- name: `USDV`
- symbol: `USDV`
- currency: `USD`
- quote token: `pathUSD`
- salt: `usdv-poc`
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

#### `token inspect [symbol]`

Read token metadata from chain.

#### `token list`

List locally known TIP-20 deployments.

### Manager API

The manager models the issuer lifecycle around USDV.

#### `manager deploy [--admin <profile|address>]`

Deploy `MockUSDVLifecycleManager`.

Constructor inputs:

- USDV address
- pathUSD settlement token
- admin address

#### `manager grant-issuer`

Grant USDV `ISSUER_ROLE` to the manager.

#### `manager allow-policy [policy-name]`

Authorize the manager in the USDV TIP-403 policy.

For a whitelist, this adds the manager to the whitelist. This matters because redemptions move USDV into the manager before burning.

#### `manager faucet`

Fund the manager with testnet pathUSD. This provides redemption reserves.

#### `manager subscribe <amount> [--min <amount>] [--trace|--no-trace]`

Subscribe pathUSD into USDV.

Flow:

1. Approve manager to spend pathUSD.
2. Call manager `subscribe`.
3. Manager pulls pathUSD.
4. Manager calls USDV `mintWithMemo`.
5. Mint succeeds because the manager has USDV `ISSUER_ROLE`.

Alias:

```text
subscribe 10
```

#### `manager redeem <amount> [--min <amount>] [--trace|--no-trace]`

Redeem USDV back to pathUSD.

Flow:

1. Approve manager to spend USDV.
2. Call manager `redeem`.
3. Manager pulls USDV.
4. Manager calls USDV `burnWithMemo`.
5. Manager returns pathUSD.
6. Burn succeeds because the manager has USDV `ISSUER_ROLE`.

Alias:

```text
redeem 2
```

#### `manager admin-subscribe <recipient> <amount> [--min <amount>] [--memo <text>] [--trace|--no-trace]`

Admin-only mint path for offchain settlement demos.

Alias:

```text
admin-subscribe bob 5 --memo bank-wire-001
```

### Payment API

#### `balance [profile|address] [USDV|pathUSD|all]`

Read onchain balances.

Examples:

```text
balance
balance bob
balance bob USDV
balance pathUSD
```

#### `send <amount> <USDV|pathUSD> to <profile|address> [--memo <text>]`

Send a TIP-20 payment with a 32-byte memo.

Example:

```text
send 1 USDV to bob --memo invoice-001
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

See [docs/implementation-log.md](docs/implementation-log.md) for the step-by-step build log and the exact testnet transaction hashes used during development.
