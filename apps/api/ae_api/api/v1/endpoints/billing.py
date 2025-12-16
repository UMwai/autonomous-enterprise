"""Billing API endpoints for Stripe integration."""

from typing import Annotated

import structlog
from fastapi import APIRouter, Depends, HTTPException, Header, Request, status
from pydantic import BaseModel, Field, EmailStr

from ae_api.config import get_settings, Settings
from ae_api.services.stripe_service import (
    StripeService,
    StripeProduct,
    StripePrice,
    PaymentLink,
    Subscription,
    WebhookEvent,
)

logger = structlog.get_logger()
router = APIRouter()


def get_stripe_service(
    settings: Annotated[Settings, Depends(get_settings)]
) -> StripeService:
    """Get Stripe service dependency.

    Args:
        settings: Application settings

    Returns:
        StripeService instance

    Raises:
        HTTPException: If Stripe API key is not configured
    """
    if not settings.stripe_api_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Stripe API key not configured",
        )
    return StripeService(api_key=settings.stripe_api_key.get_secret_value())


class CreateProductRequest(BaseModel):
    """Request to create a Stripe product."""

    name: str = Field(min_length=1, max_length=255)
    description: str
    metadata: dict[str, str] = Field(default_factory=dict)


class CreatePriceRequest(BaseModel):
    """Request to create a price for a product."""

    product_id: str
    amount: int = Field(gt=0, description="Amount in cents")
    currency: str = Field(default="usd", pattern="^[a-z]{3}$")
    recurring: dict[str, str] | None = Field(
        default=None,
        description='Recurring config, e.g., {"interval": "month", "interval_count": 1}',
    )
    metadata: dict[str, str] = Field(default_factory=dict)


class CreatePaymentLinkRequest(BaseModel):
    """Request to create a payment link."""

    price_id: str
    success_url: str | None = None
    cancel_url: str | None = None
    metadata: dict[str, str] = Field(default_factory=dict)


class CreateCheckoutSessionRequest(BaseModel):
    """Request to create a checkout session."""

    price_id: str
    customer_email: EmailStr
    success_url: str
    cancel_url: str
    metadata: dict[str, str] = Field(default_factory=dict)


class CheckoutSessionResponse(BaseModel):
    """Response with checkout session URL."""

    session_url: str


class RecordUsageRequest(BaseModel):
    """Request to record metered usage."""

    subscription_item_id: str
    quantity: int = Field(gt=0)
    action: str = Field(default="increment", pattern="^(increment|set)$")


@router.post("/products", response_model=StripeProduct)
async def create_product(
    request: CreateProductRequest,
    stripe_service: Annotated[StripeService, Depends(get_stripe_service)],
) -> StripeProduct:
    """Create a Stripe product.

    Args:
        request: Product creation request
        stripe_service: Stripe service instance

    Returns:
        Created product

    Raises:
        HTTPException: If product creation fails
    """
    try:
        product = await stripe_service.create_product(
            name=request.name,
            description=request.description,
            metadata=request.metadata,
        )
        logger.info("Product created via API", product_id=product.id)
        return product
    except Exception as e:
        logger.error("Failed to create product", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to create product: {str(e)}",
        )


@router.post("/prices", response_model=StripePrice)
async def create_price(
    request: CreatePriceRequest,
    stripe_service: Annotated[StripeService, Depends(get_stripe_service)],
) -> StripePrice:
    """Create a price for a product.

    Args:
        request: Price creation request
        stripe_service: Stripe service instance

    Returns:
        Created price

    Raises:
        HTTPException: If price creation fails
    """
    try:
        price = await stripe_service.create_price(
            product_id=request.product_id,
            amount=request.amount,
            currency=request.currency,
            recurring=request.recurring,
            metadata=request.metadata,
        )
        logger.info("Price created via API", price_id=price.id)
        return price
    except Exception as e:
        logger.error("Failed to create price", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to create price: {str(e)}",
        )


@router.post("/payment-links", response_model=PaymentLink)
async def create_payment_link(
    request: CreatePaymentLinkRequest,
    stripe_service: Annotated[StripeService, Depends(get_stripe_service)],
) -> PaymentLink:
    """Create a payment link.

    Args:
        request: Payment link creation request
        stripe_service: Stripe service instance

    Returns:
        Created payment link

    Raises:
        HTTPException: If payment link creation fails
    """
    try:
        payment_link = await stripe_service.create_payment_link(
            price_id=request.price_id,
            success_url=request.success_url,
            cancel_url=request.cancel_url,
            metadata=request.metadata,
        )
        logger.info("Payment link created via API", link_id=payment_link.id)
        return payment_link
    except Exception as e:
        logger.error("Failed to create payment link", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to create payment link: {str(e)}",
        )


