"""MetaGPT orchestration runner.

This module orchestrates the PM, Architect, and ProjectManager roles sequentially
to transform a validated niche opportunity into a complete product specification,
technical design, and implementation task graph.
"""

import structlog
from langchain_core.language_models import BaseChatModel

from ae_api.genesis.metapm.roles import (
    ArchitectRole,
    PMRole,
    ProductSpec,
    ProjectManagerRole,
    TaskGraph,
    TechnicalSpec,
)
from ae_api.genesis.niche_identification import NicheCandidate
from ae_api.genesis.validator_agent import ValidationReport

logger = structlog.get_logger()


class MetaGPTRunner:
    """Orchestrates multiple AI roles to generate complete product specifications.

    This runner executes a sequential workflow:
    1. PM Role: Generates ProductSpec (PRD, user stories, MMP definition)
    2. Architect Role: Generates TechnicalSpec (stack, architecture, schemas)
    3. ProjectManager Role: Generates TaskGraph (dependency graph of tasks)

    The output is a complete package ready for implementation.
    """

    def __init__(self, llm: BaseChatModel | None = None):
        """Initialize the MetaGPT runner.

        Args:
            llm: Language model to use across all roles (defaults to tier1 model)
        """
        self.pm_role = PMRole(llm=llm)
        self.architect_role = ArchitectRole(llm=llm)
        self.project_manager_role = ProjectManagerRole(llm=llm)

    async def run(
        self,
        niche: NicheCandidate,
        validation_report: ValidationReport,
    ) -> tuple[ProductSpec, TechnicalSpec, TaskGraph]:
        """Execute the full MetaGPT workflow.

        This method orchestrates all three roles sequentially to produce
        a complete specification package.

        Args:
            niche: The validated niche opportunity
            validation_report: Validation results and metrics

        Returns:
            Tuple of (ProductSpec, TechnicalSpec, TaskGraph)

        Raises:
            ValueError: If any role fails to produce valid output
            Exception: If orchestration fails
        """
        logger.info("starting_metagpt_workflow", niche_name=niche.name)

        try:
            # Phase 1: PM creates product specification
            logger.info("phase_1_pm_role", niche_name=niche.name)
            product_spec = await self.pm_role.create_product_spec(
                niche=niche,
                validation_report=validation_report,
            )
            logger.info(
                "phase_1_complete",
                product_name=product_spec.product_name,
                features=len(product_spec.core_features),
                stories=len(product_spec.user_stories),
            )

            # Phase 2: Architect creates technical specification
            logger.info("phase_2_architect_role", product_name=product_spec.product_name)
            technical_spec = await self.architect_role.create_technical_spec(
                product_spec=product_spec,
                niche=niche,
            )
            logger.info(
                "phase_2_complete",
                models=len(technical_spec.data_models),
                apis=len(technical_spec.api_design),
            )

            # Phase 3: Project Manager creates task graph
            logger.info("phase_3_project_manager_role", product_name=product_spec.product_name)
            task_graph = await self.project_manager_role.create_task_graph(
                product_spec=product_spec,
                technical_spec=technical_spec,
            )
            logger.info(
                "phase_3_complete",
                tasks=len(task_graph.tasks),
                estimated_hours=task_graph.total_estimated_hours,
            )

            logger.info(
                "metagpt_workflow_complete",
                product_name=product_spec.product_name,
                total_stories=len(product_spec.user_stories),
                total_tasks=len(task_graph.tasks),
                estimated_hours=task_graph.total_estimated_hours,
            )

            return product_spec, technical_spec, task_graph

        except Exception as e:
            logger.error("metagpt_workflow_failed", error=str(e), niche_name=niche.name)
            raise

    async def run_pm_only(
        self,
        niche: NicheCandidate,
        validation_report: ValidationReport,
    ) -> ProductSpec:
        """Run only the PM phase to generate product spec.

        Useful for quick iteration on product definition without full architecture.

        Args:
            niche: The validated niche opportunity
            validation_report: Validation results and metrics

        Returns:
            ProductSpec from PM role
        """
        logger.info("running_pm_only", niche_name=niche.name)
        return await self.pm_role.create_product_spec(
            niche=niche,
            validation_report=validation_report,
        )

    async def run_architect_only(
        self,
        product_spec: ProductSpec,
        niche: NicheCandidate,
    ) -> TechnicalSpec:
        """Run only the Architect phase to generate technical spec.

        Useful when you have a product spec and want to explore architecture options.

        Args:
            product_spec: The product specification
            niche: The original niche candidate

        Returns:
            TechnicalSpec from Architect role
        """
        logger.info("running_architect_only", product_name=product_spec.product_name)
        return await self.architect_role.create_technical_spec(
            product_spec=product_spec,
            niche=niche,
        )

    async def run_project_manager_only(
        self,
        product_spec: ProductSpec,
        technical_spec: TechnicalSpec,
    ) -> TaskGraph:
        """Run only the Project Manager phase to generate task graph.

        Useful when you have specs and want to regenerate the task breakdown.

        Args:
            product_spec: The product specification
            technical_spec: The technical specification

        Returns:
            TaskGraph from ProjectManager role
        """
        logger.info("running_project_manager_only", product_name=product_spec.product_name)
        return await self.project_manager_role.create_task_graph(
            product_spec=product_spec,
            technical_spec=technical_spec,
        )

    async def regenerate_from_product_spec(
        self,
        product_spec: ProductSpec,
        niche: NicheCandidate,
    ) -> tuple[TechnicalSpec, TaskGraph]:
        """Regenerate architecture and tasks from an existing product spec.

        Useful when you want to keep the product definition but explore
        different technical approaches or task breakdowns.

        Args:
            product_spec: The existing product specification
            niche: The original niche candidate

        Returns:
            Tuple of (TechnicalSpec, TaskGraph)
        """
        logger.info("regenerating_from_product_spec", product_name=product_spec.product_name)

        # Run architect and project manager phases
        technical_spec = await self.run_architect_only(product_spec, niche)
        task_graph = await self.run_project_manager_only(product_spec, technical_spec)

        logger.info(
            "regeneration_complete",
            product_name=product_spec.product_name,
            tasks=len(task_graph.tasks),
            estimated_hours=task_graph.total_estimated_hours,
        )

        return technical_spec, task_graph
