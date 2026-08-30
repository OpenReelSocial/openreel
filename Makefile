# Canonical human/agent interface for OpenReel. Only targets that currently work
# are exposed here; see docs/architecture/repository-structure.md for areas that
# are not implemented yet.

SHELL := /bin/bash
.DEFAULT_GOAL := help

NODE_VERSION := $(shell cat .nvmrc)

# The PDS lives in its own file and env file so a plain 'make up' does not need
# its secrets; see services/pds/compose.yaml.
COMPOSE_ATPROTO := docker compose -f compose.yaml -f services/pds/compose.yaml \
	--env-file .env --env-file services/pds/.env

.PHONY: help
help: ## Show available targets
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

.PHONY: bootstrap
bootstrap: check-tools ## Install workspace dependencies
	pnpm install --frozen-lockfile
	@test -f .env || { cp .env.example .env; echo "Created .env from .env.example"; }
	@test -f services/pds/.env || { cp services/pds/.env.example services/pds/.env; echo "Created services/pds/.env - run 'make pds-secrets' before 'make up-atproto'."; }

.PHONY: check-tools
check-tools: ## Verify required system prerequisites
	@fail=0; \
	command -v node >/dev/null 2>&1 || { echo "MISSING: node (need $(NODE_VERSION); see .nvmrc)"; fail=1; }; \
	if command -v node >/dev/null 2>&1; then \
		have=$$(node --version | sed 's/^v//'); \
		want=$$(cut -d. -f1 <<< "$(NODE_VERSION)"); \
		[[ "$$(cut -d. -f1 <<< "$$have")" == "$$want" ]] || { echo "WRONG VERSION: node $$have, need $$want.x (run 'nvm use')"; fail=1; }; \
	fi; \
	command -v corepack >/dev/null 2>&1 || { echo "MISSING: corepack (ships with Node; 'npm i -g corepack@latest')"; fail=1; }; \
	command -v docker >/dev/null 2>&1 || { echo "MISSING: docker (needed for 'make up')"; fail=1; }; \
	if ! pnpm --version >/dev/null 2>&1; then \
		echo "BROKEN: corepack cannot activate the pinned pnpm."; \
		echo "  Corepack <=0.29 ships expired npm signing keys and fails to resolve versions."; \
		echo "  Fix with:  npm install -g corepack@latest"; \
		echo "  Or bypass once:  COREPACK_INTEGRITY_KEYS=0 pnpm install --frozen-lockfile"; \
		fail=1; \
	fi; \
	if [[ $$fail -eq 0 ]]; then echo "All required tools present."; else \
		echo ""; echo "Fix the items above, then re-run 'make bootstrap'."; exit 1; fi

.PHONY: check
check: format-check lint typecheck test ## Run all pre-PR checks

.PHONY: format
format: ## Apply Prettier formatting
	pnpm run format

.PHONY: format-check
format-check: ## Verify Prettier formatting
	pnpm run format-check

.PHONY: lint
lint: ## Run ESLint
	pnpm run lint

.PHONY: typecheck
typecheck: ## Typecheck every workspace package
	pnpm run typecheck

.PHONY: test
test: ## Run unit tests across the workspace
	pnpm run test

.PHONY: build
build: ## Compile every workspace package
	pnpm run build

.PHONY: dev
dev: ## Run services in watch mode
	pnpm run dev

.PHONY: up
up: ## Build and start Postgres, Redis, AppView, Feed Generator, and admin
	docker compose up -d --build

.PHONY: up-atproto
up-atproto: pds-secrets ## Start Postgres, Redis, and the PDS
	$(COMPOSE_ATPROTO) up -d

.PHONY: status
status: ## Print local service status (admin page: http://localhost:3003)
	@scripts/status.sh

.PHONY: pds-secrets
pds-secrets: ## Generate local PDS development secrets
	@services/pds/scripts/generate-secrets.sh

.PHONY: pds-logs
pds-logs: ## Follow PDS logs
	$(COMPOSE_ATPROTO) logs -f pds

.PHONY: down
down: ## Stop containers, keep volumes
	docker compose down

.PHONY: clean
clean: ## Remove build output and caches
	rm -rf .turbo services/*/dist services/*/.turbo
