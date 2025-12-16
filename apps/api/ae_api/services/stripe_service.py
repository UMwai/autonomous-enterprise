"""Stripe payment and billing service."""

from datetime import datetime
from enum import Enum
from typing import Any

import stripe
import structlog
from pydantic import BaseModel, Field

logger = structlog.get_logger()


class StripeProduct(BaseModel):
    """Stripe product model."""

    id: str
    name: str
    description: str | None = None
    active: bool = True
    metadata: dict[str, str] = Field(default_factory=dict)


class StripePrice(BaseModel):
    """Stripe price model."""

    id: str
    product_id: str
    unit_amount: int  # Amount in cents
    currency: str = "usd"
    recurring: dict[str, Any] | None = None  # {"interval": "month", "interval_count": 1}
    metadata: dict[str, str] = Field(default_factory=dict)


class PaymentLink(BaseModel):
    """Stripe payment link model."""

    id: str
    url: str
    active: bool = True
    product_id: str | None = None
    metadata: dict[str, str] = Field(default_factory=dict)


class SubscriptionStatus(str, Enum):
    """Subscription status enum."""

    ACTIVE = "active"
    CANCELED = "canceled"
    INCOMPLETE = "incomplete"
    INCOMPLETE_EXPIRED = "incomplete_expired"
    PAST_DUE = "past_due"
    TRIALING = "trialing"
    UNPAID = "unpaid"


class Subscription(BaseModel):
    """Stripe subscription model."""

    id: str
    customer_id: str
    status: SubscriptionStatus
    current_period_start: datetime
    current_period_end: datetime
    items: list[dict[str, Any]] = Field(default_factory=list)
    metadata: dict[str, str] = Field(default_factory=dict)


class WebhookEventType(str, Enum):
    """Webhook event types."""

    CHECKOUT_COMPLETED = "checkout.session.completed"
    SUBSCRIPTION_CREATED = "customer.subscription.created"
    SUBSCRIPTION_UPDATED = "customer.subscription.updated"
    SUBSCRIPTION_DELETED = "customer.subscription.deleted"
    INVOICE_PAID = "invoice.paid"
    INVOICE_PAYMENT_FAILED = "invoice.payment_failed"
    PAYMENT_INTENT_SUCCEEDED = "payment_intent.succeeded"
    PAYMENT_INTENT_FAILED = "payment_intent.payment_failed"


class WebhookEvent(BaseModel):
    """Stripe webhook event model."""

    id: str
    type: str
    data: dict[str, Any]
    created: datetime


