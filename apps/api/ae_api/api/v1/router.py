"""API v1 router aggregating all endpoints."""

from fastapi import APIRouter

from ae_api.api.v1.endpoints import approvals, billing, deploy, genesis, model_router, runs, safety, specs

api_router = APIRouter()

api_router.include_router(genesis.router, prefix="/genesis", tags=["genesis"])
api_router.include_router(runs.router, prefix="/runs", tags=["runs"])
api_router.include_router(specs.router, prefix="/specs", tags=["specs"])
api_router.include_router(billing.router, prefix="/billing", tags=["billing"])
api_router.include_router(deploy.router, prefix="/deploy", tags=["deploy"])
api_router.include_router(model_router.router, prefix="/model-router", tags=["model-router"])
api_router.include_router(safety.router, prefix="/safety", tags=["safety"])
api_router.include_router(approvals.router, prefix="/approvals", tags=["approvals"])
