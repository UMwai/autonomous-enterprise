"""Example usage of the Model Router (Cognitive Economy) system.

This script demonstrates how to:
1. Classify task complexity
2. Route tasks to appropriate models
3. Complete tasks with automatic routing
4. Track costs and budgets
"""

import asyncio

# Add parent directory to path for imports
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from ae_api.config import Settings
from ae_api.economy.classifier import SemanticClassifier
from ae_api.economy.providers import AnthropicProvider
from ae_api.economy.router import ModelRouter, ModelTier


async def example_classification():
    """Example 1: Task Classification."""
    print("=" * 80)
    print("EXAMPLE 1: Task Classification")
    print("=" * 80)

    settings = Settings()
    classifier = SemanticClassifier(settings)

    # Test various tasks
    tasks = [
        "Format this JSON file",
        "Implement a REST API endpoint for user registration",
        "Design a microservices architecture for a high-scale e-commerce platform",
        "Delete all production database records",
    ]

    for task in tasks:
        print(f"\nTask: {task}")
        result = await classifier.classify(task)
        print(f"  Complexity: {result.complexity.value} (score: {result.complexity_score}/10)")
        print(f"  Risk: {result.risk.value}")
        print(f"  Suggested Tier: {result.suggested_tier}")
        print(f"  Reasoning: {result.reasoning}")


async def example_routing():
    """Example 2: Intelligent Routing."""
    print("\n" + "=" * 80)
    print("EXAMPLE 2: Intelligent Routing")
    print("=" * 80)

    settings = Settings()
    classifier = SemanticClassifier(settings)
    router = ModelRouter(settings, classifier)

    # Test routing decisions
    tasks = [
        "Write a hello world function in Python",
        "Build a user authentication system with JWT",
        "Debug a race condition in our payment processing system",
    ]

    for task in tasks:
        print(f"\nTask: {task}")
        decision = await router.route(task)
        print(f"  Tier: {decision.tier.value}")
        print(f"  Model: {decision.model_id}")
        print(f"  Provider: {decision.provider}")
        print(f"  Estimated Cost: ${decision.estimated_cost:.6f}")
        print(f"  Reasoning: {decision.reasoning}")


async def example_tier_override():
    """Example 3: Tier Override."""
    print("\n" + "=" * 80)
    print("EXAMPLE 3: Manual Tier Override")
    print("=" * 80)

    settings = Settings()
    classifier = SemanticClassifier(settings)
    router = ModelRouter(settings, classifier)

    task = "Write a simple README file"

    # First, let the router decide
    print(f"\nTask: {task}")
    print("\nAutomatic routing:")
    decision1 = await router.route(task)
    print(f"  Tier: {decision1.tier.value}")
    print(f"  Model: {decision1.model_id}")

    # Override to use highest tier
    print("\nWith TIER1 override:")
    decision2 = await router.route(task, override_tier=ModelTier.TIER1_ARCHITECT)
    print(f"  Tier: {decision2.tier.value}")
    print(f"  Model: {decision2.model_id}")
    print(f"  Cost difference: ${decision2.estimated_cost - decision1.estimated_cost:.6f}")


async def example_budget_tracking():
    """Example 4: Budget Tracking."""
    print("\n" + "=" * 80)
    print("EXAMPLE 4: Budget Tracking")
    print("=" * 80)

    settings = Settings()
    settings.default_run_budget = 0.10  # Set low budget for demo
    classifier = SemanticClassifier(settings)
    router = ModelRouter(settings, classifier)

    run_id = "demo-run-123"
    task = "Implement a complex distributed system"

    print(f"\nRun ID: {run_id}")
    print(f"Budget: ${settings.default_run_budget:.2f}")

    # First request
    print("\nRequest 1:")
    decision1 = await router.route(task, run_id=run_id)
    router.record_usage(run_id, decision1.estimated_cost)
    usage1 = router.get_run_usage(run_id)
    print(f"  Tier: {decision1.tier.value}")
    print(f"  Cost: ${decision1.estimated_cost:.6f}")
    print(f"  Total usage: ${usage1:.6f}")

    # Simulate multiple requests to exceed budget
    for i in range(2, 5):
        print(f"\nRequest {i}:")
        decision = await router.route(task, run_id=run_id)
        router.record_usage(run_id, decision.estimated_cost)
        usage = router.get_run_usage(run_id)
        print(f"  Tier: {decision.tier.value} (may be downgraded due to budget)")
        print(f"  Cost: ${decision.estimated_cost:.6f}")
        print(f"  Total usage: ${usage:.6f}")
        print(f"  Remaining: ${settings.default_run_budget - usage:.6f}")

    # Reset budget
    router.reset_run_budget(run_id)
    print(f"\nBudget reset. New usage: ${router.get_run_usage(run_id):.6f}")


async def example_completion():
    """Example 5: Complete Prompt (requires API keys)."""
    print("\n" + "=" * 80)
    print("EXAMPLE 5: Complete Prompt with Routing")
    print("=" * 80)

    settings = Settings()

    # Check if API keys are configured
    if not settings.anthropic_api_key:
        print("\nSkipping completion example - Anthropic API key not configured")
        print("Set ANTHROPIC_API_KEY environment variable to test completions")
        return

    classifier = SemanticClassifier(settings)
    router = ModelRouter(settings, classifier)

    # Initialize provider
    provider = AnthropicProvider(settings)

    task = "Write a haiku about artificial intelligence"

    print(f"\nTask: {task}")

    # Route the task
    decision = await router.route(task)
    print("\nRouting Decision:")
    print(f"  Tier: {decision.tier.value}")
    print(f"  Model: {decision.model_id}")
    print(f"  Estimated Cost: ${decision.estimated_cost:.6f}")

    # Complete the task
    print("\nGenerating completion...")
    completion = await provider.complete(
        prompt=task,
        model=decision.model_id,
        temperature=0.7,
        max_tokens=100,
    )

    print("\nCompletion:")
    print(f"  {completion.content}")
    print(f"\nActual Cost: ${completion.cost:.6f}")
    print(f"Usage: {completion.usage}")


async def example_tier_info():
    """Example 6: Get Tier Information."""
    print("\n" + "=" * 80)
    print("EXAMPLE 6: Tier Information")
    print("=" * 80)

    settings = Settings()
    classifier = SemanticClassifier(settings)
    router = ModelRouter(settings, classifier)

    tier_info = router.get_tier_info()

    for tier_name, info in tier_info.items():
        print(f"\n{tier_name}:")
        print(f"  Default Model: {info['default_model']}")
        print("  Available Models:")
        for model in info['models']:
            print(f"    - {model['provider']}: {model['model']}")
        print("  Use Cases:")
        for use_case in info['use_cases'][:3]:  # Show first 3
            print(f"    - {use_case}")


async def main():
    """Run all examples."""
    print("\n")
    print("*" * 80)
    print("MODEL ROUTER (COGNITIVE ECONOMY) EXAMPLES")
    print("*" * 80)

    # Run examples that don't require API keys
    await example_tier_info()
    await example_classification()
    await example_routing()
    await example_tier_override()
    await example_budget_tracking()

    # Run completion example if API key available
    await example_completion()

    print("\n" + "*" * 80)
    print("Examples complete!")
    print("*" * 80 + "\n")


if __name__ == "__main__":
    asyncio.run(main())
