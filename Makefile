.PHONY: setup web build run dev-api dev-web docker db backup tidy

setup:        ## install frontend deps
	cd web && npm install

web:          ## build the React SPA into the embed dir
	cd web && npm run build

tidy:         ## resolve Go deps + write go.sum
	go mod tidy

build: tidy web ## full production build -> ./cortex
	CGO_ENABLED=0 go build -ldflags="-s -w" -o cortex ./cmd/cortex

run: ## run the built binary
	./cortex

db:           ## start just Postgres (for dev-api/dev-web run outside Docker)
	docker compose up -d postgres

dev-api: db   ## run the API with live Go against local Postgres (serves placeholder SPA)
	go run ./cmd/cortex

dev-web:      ## run Vite dev server on :5173 (proxies /api to :8080)
	cd web && npm run dev

docker:       ## build + run everything (Postgres + cortex) via docker compose
	docker compose up --build

backup:       ## dump the running Postgres database
	@mkdir -p backups
	docker compose exec -T postgres pg_dump -U cortex cortex > backups/cortex-$$(date +%Y%m%d-%H%M%S).sql
