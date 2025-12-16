"""Role definitions for MetaGPT orchestration.

This module defines the prompts and behaviors for different AI roles:
- PM (Product Manager): Creates PRDs and user stories
- Architect: Designs technical architecture and stack
- ProjectManager: Breaks down work into executable tasks
"""

from typing import Any

import structlog
from langchain_core.language_models import BaseChatModel
from langchain_core.prompts import ChatPromptTemplate
from langchain_openai import ChatOpenAI
from pydantic import BaseModel, Field

from ae_api.config import get_settings
from ae_api.genesis.niche_identification import NicheCandidate
from ae_api.genesis.validator_agent import ValidationReport

logger = structlog.get_logger()


class UserStory(BaseModel):
    """A single user story following standard format.

    Attributes:
        title: Short title for the story
        description: As a [user], I want [goal], so that [benefit]
        acceptance_criteria: List of testable acceptance criteria
        priority: Priority level (P0=critical, P1=high, P2=medium, P3=low)
        estimated_effort: T-shirt size (XS, S, M, L, XL)
    """

    title: str
    description: str
    acceptance_criteria: list[str]
    priority: str = "P2"
    estimated_effort: str = "M"


class ProductSpec(BaseModel):
    """Product specification output from PM role.

    Attributes:
        product_name: Name of the product
        vision_statement: One-sentence vision
        target_users: Detailed user persona(s)
        core_features: List of must-have features for MMP (Minimal Marketable Product)
        user_stories: Prioritized list of user stories
        success_metrics: KPIs to measure success
        go_to_market: Brief GTM strategy
    """

    product_name: str
    vision_statement: str
    target_users: str
    core_features: list[str]
    user_stories: list[UserStory]
    success_metrics: list[str]
    go_to_market: str


class TechnicalSpec(BaseModel):
    """Technical specification output from Architect role.

    Attributes:
        tech_stack: Selected technologies and rationale
        architecture_description: High-level architecture description
        architecture_diagram: Mermaid diagram of architecture
        data_models: Database schema/models
        api_design: Key API endpoints and contracts
        deployment_strategy: How the product will be deployed
        infrastructure_requirements: Cloud resources needed
        security_considerations: Security measures to implement
    """

    tech_stack: dict[str, str]  # component -> technology choice
    architecture_description: str
    architecture_diagram: str  # Mermaid syntax
    data_models: list[dict[str, Any]]
    api_design: list[dict[str, Any]]
    deployment_strategy: str
    infrastructure_requirements: list[str]
    security_considerations: list[str]


class TaskNode(BaseModel):
    """A single task in the task graph.

    Attributes:
        task_id: Unique identifier for the task
        title: Short task title
        description: Detailed task description
        assignee_role: Which role should handle this (frontend, backend, devops, etc.)
        estimated_hours: Estimated effort in hours
        dependencies: List of task_ids that must complete first
        acceptance_criteria: How to verify the task is complete
    """

    task_id: str
    title: str
    description: str
    assignee_role: str
    estimated_hours: float
    dependencies: list[str] = Field(default_factory=list)
    acceptance_criteria: list[str] = Field(default_factory=list)


class TaskGraph(BaseModel):
    """Dependency graph of tasks for implementation.

    Attributes:
        tasks: List of all tasks
        critical_path: List of task_ids on the critical path
        total_estimated_hours: Sum of all task hours
        parallel_workstreams: Groups of tasks that can run in parallel
    """

    tasks: list[TaskNode]
    critical_path: list[str]
    total_estimated_hours: float
    parallel_workstreams: list[list[str]] = Field(default_factory=list)


