# Canonical human/agent interface for OpenReel. Only targets that currently work
# are exposed here; see docs/architecture/repository-structure.md for areas that
# are not implemented yet.

SHELL := /bin/bash
.DEFAULT_GOAL := help

NODE_VERSION := $(shell cat .nvmrc)

# The PDS is a separate Compose file with its own env file, because Compose
# interpolates every service in a file regardless of profile and the PDS declares
# required secrets. 'make up-core' therefore never parses it.
COMPOSE_FULL := docker compose -f compose.yaml -f infra/pds/compose.yaml \
	--env-file .env --env-file infra/pds/.env

.PHONY: help
help: ## Show available targets
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

.PHONY: bootstrap
bootstrap: check-tools ## Install workspace dependencies
	pnpm install --frozen-lockfile
	@test -f .env || { cp .env.example .env; echo "Created .env from .env.example"; }
	@test -f infra/pds/.env || { cp infra/pds/.env.example infra/pds/.env; echo "Created infra/pds/.env"; }

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
# Type-aware ESLint resolves @openreel/service-core through its package.json
# exports, which point at dist/. typecheck and test get that build via turbo's
# ^build dependency; eslint runs at the root, so it needs the build explicitly
# or a fresh clone fails with "type that could not be resolved".
lint: build ## Run ESLint
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
up: pds-secrets ## Build and start the whole stack, then report status
	$(COMPOSE_FULL) up -d --build
	@$(MAKE) --no-print-directory wait
	@$(MAKE) --no-print-directory status

.PHONY: up-core
up-core: ## Start everything except the PDS (no PDS secrets required)
	docker compose up -d --build
	@echo
	@echo "Started without the PDS, so 'make status' will report it down."
	@echo "Use 'make up' for the full stack."

.PHONY: wait
wait: ## Block until containers finish starting (used by 'make up')
	@for i in $$(seq 1 60); do \
		health=$$($(COMPOSE_FULL) ps --format '{{.Health}}' 2>/dev/null | tr '\n' ' '); \
		case "$$health" in *starting*|"") sleep 2 ;; *) break ;; esac; \
	done

.PHONY: status
status: ## Print local service status (admin page: http://localhost:3003)
	@scripts/status.sh

.PHONY: pds-secrets
pds-secrets: ## Generate local PDS development secrets
	@infra/pds/scripts/generate-secrets.sh

.PHONY: pds-logs
pds-logs: ## Follow PDS logs
	$(COMPOSE_FULL) logs -f pds

.PHONY: down
down: ## Stop every container in the project, keep volumes
	# --remove-orphans also removes the PDS, which is defined in infra/pds and so
	# is an orphan relative to compose.yaml alone. Without it the PDS survives.
	docker compose down --remove-orphans

.PHONY: clean
clean: ## Remove build output and caches
	rm -rf .turbo services/*/dist services/*/.turbo
