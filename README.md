# OpenReel
Open-source short-form video on the AT Protocol. Own your account, pick your algorithm.

## Local development

Prerequisites: Node 22 (see `.nvmrc`), Corepack (ships with Node), Docker with
Compose. `make check-tools` verifies them and says how to fix what is missing.

```sh
make bootstrap   # check tools, install dependencies, create .env files
make up          # build and start Postgres, Redis, AppView, Feed Generator, admin, PDS
make status      # service status; also served at http://localhost:3003
make check       # pre-PR gate: format, lint, typecheck, test
make down        # stop everything, keep volumes
```

`make up` also generates local PDS secrets into the git-ignored
`infra/pds/.env`. If a local Postgres or Redis already owns port 5432 or 6379,
change `POSTGRES_PORT` or `REDIS_PORT` in `.env` before `make up`. Run `make`
alone to list every target, and see
[docs/architecture/repository-structure.md](docs/architecture/repository-structure.md)
for the layout and command conventions. Agent and contributor rules live in
[AGENTS.md](AGENTS.md).
