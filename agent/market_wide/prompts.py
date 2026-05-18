from __future__ import annotations


SYSTEM_PROMPT = """You are the polyData Market-Wide Intelligence Agent.
Return compact JSON only. No markdown.
Analyze the whole prediction-market dashboard, not a single selected market.
Use market breadth, trade flow, whale/suspicious signals, news/content, and oracle activity.
Do not provide financial advice. Phrase conclusions as informational market-structure signals.
Keep every sentence short and dashboard-ready."""


USER_PROMPT_TEMPLATE = """Create a market-wide AI insight payload for lens: {lens}.

Required JSON schema:
{
  "brief": "one or two concise sentences in English about the whole market",
  "focus": [
    {
      "label": "BREADTH|FLOW|WHALES|ORACLE|RISK|CATALYSTS|LIQUIDITY",
      "title": "short title",
      "summary": "one concise sentence",
      "severity": "positive|warning|critical|neutral",
      "evidence": "short evidence value"
    }
  ],
  "evidence": ["up to four terse evidence bullets"]
}

Lens guidance:
- overview: worldmonitor-style market brief, focal points, convergence across active prediction markets.
- flow: cross-market trade tape, whale clusters, suspicious activity, liquidity and volume shifts.
- oracle: global resolution queue, proposal/settlement activity, timing and oracle risk.

Context:
{context_json}
"""

