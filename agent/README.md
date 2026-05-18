polyData server-side agents live here.

- `common/`: shared environment loading, OpenAI-compatible LLM calls, Tavily search, and JSON helpers.
- `market_insight/`: market-focused AI insight agent used by the AI Market Insights panel.
- `gateway/`: local Flask gateway for machines that can reach private AI endpoints; GCP can call it through a reverse SSH tunnel.

Agents read secrets from server-side `.env` files only. Frontend code calls the Flask API and never receives `API_KEY` or `TAVILY_API_KEY`.
