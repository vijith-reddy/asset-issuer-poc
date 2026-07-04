export const REPL_HELP = `Available commands:
  help        Show this help
  accounts    List local profiles
  network     Show current Tempo network config
  session     Show this terminal session
  trace on    Show lifecycle call traces after subscribe/redeem/admin-subscribe
  trace off   Hide lifecycle call traces for this session
  use alice   Switch this terminal to Alice
  use policy usdv-kyc
              Select the active TIP-403 policy for this session
  whoami      Show the active profile address
  balance     Show USDV and pathUSD balances for the active profile
  balance bob Show balances for another profile or address
  send 3 USDV to bob [--memo id]
              Send a TIP-20 payment with a 32-byte memo
  subscribe 10
              Subscribe pathUSD into USDV through the manager
              Add --no-trace for a quiet one-off command
  redeem 2    Redeem USDV back to pathUSD through the manager
  admin-subscribe bob 5
              Admin-only manager subscription for offchain settlement demos
  history     Show recent transaction history for this session
  receipt     Show the last history entry in detail
  demo help   Show POC demo commands
  policy help Show TIP-403 policy commands
  token help  Show TIP-20 token commands
  manager help Show lifecycle manager commands
  exit        Leave the console
  quit        Leave the console
`;
