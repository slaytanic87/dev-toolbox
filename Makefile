
help:
	@echo "Build Commands"
	@echo "--------------"
	@echo "make build-frontend   - Build Vue.js frontend"
	@echo "make build-backend-dev - Build Rust backend for development"
	@echo "make build-backend    - Build Rust backend for production"
	@echo "make build-all-dev    - Build both frontend and backend for development"
	@echo "make build-all-prod   - Build both frontend and backend for production"

build-frontend:
	cd frontend && pnpm run build

build-backend-dev:
	cargo build

build-backend:
	cargo build --release

build-all-dev: build-frontend build-backend-dev

build-all-prod: build-frontend build-backend

.PHONY: help build-frontend build-backend-dev build-backend build-all-dev build-all-prod
