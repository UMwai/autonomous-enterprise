"""RAG-powered trend analysis pipeline for niche identification.

This module provides capabilities for ingesting trend data from multiple sources,
embedding it into a vector store, and using RAG to identify promising micro-SaaS niches.
"""

import asyncio
from datetime import datetime
from typing import Any

import structlog
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain_community.vectorstores import PGVector
from langchain_core.documents import Document
from langchain_core.embeddings import Embeddings
from langchain_core.language_models import BaseChatModel
from langchain_core.prompts import ChatPromptTemplate
from langchain_openai import ChatOpenAI, OpenAIEmbeddings
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncEngine

from ae_api.config import get_settings

logger = structlog.get_logger()


class TrendDocument(BaseModel):
    """A document representing a market trend or insight.

    Attributes:
        source: Origin of the trend (e.g., 'reddit', 'hackernews', 'google_trends')
        content: The actual trend content or discussion
        timestamp: When the trend was observed
        embedding: Vector embedding of the content (optional, generated during ingestion)
        metadata: Additional context (URL, upvotes, comments, etc.)
    """

    source: str
    content: str
    timestamp: datetime
    embedding: list[float] | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class NicheCandidate(BaseModel):
    """A potential micro-SaaS niche opportunity.

    Attributes:
        name: Short, descriptive name for the niche
        description: Detailed description of the opportunity
        pain_points: List of specific problems this niche experiences
        evidence_urls: URLs supporting the existence of this niche
        score: Calculated score based on micro-SaaS criteria (0-100)
        target_audience: Description of the target user base
        value_proposition: How a product would solve the pain points
    """

    name: str
    description: str
    pain_points: list[str]
    evidence_urls: list[str] = Field(default_factory=list)
    score: float = 0.0
    target_audience: str = ""
    value_proposition: str = ""


