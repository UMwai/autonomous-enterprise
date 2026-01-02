"""SEO/keyword validation agent for niche opportunities.

This module provides capabilities for validating niche candidates through:
- Search volume estimation
- Keyword difficulty analysis
- Competitor density assessment
- B2B intent scoring
- ARPU (Average Revenue Per User) estimation
"""

import asyncio
import re

import httpx
import structlog
from langchain_core.language_models import BaseChatModel
from langchain_core.prompts import ChatPromptTemplate
from langchain_openai import ChatOpenAI
from pydantic import BaseModel, Field
from tenacity import retry, stop_after_attempt, wait_exponential

from ae_api.config import get_settings
from ae_api.genesis.niche_identification import NicheCandidate

logger = structlog.get_logger()


class ValidationMetrics(BaseModel):
    """Metrics for validating a niche opportunity.

    Attributes:
        search_volume: Estimated monthly search volume for key terms
        keyword_difficulty: SEO difficulty score (0-100, higher = harder)
        competitor_density: Number of direct competitors identified
        b2b_intent_score: Likelihood this is a B2B opportunity (0-100)
        estimated_arpu: Estimated average revenue per user (monthly, in USD)
        market_size_estimate: Rough estimate of addressable market size
    """

    search_volume: int = 0
    keyword_difficulty: float = 0.0
    competitor_density: int = 0
    b2b_intent_score: float = 0.0
    estimated_arpu: float = 0.0
    market_size_estimate: str = ""


class ValidationReport(BaseModel):
    """Comprehensive validation report for a niche candidate.

    Attributes:
        niche: The niche candidate being validated
        metrics: Quantitative validation metrics
        validation_score: Overall validation score (0-100)
        strengths: List of identified strengths
        weaknesses: List of identified weaknesses
        recommendations: Actionable recommendations
        should_pursue: Whether to pursue this opportunity
    """

    niche: NicheCandidate
    metrics: ValidationMetrics
    validation_score: float = 0.0
    strengths: list[str] = Field(default_factory=list)
    weaknesses: list[str] = Field(default_factory=list)
    recommendations: list[str] = Field(default_factory=list)
    should_pursue: bool = False


