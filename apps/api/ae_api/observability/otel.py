"""OpenTelemetry setup for observability."""

import structlog
from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor

from ae_api.config import get_settings

logger = structlog.get_logger()


def setup_telemetry() -> None:
    """Configure OpenTelemetry tracing."""
    settings = get_settings()

    resource = Resource.create(
        {
            "service.name": "ae-api",
            "service.version": settings.app_version,
            "deployment.environment": settings.environment,
        }
    )

    provider = TracerProvider(resource=resource)

    if settings.otel_exporter_otlp_endpoint:
        exporter = OTLPSpanExporter(endpoint=settings.otel_exporter_otlp_endpoint)
        processor = BatchSpanProcessor(exporter)
        provider.add_span_processor(processor)
        logger.info(
            "OTLP exporter configured",
            endpoint=settings.otel_exporter_otlp_endpoint,
        )

    trace.set_tracer_provider(provider)
    logger.info("OpenTelemetry tracing initialized")