class PMRole:
    """Product Manager role that creates PRDs and user stories.

    This role takes a validated niche and produces a complete product specification
    including vision, features, user stories, and success metrics.
    """

    def __init__(self, llm: BaseChatModel | None = None):
        """Initialize the PM role.

        Args:
            llm: Language model to use (defaults to tier1 model)
        """
        settings = get_settings()

        self.llm = llm or ChatOpenAI(
            model=settings.tier1_model,
            temperature=0.7,
            api_key=settings.openai_api_key.get_secret_value() if settings.openai_api_key else None,
        )

    async def create_product_spec(
        self,
        niche: NicheCandidate,
        validation_report: ValidationReport,
    ) -> ProductSpec:
        """Create a comprehensive product specification.

        Args:
            niche: The validated niche opportunity
            validation_report: Validation results and metrics

        Returns:
            ProductSpec with PRD, user stories, and MMP definition
        """
        logger.info("creating_product_spec", niche_name=niche.name)

        prompt = ChatPromptTemplate.from_messages([
            ("system", """You are an experienced Product Manager creating a PRD (Product Requirements Document).

Your goal is to define a Minimal Marketable Product (MMP) - the smallest product that:
1. Solves the core pain points
2. Delivers measurable value
3. Can be built in 4-8 weeks
4. Has clear go-to-market path

Create a comprehensive product spec that includes:
- Clear product vision (one sentence)
- Detailed target user persona
- 5-10 core features for MMP
- 10-15 prioritized user stories with acceptance criteria
- Success metrics (KPIs)
- Brief go-to-market strategy

User stories should follow the format:
"As a [user], I want [goal], so that [benefit]"

Return ONLY valid JSON matching this structure:
{{
  "product_name": "Clear, memorable name",
  "vision_statement": "One sentence vision",
  "target_users": "Detailed persona description",
  "core_features": ["feature1", "feature2", ...],
  "user_stories": [
    {{
      "title": "Story title",
      "description": "As a X, I want Y, so that Z",
      "acceptance_criteria": ["criteria1", "criteria2", ...],
      "priority": "P0|P1|P2|P3",
      "estimated_effort": "XS|S|M|L|XL"
    }}
  ],
  "success_metrics": ["metric1", "metric2", ...],
  "go_to_market": "GTM strategy description"
}}"""),
            ("human", """Niche Opportunity:
Name: {niche_name}
Description: {niche_description}
Pain Points: {pain_points}
Target Audience: {target_audience}
Value Proposition: {value_proposition}

Validation Results:
Validation Score: {validation_score}/100
Should Pursue: {should_pursue}
Search Volume: {search_volume}/month
Estimated ARPU: ${arpu}/month
B2B Intent Score: {b2b_score}/100

Strengths: {strengths}
Weaknesses: {weaknesses}
Recommendations: {recommendations}

Create a comprehensive product specification for this opportunity."""),
        ])

        chain = prompt | self.llm

        response = await chain.ainvoke({
            "niche_name": niche.name,
            "niche_description": niche.description,
            "pain_points": "\n- " + "\n- ".join(niche.pain_points),
            "target_audience": niche.target_audience,
            "value_proposition": niche.value_proposition,
            "validation_score": validation_report.validation_score,
            "should_pursue": validation_report.should_pursue,
            "search_volume": validation_report.metrics.search_volume,
            "arpu": validation_report.metrics.estimated_arpu,
            "b2b_score": validation_report.metrics.b2b_intent_score,
            "strengths": "\n- " + "\n- ".join(validation_report.strengths),
            "weaknesses": "\n- " + "\n- ".join(validation_report.weaknesses),
            "recommendations": "\n- " + "\n- ".join(validation_report.recommendations),
        })

        # Parse response
        import json

        response_text = response.content if hasattr(response, 'content') else str(response)
        start_idx = response_text.find('{')
        end_idx = response_text.rfind('}') + 1

        if start_idx == -1 or end_idx == 0:
            raise ValueError("PM response did not contain valid JSON")

        json_str = response_text[start_idx:end_idx]
        data = json.loads(json_str)

        # Convert user stories
        user_stories = []
        for story_data in data.get("user_stories", []):
            user_stories.append(UserStory(**story_data))

        product_spec = ProductSpec(
            product_name=data["product_name"],
            vision_statement=data["vision_statement"],
            target_users=data["target_users"],
            core_features=data["core_features"],
            user_stories=user_stories,
            success_metrics=data["success_metrics"],
            go_to_market=data["go_to_market"],
        )

        logger.info(
            "product_spec_created",
            product_name=product_spec.product_name,
            feature_count=len(product_spec.core_features),
            story_count=len(product_spec.user_stories),
        )

        return product_spec