class ValidatorAgent:
    """Agent for validating niche opportunities through SEO and market analysis.

    This agent performs comprehensive validation by analyzing search trends,
    competition, and market characteristics to determine niche viability.
    """

    def __init__(self, llm: BaseChatModel | None = None):
        """Initialize the validator agent.

        Args:
            llm: Language model for analysis (defaults to tier1 model)
        """
        settings = get_settings()

        self.llm = llm or ChatOpenAI(
            model=settings.tier1_model,
            temperature=0.3,  # Lower temperature for more factual analysis
            api_key=settings.openai_api_key.get_secret_value() if settings.openai_api_key else None,
        )

        self.http_client = httpx.AsyncClient(
            timeout=30.0,
            headers={"User-Agent": "AutonomousEnterprise/0.1.0"},
        )

    async def __aenter__(self):
        """Async context manager entry."""
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """Async context manager exit."""
        await self.http_client.aclose()

    async def validate_niche(self, niche: NicheCandidate) -> ValidationReport:
        """Run full validation on a niche candidate.

        This method orchestrates all validation checks and produces a comprehensive
        report with actionable recommendations.

        Args:
            niche: The NicheCandidate to validate

        Returns:
            ValidationReport with all metrics and analysis
        """
        logger.info("validating_niche", niche_name=niche.name)

        try:
            # Generate keywords from niche
            keywords = await self._extract_keywords(niche)
            logger.info("extracted_keywords", count=len(keywords), keywords=keywords[:5])

            # Run validation checks in parallel
            search_volume_task = self.check_search_volume(keywords)
            competition_task = self.analyze_competition(niche.name)
            arpu_task = self.estimate_arpu(niche.name)
            b2b_score_task = self._score_b2b_intent(niche)

            search_volume, competitor_density, estimated_arpu, b2b_intent_score = await asyncio.gather(
                search_volume_task,
                competition_task,
                arpu_task,
                b2b_score_task,
            )

            # Calculate keyword difficulty (simplified heuristic)
            keyword_difficulty = await self._calculate_keyword_difficulty(
                keywords, search_volume, competitor_density
            )

            # Estimate market size
            market_size = await self._estimate_market_size(niche, search_volume)

            # Create metrics
            metrics = ValidationMetrics(
                search_volume=search_volume,
                keyword_difficulty=keyword_difficulty,
                competitor_density=competitor_density,
                b2b_intent_score=b2b_intent_score,
                estimated_arpu=estimated_arpu,
                market_size_estimate=market_size,
            )

            # Calculate overall validation score
            validation_score = self._calculate_validation_score(niche, metrics)

            # Generate analysis
            strengths, weaknesses, recommendations = await self._generate_analysis(
                niche, metrics
            )

            # Determine if should pursue (score >= 60 and no critical weaknesses)
            should_pursue = validation_score >= 60.0 and b2b_intent_score >= 40.0

            report = ValidationReport(
                niche=niche,
                metrics=metrics,
                validation_score=validation_score,
                strengths=strengths,
                weaknesses=weaknesses,
                recommendations=recommendations,
                should_pursue=should_pursue,
            )

            logger.info(
                "validation_complete",
                niche_name=niche.name,
                score=validation_score,
                should_pursue=should_pursue,
            )

            return report

        except Exception as e:
            logger.error("validation_failed", error=str(e), niche_name=niche.name)
            raise

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(min=1, max=10))
    async def check_search_volume(self, keywords: list[str]) -> int:
        """Estimate search volume for keywords.

        This is a simplified estimation. In production, integrate with:
        - Google Keyword Planner API
        - SEMrush API
        - Ahrefs API

        Args:
            keywords: List of keywords to check

        Returns:
            Estimated total monthly search volume
        """
        logger.info("checking_search_volume", keyword_count=len(keywords))

        try:
            # Use LLM to estimate based on keyword characteristics
            # In production, replace with actual API calls
            prompt = ChatPromptTemplate.from_messages([
                ("system", """You are an SEO expert estimating search volumes.
Based on the keywords provided, estimate the total monthly search volume.

Consider:
- Keyword specificity (niche terms = lower volume)
- B2B vs B2C (B2B typically lower)
- Industry size and digitization
- Keyword variations and long-tail terms

Return ONLY a JSON object:
{{
  "estimated_monthly_searches": <number>,
  "confidence": "low|medium|high",
  "reasoning": "brief explanation"
}}"""),
                ("human", "Keywords: {keywords}\n\nEstimate the total monthly search volume."),
            ])

            chain = prompt | self.llm
            response = await chain.ainvoke({"keywords": ", ".join(keywords[:10])})

            # Parse response
            import json

            response_text = response.content if hasattr(response, 'content') else str(response)
            start_idx = response_text.find('{')
            end_idx = response_text.rfind('}') + 1

            if start_idx != -1 and end_idx != 0:
                json_str = response_text[start_idx:end_idx]
                data = json.loads(json_str)
                volume = int(data.get("estimated_monthly_searches", 1000))
                logger.info("search_volume_estimated", volume=volume)
                return volume

            # Default fallback
            return 1000

        except Exception as e:
            logger.warning("search_volume_estimation_failed", error=str(e))
            return 1000  # Conservative default

    async def analyze_competition(self, niche: str) -> int:
        """Analyze competitor density for a niche.

        This performs web searches to identify direct competitors.
        In production, integrate with:
        - Google Custom Search API
        - Crunchbase API
        - Product Hunt API

        Args:
            niche: The niche to analyze

        Returns:
            Number of direct competitors identified
        """
        logger.info("analyzing_competition", niche=niche)

        try:
            # Use LLM to estimate based on niche characteristics
            # In production, perform actual web searches
            prompt = ChatPromptTemplate.from_messages([
                ("system", """You are a market research expert analyzing competition.
Based on the niche description, estimate the number of direct competitors.

Consider:
- Market maturity
- Barriers to entry
- Typical industry concentration
- Whether it's B2B or B2C

Return ONLY a JSON object:
{{
  "estimated_competitors": <number>,
  "market_maturity": "nascent|emerging|mature|saturated",
  "reasoning": "brief explanation"
}}"""),
                ("human", "Niche: {niche}\n\nEstimate the competitor landscape."),
            ])

            chain = prompt | self.llm
            response = await chain.ainvoke({"niche": niche})

            # Parse response
            import json

            response_text = response.content if hasattr(response, 'content') else str(response)
            start_idx = response_text.find('{')
            end_idx = response_text.rfind('}') + 1

            if start_idx != -1 and end_idx != 0:
                json_str = response_text[start_idx:end_idx]
                data = json.loads(json_str)
                competitors = int(data.get("estimated_competitors", 10))
                logger.info("competition_analyzed", competitors=competitors)
                return competitors

            return 10  # Default

        except Exception as e:
            logger.warning("competition_analysis_failed", error=str(e))
            return 10  # Conservative default

    async def estimate_arpu(self, niche: str) -> float:
        """Estimate average revenue per user for the niche.

        Uses industry benchmarks and niche characteristics to estimate
        what customers would be willing to pay monthly.

        Args:
            niche: The niche to analyze

        Returns:
            Estimated monthly ARPU in USD
        """
        logger.info("estimating_arpu", niche=niche)

        try:
            prompt = ChatPromptTemplate.from_messages([
                ("system", """You are a SaaS pricing expert estimating ARPU.
Based on the niche, estimate the monthly ARPU (Average Revenue Per User).

Consider:
- B2B typically pays more than B2C
- Enterprise tools: $100-500+/mo
- SMB tools: $20-100/mo
- Prosumer tools: $10-50/mo
- Value delivered and ROI
- Market willingness to pay

Return ONLY a JSON object:
{{
  "estimated_monthly_arpu": <number in USD>,
  "pricing_tier": "freemium|basic|professional|enterprise",
  "reasoning": "brief explanation"
}}"""),
                ("human", "Niche: {niche}\n\nEstimate the monthly ARPU."),
            ])

            chain = prompt | self.llm
            response = await chain.ainvoke({"niche": niche})

            # Parse response
            import json

            response_text = response.content if hasattr(response, 'content') else str(response)
            start_idx = response_text.find('{')
            end_idx = response_text.rfind('}') + 1

            if start_idx != -1 and end_idx != 0:
                json_str = response_text[start_idx:end_idx]
                data = json.loads(json_str)
                arpu = float(data.get("estimated_monthly_arpu", 29.0))
                logger.info("arpu_estimated", arpu=arpu)
                return arpu

            return 29.0  # Default SaaS pricing

        except Exception as e:
            logger.warning("arpu_estimation_failed", error=str(e))
            return 29.0  # Conservative default

    async def _extract_keywords(self, niche: NicheCandidate) -> list[str]:
        """Extract relevant keywords from a niche candidate.

        Args:
            niche: The niche to extract keywords from

        Returns:
            List of relevant keywords
        """
        prompt = ChatPromptTemplate.from_messages([
            ("system", """You are an SEO expert extracting keywords.
Extract 10-15 relevant keywords that someone searching for this solution would use.

Include:
- Primary keywords (the main problem/solution)
- Secondary keywords (related terms)
- Long-tail keywords (specific phrases)

Return ONLY a JSON object:
{{
  "keywords": ["keyword1", "keyword2", ...]
}}"""),
            ("human", """Niche: {name}
Description: {description}
Pain Points: {pain_points}

Extract relevant keywords."""),
        ])

        chain = prompt | self.llm
        response = await chain.ainvoke({
            "name": niche.name,
            "description": niche.description,
            "pain_points": ", ".join(niche.pain_points),
        })

        # Parse response
        import json

        response_text = response.content if hasattr(response, 'content') else str(response)
        start_idx = response_text.find('{')
        end_idx = response_text.rfind('}') + 1

        if start_idx != -1 and end_idx != 0:
            json_str = response_text[start_idx:end_idx]
            data = json.loads(json_str)
            return data.get("keywords", [niche.name])

        return [niche.name]

    async def _score_b2b_intent(self, niche: NicheCandidate) -> float:
        """Score the likelihood this is a B2B opportunity.

        Args:
            niche: The niche to score

        Returns:
            B2B intent score (0-100)
        """
        prompt = ChatPromptTemplate.from_messages([
            ("system", """You are a B2B SaaS expert scoring opportunities.
Score the likelihood this is a B2B (business-to-business) opportunity vs B2C.

B2B indicators:
- Targets businesses/professionals
- Workflow/productivity tools
- Enterprise features needed
- Higher price tolerance
- Recurring business value

Return ONLY a number from 0-100 where:
- 0-30: Clearly B2C
- 31-60: Mixed or prosumer
- 61-100: Clearly B2B"""),
            ("human", """Niche: {name}
Description: {description}
Target Audience: {target_audience}

Score B2B intent (0-100):"""),
        ])

        chain = prompt | self.llm
        response = await chain.ainvoke({
            "name": niche.name,
            "description": niche.description,
            "target_audience": niche.target_audience,
        })

        # Extract number from response
        response_text = response.content if hasattr(response, 'content') else str(response)
        numbers = re.findall(r'\b\d+\b', response_text)

        if numbers:
            score = float(numbers[0])
            return min(max(score, 0.0), 100.0)

        return 50.0  # Default middle score

    async def _calculate_keyword_difficulty(
        self, keywords: list[str], search_volume: int, competitors: int
    ) -> float:
        """Calculate keyword difficulty based on search volume and competition.

        Args:
            keywords: List of keywords
            search_volume: Monthly search volume
            competitors: Number of competitors

        Returns:
            Keyword difficulty score (0-100)
        """
        # Simplified heuristic
        # Higher competition + higher volume = higher difficulty
        base_difficulty = min(competitors * 2, 70)

        # Adjust for search volume
        if search_volume > 10000:
            difficulty = base_difficulty + 20
        elif search_volume > 5000:
            difficulty = base_difficulty + 10
        else:
            difficulty = base_difficulty

        return min(max(difficulty, 0.0), 100.0)

    async def _estimate_market_size(self, niche: NicheCandidate, search_volume: int) -> str:
        """Estimate market size category.

        Args:
            niche: The niche candidate
            search_volume: Monthly search volume

        Returns:
            Market size estimate (e.g., "Small", "Medium", "Large")
        """
        prompt = ChatPromptTemplate.from_messages([
            ("system", """You are a market sizing expert.
Estimate the total addressable market (TAM) size category.

Categories:
- Micro: <$1M annual market
- Small: $1M-$10M annual market
- Medium: $10M-$100M annual market
- Large: $100M-$1B annual market
- Massive: >$1B annual market

Return ONLY one word: Micro, Small, Medium, Large, or Massive"""),
            ("human", """Niche: {name}
Description: {description}
Monthly Search Volume: {search_volume}

Estimate market size category:"""),
        ])

        chain = prompt | self.llm
        response = await chain.ainvoke({
            "name": niche.name,
            "description": niche.description,
            "search_volume": search_volume,
        })

        response_text = response.content if hasattr(response, 'content') else str(response)

        for category in ["Micro", "Small", "Medium", "Large", "Massive"]:
            if category.lower() in response_text.lower():
                return category

        return "Small"  # Default

    def _calculate_validation_score(
        self, niche: NicheCandidate, metrics: ValidationMetrics
    ) -> float:
        """Calculate overall validation score.

        Scoring components:
        - Niche quality score (from identification): 30%
        - Search volume potential: 20%
        - Competition level (inverse): 15%
        - B2B intent: 15%
        - ARPU potential: 10%
        - Keyword difficulty (inverse): 10%

        Args:
            niche: The niche candidate
            metrics: Validation metrics

        Returns:
            Overall validation score (0-100)
        """
        # Niche quality (30 points)
        niche_quality = (niche.score / 100.0) * 30

        # Search volume (20 points)
        # Sweet spot: 1000-10000 monthly searches
        if 1000 <= metrics.search_volume <= 10000:
            search_score = 20
        elif metrics.search_volume < 1000:
            search_score = (metrics.search_volume / 1000.0) * 20
        else:
            search_score = 20 - min((metrics.search_volume - 10000) / 10000 * 10, 10)

        # Competition (15 points, inverse)
        # Fewer competitors = better
        if metrics.competitor_density <= 5:
            competition_score = 15
        elif metrics.competitor_density <= 15:
            competition_score = 10
        elif metrics.competitor_density <= 30:
            competition_score = 5
        else:
            competition_score = 0

        # B2B intent (15 points)
        b2b_score = (metrics.b2b_intent_score / 100.0) * 15

        # ARPU (10 points)
        # Higher ARPU = better
        if metrics.estimated_arpu >= 100:
            arpu_score = 10
        elif metrics.estimated_arpu >= 50:
            arpu_score = 7
        elif metrics.estimated_arpu >= 20:
            arpu_score = 5
        else:
            arpu_score = 2

        # Keyword difficulty (10 points, inverse)
        # Lower difficulty = better
        keyword_score = ((100 - metrics.keyword_difficulty) / 100.0) * 10

        total = (
            niche_quality
            + search_score
            + competition_score
            + b2b_score
            + arpu_score
            + keyword_score
        )

        return round(total, 2)

    async def _generate_analysis(
        self, niche: NicheCandidate, metrics: ValidationMetrics
    ) -> tuple[list[str], list[str], list[str]]:
        """Generate strengths, weaknesses, and recommendations.

        Args:
            niche: The niche candidate
            metrics: Validation metrics

        Returns:
            Tuple of (strengths, weaknesses, recommendations)
        """
        prompt = ChatPromptTemplate.from_messages([
            ("system", """You are a startup advisor analyzing a niche opportunity.
Provide a concise analysis with:
1. 3-5 key strengths
2. 3-5 key weaknesses/risks
3. 3-5 actionable recommendations

Be specific and practical.

Return ONLY a JSON object:
{{
  "strengths": ["strength1", "strength2", ...],
  "weaknesses": ["weakness1", "weakness2", ...],
  "recommendations": ["rec1", "rec2", ...]
}}"""),
            ("human", """Niche: {name}
Description: {description}
Search Volume: {search_volume}/month
Competitors: {competitors}
B2B Intent Score: {b2b_score}
Estimated ARPU: ${arpu}/month
Keyword Difficulty: {difficulty}

Provide analysis:"""),
        ])

        chain = prompt | self.llm
        response = await chain.ainvoke({
            "name": niche.name,
            "description": niche.description,
            "search_volume": metrics.search_volume,
            "competitors": metrics.competitor_density,
            "b2b_score": metrics.b2b_intent_score,
            "arpu": metrics.estimated_arpu,
            "difficulty": metrics.keyword_difficulty,
        })

        # Parse response
        import json

        response_text = response.content if hasattr(response, 'content') else str(response)
        start_idx = response_text.find('{')
        end_idx = response_text.rfind('}') + 1

        if start_idx != -1 and end_idx != 0:
            json_str = response_text[start_idx:end_idx]
            data = json.loads(json_str)

            return (
                data.get("strengths", []),
                data.get("weaknesses", []),
                data.get("recommendations", []),
            )

        # Defaults
        return (
            ["Market opportunity identified"],
            ["Further validation needed"],
            ["Conduct customer interviews", "Validate pricing assumptions"],
        )
