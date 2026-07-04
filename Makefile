# Project shortcuts for the USDV on Tempo POC.
# Each target is intentionally small so a new reader can see which tool is being used.

.PHONY: help setup install foundry-deps doctor poc poc-as accounts-generate typecheck build-contracts test-contracts check clean-build reset-local-state

help:
	@echo "USDV on Tempo POC"
	@echo ""
	@echo "Setup:"
	@echo "  make setup                 Install Node and Foundry dependencies"
	@echo "  make install               Install Node dependencies from package-lock.json"
	@echo "  make foundry-deps          Install Solidity libraries into lib/"
	@echo "  make doctor                Print local tool versions"
	@echo ""
	@echo "Development:"
	@echo "  make poc                   Start the future interactive CLI"
	@echo "  make poc-as PROFILE=alice  Start the future CLI as a named profile"
	@echo "  make accounts-generate NAMES=\"admin alice bob\""
	@echo "      Pass ARGS=\"--no-fund\" to skip default testnet faucet funding"
	@echo "  make typecheck             Type-check TypeScript when CLI files exist"
	@echo "  make build-contracts       Build Solidity contracts with Foundry"
	@echo "  make test-contracts        Run Solidity tests with Foundry"
	@echo "  make check                 Run checks that are safe for the current scaffold"
	@echo ""
	@echo "Cleanup:"
	@echo "  make clean-build           Remove generated build outputs"
	@echo "  make reset-local-state     Remove generated .poc runtime state"

setup: install foundry-deps

install:
	npm ci

foundry-deps:
	@if [ ! -d lib/tempo-std ]; then forge install --no-git --shallow tempoxyz/tempo-std; else echo "tempo-std already installed"; fi
	@if [ ! -d lib/forge-std ]; then forge install --no-git --shallow foundry-rs/forge-std; else echo "forge-std already installed"; fi

doctor:
	node --version
	npm --version
	forge --version
	cast --version

poc:
	npm run poc -- $(ARGS)

poc-as:
	@if [ -z "$(PROFILE)" ]; then echo "Usage: make poc-as PROFILE=alice"; exit 1; fi
	npm run poc -- --as $(PROFILE)

accounts-generate:
	@if [ -z "$(NAMES)" ]; then echo "Usage: make accounts-generate NAMES=\"admin alice bob\""; exit 1; fi
	npm run accounts:generate -- $(NAMES) $(ARGS)

typecheck:
	npm run typecheck

build-contracts:
	npm run build:contracts

test-contracts:
	npm run test:contracts

check: doctor build-contracts typecheck

clean-build:
	rm -rf cache out broadcast dist coverage

reset-local-state:
	rm -rf .poc/accounts.local.json .poc/deployments.local.json .poc/policies.local.json .poc/sessions .poc/history
	mkdir -p .poc/sessions .poc/history