class ArchitectRole:
    """Software Architect role that designs technical architecture.

    This role takes a product spec and produces a detailed technical specification
    including tech stack, architecture, data models, and deployment strategy.
    """

    def __init__(self, llm: BaseChatModel | None = None):
        """Initialize the Architect role.

        Args:
            llm: Language model to use (defaults to tier1 model)
        """
        settings = get_settings()

        self.llm = llm or ChatOpenAI(
            model=settings.tier1_model,
            temperature=0.5,  # Lower temperature for more consistent architecture
            api_key=settings.openai_api_key.get_secret_value() if settings.openai_api_key else None,
        )

    async def create_technical_spec(
        self,
        product_spec: ProductSpec,
        niche: NicheCandidate,
    ) -> TechnicalSpec:
        """Create a comprehensive technical specification.

        Args:
            product_spec: The product specification from PM
            niche: The original niche candidate

        Returns:
            TechnicalSpec with architecture, stack, and schemas
        """
        logger.info("creating_technical_spec", product_name=product_spec.product_name)

        prompt = ChatPromptTemplate.from_messages([
            ("system", """You are an experienced Software Architect designing a micro-SaaS product.

Your goal is to design a:
- Modern, scalable architecture
- Simple but robust tech stack
- Clear data models
- RESTful API design
- Cloud-native deployment strategy

Prioritize:
- Time to market (use proven, productive technologies)
- Operational simplicity (managed services over custom infrastructure)
- Cost efficiency (serverless/pay-per-use where possible)
- Developer productivity (modern frameworks, good DX)

For a B2B SaaS, typical stack includes:
- Frontend: React/Next.js or similar modern framework
- Backend: Python/FastAPI, Node.js/Express, or Go
- Database: PostgreSQL (structured data) + Redis (cache)
- Auth: Auth0, Clerk, or similar
- Deployment: Vercel/Netlify (frontend) + AWS/GCP/Railway (backend)
- Observability: Sentry, PostHog, or similar

Return ONLY valid JSON matching this structure:
{{
  "tech_stack": {{
    "frontend": "Choice and why",
    "backend": "Choice and why",
    "database": "Choice and why",
    "auth": "Choice and why",
    "hosting": "Choice and why",
    "other": "Any other key technologies"
  }},
  "architecture_description": "Detailed description of the architecture",
  "architecture_diagram": "Mermaid diagram syntax",
  "data_models": [
    {{
      "name": "ModelName",
      "description": "What it represents",
      "fields": [{{"name": "field", "type": "type", "description": "desc"}}]
    }}
  ],
  "api_design": [
    {{
      "method": "GET|POST|PUT|DELETE",
      "path": "/api/resource",
      "description": "What it does",
      "request": {{}},
      "response": {{}}
    }}
  ],
  "deployment_strategy": "Description of how to deploy",
  "infrastructure_requirements": ["requirement1", "requirement2"],
  "security_considerations": ["consideration1", "consideration2"]
}}"""),
            ("human", """Product Specification:
Product Name: {product_name}
Vision: {vision}
Target Users: {target_users}

Core Features:
{core_features}

User Stories (first 5):
{user_stories}

Design the technical architecture for this product."""),
        ])

        chain = prompt | self.llm

        # Format user stories
        story_summary = "\n".join([
            f"{i+1}. {story.title}: {story.description}"
            for i, story in enumerate(product_spec.user_stories[:5])
        ])

        response = await chain.ainvoke({
            "product_name": product_spec.product_name,
            "vision": product_spec.vision_statement,
            "target_users": product_spec.target_users,
            "core_features": "\n- " + "\n- ".join(product_spec.core_features),
            "user_stories": story_summary,
        })

        # Parse response
        import json

        response_text = response.content if hasattr(response, 'content') else str(response)
        start_idx = response_text.find('{')
        end_idx = response_text.rfind('}') + 1

        if start_idx == -1 or end_idx == 0:
            raise ValueError("Architect response did not contain valid JSON")

        json_str = response_text[start_idx:end_idx]
        data = json.loads(json_str)

        technical_spec = TechnicalSpec(**data)

        logger.info(
            "technical_spec_created",
            product_name=product_spec.product_name,
            model_count=len(technical_spec.data_models),
            api_count=len(technical_spec.api_design),
        )

        return technical_spec


