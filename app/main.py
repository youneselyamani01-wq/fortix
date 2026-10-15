from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from app.api.routes import router
from app.core.signing_config import SigningConfigurationError
from app.action_control.routes import router as action_control_router
from app.control.routes import router as control_router
from app.verify.routes import router as verify_router

app = FastAPI(
    title="FortiX PoC v1.1",
    version="1.1.0",
    description="Identity → Action → Proof → Logs (local-first PoC)",
)


@app.exception_handler(SigningConfigurationError)
async def signing_configuration_unavailable(
    _request: Request,
    _error: SigningConfigurationError,
) -> JSONResponse:
    return JSONResponse(
        status_code=503,
        content={"detail": "signing_configuration_unavailable"},
    )

app.include_router(router)
app.include_router(action_control_router)
app.include_router(control_router)
app.include_router(verify_router)
