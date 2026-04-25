"""Route blueprints for the polyData API service."""

from __future__ import annotations

from flask import Flask

from .analytics import create_analytics_blueprint
from .bootstrap import create_bootstrap_blueprint
from .content import create_content_blueprint
from .lob import create_lob_blueprint
from .markets import create_markets_blueprint
from .runtime_panels import create_runtime_panels_blueprint
from .system import create_system_blueprint


def register_blueprints(app: Flask, helpers: dict) -> None:
    if app.config.get("POLYDATA_BLUEPRINTS_REGISTERED"):
        return
    for factory in (
        create_bootstrap_blueprint,
        create_markets_blueprint,
        create_runtime_panels_blueprint,
        create_content_blueprint,
        create_analytics_blueprint,
        create_system_blueprint,
        create_lob_blueprint,
    ):
        app.register_blueprint(factory(helpers))
    app.config["POLYDATA_BLUEPRINTS_REGISTERED"] = True