class ProjectManagerRole:
    """Project Manager role that creates task graphs.

    This role takes product and technical specs and breaks them down into
    a dependency graph of concrete, executable tasks.
    """

    def __init__(self, llm: BaseChatModel | None = None):
        """Initialize the Project Manager role.

        Args:
            llm: Language model to use (defaults to tier1 model)
        """
        settings = get_settings()

        self.llm = llm or ChatOpenAI(
            model=settings.tier1_model,
            temperature=0.3,  # Lower temperature for consistent task breakdown
            api_key=settings.openai_api_key.get_secret_value() if settings.openai_api_key else None,
        )

    async def create_task_graph(
        self,
        product_spec: ProductSpec,
        technical_spec: TechnicalSpec,
    ) -> TaskGraph:
        """Create a dependency graph of tasks for implementation.

        Args:
            product_spec: Product specification from PM
            technical_spec: Technical specification from Architect

        Returns:
            TaskGraph with all tasks and dependencies
        """
        logger.info("creating_task_graph", product_name=product_spec.product_name)

        prompt = ChatPromptTemplate.from_messages([
            ("system", """You are an experienced Project Manager breaking down work into tasks.

Your goal is to create a complete task graph that:
1. Covers all aspects of building the MMP
2. Has clear dependencies between tasks
3. Identifies parallel workstreams
4. Includes realistic time estimates
5. Assigns tasks to appropriate roles

Task categories to include:
- Project setup (repo, CI/CD, environments)
- Backend implementation (models, APIs, auth)
- Frontend implementation (pages, components, state)
- Integration and testing
- Deployment and monitoring
- Documentation

Each task should be:
- Concrete and actionable
- Small enough to complete in 1-2 days
- Assigned to a specific role (backend, frontend, devops, qa)
- Have clear acceptance criteria

Return ONLY valid JSON matching this structure:
{{
  "tasks": [
    {{
      "task_id": "unique-id",
      "title": "Short title",
      "description": "Detailed description",
      "assignee_role": "backend|frontend|devops|qa|design",
      "estimated_hours": 8.0,
      "dependencies": ["task-id-1", "task-id-2"],
      "acceptance_criteria": ["criteria1", "criteria2"]
    }}
  ],
  "critical_path": ["task-id-1", "task-id-2"],
  "total_estimated_hours": 200.0,
  "parallel_workstreams": [
    ["task-1", "task-2"],
    ["task-3", "task-4"]
  ]
}}"""),
            ("human", """Product: {product_name}

Core Features:
{core_features}

User Stories (count: {story_count}):
{user_stories}

Tech Stack:
{tech_stack}

Data Models: {model_count}
API Endpoints: {api_count}

Break down the implementation into a complete task graph."""),
        ])

        chain = prompt | self.llm

        # Format user stories
        story_summary = "\n".join([
            f"{i+1}. [{story.priority}] {story.title} ({story.estimated_effort})"
            for i, story in enumerate(product_spec.user_stories)
        ])

        # Format tech stack
        tech_stack_summary = "\n".join([
            f"- {key}: {value}"
            for key, value in technical_spec.tech_stack.items()
        ])

        response = await chain.ainvoke({
            "product_name": product_spec.product_name,
            "core_features": "\n- " + "\n- ".join(product_spec.core_features),
            "story_count": len(product_spec.user_stories),
            "user_stories": story_summary,
            "tech_stack": tech_stack_summary,
            "model_count": len(technical_spec.data_models),
            "api_count": len(technical_spec.api_design),
        })

        # Parse response
        import json

        response_text = response.content if hasattr(response, 'content') else str(response)
        start_idx = response_text.find('{')
        end_idx = response_text.rfind('}') + 1

        if start_idx == -1 or end_idx == 0:
            raise ValueError("ProjectManager response did not contain valid JSON")

        json_str = response_text[start_idx:end_idx]
        data = json.loads(json_str)

        # Convert tasks
        tasks = [TaskNode(**task_data) for task_data in data["tasks"]]

        task_graph = TaskGraph(
            tasks=tasks,
            critical_path=data["critical_path"],
            total_estimated_hours=data["total_estimated_hours"],
            parallel_workstreams=data.get("parallel_workstreams", []),
        )

        logger.info(
            "task_graph_created",
            product_name=product_spec.product_name,
            task_count=len(task_graph.tasks),
            total_hours=task_graph.total_estimated_hours,
        )

        return task_graph
