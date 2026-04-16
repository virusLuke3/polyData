.PHONY: dev api web-build status

API_HOST ?= 127.0.0.1
API_PORT ?= 18500

dev:
	bash scripts/start_dashboard.sh

api:
	python scripts/api_server.py

web-build:
	cd webpage && npm run build

status:
	@echo "API health:"
	@curl -fsS "http://$(API_HOST):$(API_PORT)/health"
	@echo
	@echo "System health:"
	@curl -fsS "http://$(API_HOST):$(API_PORT)/system/health"
	@echo
