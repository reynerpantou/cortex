.PHONY: setup web build run dev-api dev-web docker backup tidy

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

dev-api:      ## run the API with live Go (serves placeholder SPA)
	go run ./cmd/cortex

dev-web:      ## run Vite dev server on :5173 (proxies /api to :8080)
	cd web && npm run dev

docker:       ## build + run via docker compose
	docker compose up --build

backup:       ## write a consistent DB snapshot
	@mkdir -p backups
	./cortex -backup backups/cortex-$$(date +%Y%m%d-%H%M%S).db