@router.post("/checkout", response_model=CheckoutSessionResponse)
async def create_checkout_session(
    request: CreateCheckoutSessionRequest,
    stripe_service: Annotated[StripeService, Depends(get_stripe_service)],
) -> CheckoutSessionResponse:
    """Create a checkout session.

    Args:
        request: Checkout session creation request
        stripe_service: Stripe service instance

    Returns:
        Checkout session URL

    Raises:
        HTTPException: If checkout session creation fails
    """
    try:
        session_url = await stripe_service.create_checkout_session(
            price_id=request.price_id,
            customer_email=request.customer_email,
            success_url=request.success_url,
            cancel_url=request.cancel_url,
            metadata=request.metadata,
        )
        logger.info("Checkout session created via API", customer_email=request.customer_email)
        return CheckoutSessionResponse(session_url=session_url)
    except Exception as e:
        logger.error("Failed to create checkout session", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to create checkout session: {str(e)}",
        )


@router.post("/webhooks/stripe", response_model=dict[str, str])
async def handle_stripe_webhook(
    request: Request,
    stripe_signature: Annotated[str | None, Header(alias="stripe-signature")] = None,
    settings: Settings = Depends(get_settings),
) -> dict[str, str]:
    """Handle Stripe webhook events.

    Args:
        request: FastAPI request object
        stripe_signature: Stripe signature header
        settings: Application settings

    Returns:
        Success response

    Raises:
        HTTPException: If webhook validation fails or processing fails
    """
    if not settings.stripe_webhook_secret:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Stripe webhook secret not configured",
        )

    if not stripe_signature:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Missing stripe-signature header",
        )

    try:
        # Get raw body
        payload = await request.body()

        # Initialize Stripe service
        stripe_service = StripeService(
            api_key=settings.stripe_api_key.get_secret_value()
            if settings.stripe_api_key
            else ""
        )

        # Verify and parse webhook
        event = await stripe_service.handle_webhook(
            payload=payload,
            signature=stripe_signature,
            webhook_secret=settings.stripe_webhook_secret.get_secret_value(),
        )

        # Process webhook event
        logger.info("Processing webhook event", event_type=event.type, event_id=event.id)

        # Handle different event types
        if event.type == "checkout.session.completed":
            # Handle successful checkout
            logger.info("Checkout completed", event_data=event.data)
        elif event.type in [
            "customer.subscription.created",
            "customer.subscription.updated",
        ]:
            # Handle subscription changes
            logger.info("Subscription event", event_data=event.data)
        elif event.type == "customer.subscription.deleted":
            # Handle subscription cancellation
            logger.info("Subscription deleted", event_data=event.data)
        elif event.type == "invoice.paid":
            # Handle successful payment
            logger.info("Invoice paid", event_data=event.data)
        elif event.type == "invoice.payment_failed":
            # Handle failed payment
            logger.warning("Invoice payment failed", event_data=event.data)

        return {"status": "success", "event_id": event.id}
    except Exception as e:
        logger.error("Webhook processing failed", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Webhook processing failed: {str(e)}",
        )


@router.get("/subscriptions/{subscription_id}", response_model=Subscription)
async def get_subscription(
    subscription_id: str,
    stripe_service: Annotated[StripeService, Depends(get_stripe_service)],
) -> Subscription:
    """Get subscription details.

    Args:
        subscription_id: Stripe subscription ID
        stripe_service: Stripe service instance

    Returns:
        Subscription details

    Raises:
        HTTPException: If subscription retrieval fails
    """
    try:
        subscription = await stripe_service.get_subscription(subscription_id)
        logger.info("Subscription retrieved via API", subscription_id=subscription_id)
        return subscription
    except Exception as e:
        logger.error("Failed to get subscription", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Failed to get subscription: {str(e)}",
        )


@router.post("/usage", response_model=dict[str, str])
async def record_usage(
    request: RecordUsageRequest,
    stripe_service: Annotated[StripeService, Depends(get_stripe_service)],
) -> dict[str, str]:
    """Record metered usage for a subscription.

    Args:
        request: Usage recording request
        stripe_service: Stripe service instance

    Returns:
        Success response

    Raises:
        HTTPException: If usage recording fails
    """
    try:
        await stripe_service.record_usage(
            subscription_item_id=request.subscription_item_id,
            quantity=request.quantity,
            action=request.action,
        )
        logger.info(
            "Usage recorded via API",
            subscription_item_id=request.subscription_item_id,
            quantity=request.quantity,
        )
        return {
            "status": "success",
            "subscription_item_id": request.subscription_item_id,
        }
    except Exception as e:
        logger.error("Failed to record usage", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to record usage: {str(e)}",
        )