class NicheIdentificationEngine:
    """RAG-powered engine for identifying and scoring micro-SaaS niches.

    This engine ingests trend data from various sources, embeds it into a vector store,
    and uses retrieval-augmented generation to identify promising niche opportunities.
    """

    def __init__(
        self,
        db_engine: AsyncEngine,
        llm: BaseChatModel | None = None,
        embeddings: Embeddings | None = None,
    ):
        """Initialize the niche identification engine.

        Args:
            db_engine: SQLAlchemy async engine for database operations
            llm: Language model for generation (defaults to tier1 model)
            embeddings: Embedding model (defaults to OpenAI embeddings)
        """
        self.db_engine = db_engine
        settings = get_settings()

        self.llm = llm or ChatOpenAI(
            model=settings.tier1_model,
            temperature=0.7,
            api_key=settings.openai_api_key.get_secret_value() if settings.openai_api_key else None,
        )

        self.embeddings = embeddings or OpenAIEmbeddings(
            model=settings.embedding_model,
            api_key=settings.openai_api_key.get_secret_value() if settings.openai_api_key else None,
        )

        self.text_splitter = RecursiveCharacterTextSplitter(
            chunk_size=1000,
            chunk_overlap=200,
            length_function=len,
        )

        # Initialize vector store connection string
        self.collection_name = "genesis_trends"
        self.vectorstore: PGVector | None = None

    async def _get_vectorstore(self) -> PGVector:
        """Get or create the vector store instance.

        Returns:
            PGVector instance connected to the database
        """
        if self.vectorstore is None:
            settings = get_settings()
            # Convert AsyncEngine connection to sync connection string for PGVector
            connection_string = str(settings.database_url).replace(
                "postgresql+asyncpg://", "postgresql://"
            )

            self.vectorstore = PGVector(
                collection_name=self.collection_name,
                connection_string=connection_string,
                embedding_function=self.embeddings,
            )

        return self.vectorstore

    async def ingest_trends(self, sources: list[TrendDocument]) -> int:
        """Fetch and embed trend data from various sources.

        This method takes trend documents, chunks them appropriately, generates
        embeddings, and stores them in the vector database for later retrieval.

        Args:
            sources: List of TrendDocument objects to ingest

        Returns:
            Number of document chunks successfully ingested

        Raises:
            Exception: If ingestion fails
        """
        logger.info("ingesting_trends", source_count=len(sources))

        try:
            # Convert TrendDocuments to LangChain Documents
            documents = []
            for trend_doc in sources:
                doc = Document(
                    page_content=trend_doc.content,
                    metadata={
                        "source": trend_doc.source,
                        "timestamp": trend_doc.timestamp.isoformat(),
                        **trend_doc.metadata,
                    },
                )
                documents.append(doc)

            # Split documents into chunks
            chunks = self.text_splitter.split_documents(documents)
            logger.info("split_documents", chunk_count=len(chunks))

            # Add to vector store
            vectorstore = await self._get_vectorstore()
            await asyncio.to_thread(
                vectorstore.add_documents,
                chunks,
            )

            logger.info("trends_ingested_successfully", chunk_count=len(chunks))
            return len(chunks)

        except Exception as e:
            logger.error("trend_ingestion_failed", error=str(e))
            raise

    async def identify_niches(self, intent: str, count: int = 10) -> list[NicheCandidate]:
        """Generate niche candidates from RAG-retrieved trend data.

        This method uses the user's intent to search the vector store for relevant
        trends, then uses an LLM to synthesize them into concrete niche opportunities.

        Args:
            intent: User's description of their interests or goals (e.g., "B2B SaaS for developers")
            count: Maximum number of niche candidates to return

        Returns:
            List of NicheCandidate objects, sorted by initial score

        Raises:
            ValueError: If intent is empty or count is invalid
        """
        if not intent or not intent.strip():
            raise ValueError("Intent cannot be empty")

        if count < 1 or count > 50:
            raise ValueError("Count must be between 1 and 50")

        logger.info("identifying_niches", intent=intent, count=count)

        try:
            # Retrieve relevant trends from vector store
            vectorstore = await self._get_vectorstore()
            retriever = vectorstore.as_retriever(
                search_type="similarity",
                search_kwargs={"k": min(count * 3, 30)},  # Get more results for better synthesis
            )

            relevant_docs = await asyncio.to_thread(
                retriever.get_relevant_documents,
                intent,
            )

            logger.info("retrieved_relevant_trends", doc_count=len(relevant_docs))

            # Prepare context from retrieved documents
            context = "\n\n".join([
                f"Source: {doc.metadata.get('source', 'unknown')}\n"
                f"Timestamp: {doc.metadata.get('timestamp', 'unknown')}\n"
                f"Content: {doc.page_content}"
                for doc in relevant_docs
            ])

            # Generate niche candidates using LLM
            prompt = ChatPromptTemplate.from_messages([
                ("system", """You are an expert at identifying micro-SaaS opportunities.
Your task is to analyze market trends and identify specific, actionable niche opportunities
that match the user's intent.

For each niche, provide:
1. A clear, specific name (not generic)
2. Detailed description of the opportunity
3. 3-5 specific pain points the target audience experiences
4. Target audience description
5. Value proposition explaining how a product would solve the problems

Focus on:
- Underserved markets with clear pain points
- Niches with potential for recurring revenue (B2B SaaS preferred)
- Opportunities requiring low initial capital
- Markets with identifiable, reachable customers
- Problems that can be solved with software

Return EXACTLY {count} niche opportunities, ordered by quality."""),
                ("human", """User Intent: {intent}

Market Trends and Insights:
{context}

Based on these trends, identify {count} micro-SaaS niche opportunities.
Return them as a JSON array of objects with this structure:
{{
  "niches": [
    {{
      "name": "Clear, specific niche name",
      "description": "Detailed description",
      "pain_points": ["pain 1", "pain 2", "pain 3"],
      "target_audience": "Description of target users",
      "value_proposition": "How a product solves their problems",
      "evidence_urls": []
    }}
  ]
}}"""),
            ])

            chain = prompt | self.llm

            response = await chain.ainvoke({
                "intent": intent,
                "context": context,
                "count": count,
            })

            # Parse response and create NicheCandidate objects
            import json

            # Extract JSON from response
            response_text = response.content if hasattr(response, 'content') else str(response)

            # Try to find JSON in the response
            start_idx = response_text.find('{')
            end_idx = response_text.rfind('}') + 1

            if start_idx == -1 or end_idx == 0:
                logger.error("no_json_in_response", response=response_text)
                raise ValueError("LLM response did not contain valid JSON")

            json_str = response_text[start_idx:end_idx]
            parsed = json.loads(json_str)

            niches = []
            for niche_data in parsed.get("niches", []):
                # Extract evidence URLs from retrieved documents
                evidence_urls = [
                    doc.metadata.get("url", "")
                    for doc in relevant_docs[:5]
                    if doc.metadata.get("url")
                ]

                niche = NicheCandidate(
                    name=niche_data["name"],
                    description=niche_data["description"],
                    pain_points=niche_data["pain_points"],
                    target_audience=niche_data.get("target_audience", ""),
                    value_proposition=niche_data.get("value_proposition", ""),
                    evidence_urls=evidence_urls or niche_data.get("evidence_urls", []),
                )

                # Score the niche
                niche.score = await self.score_niche(niche)
                niches.append(niche)

            # Sort by score
            niches.sort(key=lambda x: x.score, reverse=True)

            logger.info("niches_identified", niche_count=len(niches))
            return niches[:count]

        except Exception as e:
            logger.error("niche_identification_failed", error=str(e))
            raise

    async def score_niche(self, niche: NicheCandidate) -> float:
        """Score a niche based on micro-SaaS criteria.

        Scoring criteria:
        - Specificity (20 points): How well-defined is the niche?
        - Pain point clarity (25 points): Are the problems clear and urgent?
        - Target audience (15 points): Can we identify and reach them?
        - Value proposition (20 points): Is the solution compelling?
        - Evidence (10 points): Do we have data supporting the opportunity?
        - SaaS suitability (10 points): Can this be a recurring revenue business?

        Args:
            niche: The NicheCandidate to score

        Returns:
            Score from 0-100
        """
        logger.info("scoring_niche", niche_name=niche.name)

        try:
            prompt = ChatPromptTemplate.from_messages([
                ("system", """You are an expert at evaluating micro-SaaS opportunities.
Score the following niche on these criteria (total 100 points):

1. Specificity (20 points): How well-defined and focused is this niche?
2. Pain Point Clarity (25 points): Are the problems clear, urgent, and valuable to solve?
3. Target Audience (15 points): Can we identify and reach these customers?
4. Value Proposition (20 points): Is the solution compelling and differentiated?
5. Evidence (10 points): Do we have data/trends supporting this opportunity?
6. SaaS Suitability (10 points): Can this be a recurring revenue business?

Return ONLY a JSON object with the score breakdown and total:
{{
  "specificity": 0-20,
  "pain_point_clarity": 0-25,
  "target_audience": 0-15,
  "value_proposition": 0-20,
  "evidence": 0-10,
  "saas_suitability": 0-10,
  "total": 0-100,
  "reasoning": "Brief explanation of the score"
}}"""),
                ("human", """Niche: {name}
Description: {description}
Pain Points: {pain_points}
Target Audience: {target_audience}
Value Proposition: {value_proposition}
Evidence Sources: {evidence_count} supporting documents

Provide the score breakdown."""),
            ])

            chain = prompt | self.llm

            response = await chain.ainvoke({
                "name": niche.name,
                "description": niche.description,
                "pain_points": ", ".join(niche.pain_points),
                "target_audience": niche.target_audience,
                "value_proposition": niche.value_proposition,
                "evidence_count": len(niche.evidence_urls),
            })

            # Parse response
            import json

            response_text = response.content if hasattr(response, 'content') else str(response)
            start_idx = response_text.find('{')
            end_idx = response_text.rfind('}') + 1

            if start_idx == -1 or end_idx == 0:
                logger.warning("invalid_score_response", using_default=True)
                return 50.0  # Default middle score

            json_str = response_text[start_idx:end_idx]
            score_data = json.loads(json_str)

            total_score = float(score_data.get("total", 50.0))
            logger.info("niche_scored", niche_name=niche.name, score=total_score)

            return total_score

        except Exception as e:
            logger.error("niche_scoring_failed", error=str(e), niche_name=niche.name)
            # Return a default score on error
            return 50.0