class StripeService:
    """Service for interacting with Stripe API."""

    def __init__(self, api_key: str) -> None:
        """Initialize Stripe service.

        Args:
            api_key: Stripe API secret key
        """
        self.api_key = api_key
        stripe.api_key = api_key
        logger.info("Stripe service initialized")

    async def create_product(
        self, name: str, description: str, metadata: dict[str, str] | None = None
    ) -> StripeProduct:
        """Create a Stripe product.

        Args:
            name: Product name
            description: Product description
            metadata: Optional metadata dictionary

        Returns:
            StripeProduct model

        Raises:
            stripe.error.StripeError: If product creation fails
        """
        try:
            product_data = {
                "name": name,
                "description": description,
            }
            if metadata:
                product_data["metadata"] = metadata

            product = stripe.Product.create(**product_data)
            logger.info("Product created", product_id=product.id, name=name)

            return StripeProduct(
                id=product.id,
                name=product.name,
                description=product.description,
                active=product.active,
                metadata=product.metadata or {},
            )
        except stripe.error.StripeError as e:
            logger.error("Failed to create product", error=str(e), name=name)
            raise

    async def create_price(
        self,
        product_id: str,
        amount: int,
        currency: str = "usd",
        recurring: dict[str, Any] | None = None,
        metadata: dict[str, str] | None = None,
    ) -> StripePrice:
        """Create a price for a product.

        Args:
            product_id: Stripe product ID
            amount: Price amount in cents
            currency: Currency code (default: usd)
            recurring: Optional recurring billing config, e.g., {"interval": "month"}
            metadata: Optional metadata dictionary

        Returns:
            StripePrice model

        Raises:
            stripe.error.StripeError: If price creation fails
        """
        try:
            price_data: dict[str, Any] = {
                "product": product_id,
                "unit_amount": amount,
                "currency": currency,
            }

            if recurring:
                price_data["recurring"] = recurring

            if metadata:
                price_data["metadata"] = metadata

            price = stripe.Price.create(**price_data)
            logger.info(
                "Price created",
                price_id=price.id,
                product_id=product_id,
                amount=amount,
                currency=currency,
            )

            return StripePrice(
                id=price.id,
                product_id=product_id,
                unit_amount=price.unit_amount,
                currency=price.currency,
                recurring=price.recurring,
                metadata=price.metadata or {},
            )
        except stripe.error.StripeError as e:
            logger.error(
                "Failed to create price",
                error=str(e),
                product_id=product_id,
                amount=amount,
            )
            raise

    async def create_payment_link(
        self,
        price_id: str,
        success_url: str | None = None,
        cancel_url: str | None = None,
        metadata: dict[str, str] | None = None,
    ) -> PaymentLink:
        """Create a payment link for a price.

        Args:
            price_id: Stripe price ID
            success_url: Optional URL to redirect after successful payment
            cancel_url: Optional URL to redirect after canceled payment
            metadata: Optional metadata dictionary

        Returns:
            PaymentLink model

        Raises:
            stripe.error.StripeError: If payment link creation fails
        """
        try:
            link_data: dict[str, Any] = {
                "line_items": [{"price": price_id, "quantity": 1}],
            }

            if success_url:
                link_data["after_completion"] = {
                    "type": "redirect",
                    "redirect": {"url": success_url},
                }

            if metadata:
                link_data["metadata"] = metadata

            payment_link = stripe.PaymentLink.create(**link_data)
            logger.info(
                "Payment link created",
                payment_link_id=payment_link.id,
                price_id=price_id,
            )

            return PaymentLink(
                id=payment_link.id,
                url=payment_link.url,
                active=payment_link.active,
                metadata=payment_link.metadata or {},
            )
        except stripe.error.StripeError as e:
            logger.error(
                "Failed to create payment link", error=str(e), price_id=price_id
            )
            raise

    async def create_checkout_session(
        self,
        price_id: str,
        customer_email: str,
        success_url: str,
        cancel_url: str,
        metadata: dict[str, str] | None = None,
    ) -> str:
        """Create a Stripe Checkout session.

        Args:
            price_id: Stripe price ID
            customer_email: Customer email address
            success_url: URL to redirect after successful payment
            cancel_url: URL to redirect after canceled payment
            metadata: Optional metadata dictionary

        Returns:
            Checkout session URL

        Raises:
            stripe.error.StripeError: If session creation fails
        """
        try:
            session_data: dict[str, Any] = {
                "mode": "subscription",
                "line_items": [{"price": price_id, "quantity": 1}],
                "customer_email": customer_email,
                "success_url": success_url,
                "cancel_url": cancel_url,
            }

            if metadata:
                session_data["metadata"] = metadata

            session = stripe.checkout.Session.create(**session_data)
            logger.info(
                "Checkout session created",
                session_id=session.id,
                customer_email=customer_email,
            )

            return session.url
        except stripe.error.StripeError as e:
            logger.error(
                "Failed to create checkout session",
                error=str(e),
                customer_email=customer_email,
            )
            raise

    async def handle_webhook(
        self, payload: bytes, signature: str, webhook_secret: str
    ) -> WebhookEvent:
        """Handle and verify Stripe webhook event.

        Args:
            payload: Raw webhook payload
            signature: Stripe signature header
            webhook_secret: Webhook signing secret

        Returns:
            WebhookEvent model

        Raises:
            stripe.error.SignatureVerificationError: If signature verification fails
            ValueError: If event construction fails
        """
        try:
            event = stripe.Webhook.construct_event(payload, signature, webhook_secret)
            logger.info("Webhook received", event_type=event.type, event_id=event.id)

            return WebhookEvent(
                id=event.id,
                type=event.type,
                data=event.data.to_dict(),
                created=datetime.fromtimestamp(event.created),
            )
        except stripe.error.SignatureVerificationError as e:
            logger.error("Webhook signature verification failed", error=str(e))
            raise
        except ValueError as e:
            logger.error("Failed to construct webhook event", error=str(e))
            raise

    async def get_subscription(self, subscription_id: str) -> Subscription:
        """Get subscription details.

        Args:
            subscription_id: Stripe subscription ID

        Returns:
            Subscription model

        Raises:
            stripe.error.StripeError: If subscription retrieval fails
        """
        try:
            sub = stripe.Subscription.retrieve(subscription_id)
            logger.info(
                "Subscription retrieved",
                subscription_id=subscription_id,
                status=sub.status,
            )

            return Subscription(
                id=sub.id,
                customer_id=sub.customer,
                status=SubscriptionStatus(sub.status),
                current_period_start=datetime.fromtimestamp(sub.current_period_start),
                current_period_end=datetime.fromtimestamp(sub.current_period_end),
                items=[item.to_dict() for item in sub["items"]["data"]],
                metadata=sub.metadata or {},
            )
        except stripe.error.StripeError as e:
            logger.error(
                "Failed to retrieve subscription",
                error=str(e),
                subscription_id=subscription_id,
            )
            raise

    async def record_usage(
        self,
        subscription_item_id: str,
        quantity: int,
        timestamp: datetime | None = None,
        action: str = "increment",
    ) -> None:
        """Record usage for metered billing.

        Args:
            subscription_item_id: Stripe subscription item ID
            quantity: Usage quantity to record
            timestamp: Optional timestamp (default: now)
            action: "increment" or "set" (default: increment)

        Raises:
            stripe.error.StripeError: If usage record creation fails
        """
        try:
            usage_data: dict[str, Any] = {
                "quantity": quantity,
                "action": action,
            }

            if timestamp:
                usage_data["timestamp"] = int(timestamp.timestamp())

            stripe.SubscriptionItem.create_usage_record(
                subscription_item_id, **usage_data
            )
            logger.info(
                "Usage recorded",
                subscription_item_id=subscription_item_id,
                quantity=quantity,
                action=action,
            )
        except stripe.error.StripeError as e:
            logger.error(
                "Failed to record usage",
                error=str(e),
                subscription_item_id=subscription_item_id,
            )
            raise

    async def cancel_subscription(
        self, subscription_id: str, at_period_end: bool = True
    ) -> Subscription:
        """Cancel a subscription.

        Args:
            subscription_id: Stripe subscription ID
            at_period_end: If True, cancel at period end; if False, cancel immediately

        Returns:
            Updated Subscription model

        Raises:
            stripe.error.StripeError: If cancellation fails
        """
        try:
            if at_period_end:
                sub = stripe.Subscription.modify(
                    subscription_id, cancel_at_period_end=True
                )
            else:
                sub = stripe.Subscription.delete(subscription_id)

            logger.info(
                "Subscription canceled",
                subscription_id=subscription_id,
                at_period_end=at_period_end,
            )

            return Subscription(
                id=sub.id,
                customer_id=sub.customer,
                status=SubscriptionStatus(sub.status),
                current_period_start=datetime.fromtimestamp(sub.current_period_start),
                current_period_end=datetime.fromtimestamp(sub.current_period_end),
                items=[item.to_dict() for item in sub["items"]["data"]],
                metadata=sub.metadata or {},
            )
        except stripe.error.StripeError as e:
            logger.error(
                "Failed to cancel subscription",
                error=str(e),
                subscription_id=subscription_id,
            )
            raise
