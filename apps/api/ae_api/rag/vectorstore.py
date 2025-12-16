"""Vector store implementation using pgvector."""

from typing import Any

import structlog
from langchain_openai import OpenAIEmbeddings
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ae_api.config import get_settings
from ae_api.rag.schemas import TrendDocument

logger = structlog.get_logger()
settings = get_settings()


class VectorStore:
    """Vector store for trend documents using pgvector."""

    def __init__(self, session: AsyncSession):
        """Initialize vector store with database session."""
        self.session = session
        self.embeddings = OpenAIEmbeddings(
            model=settings.embedding_model,
            api_key=settings.openai_api_key.get_secret_value() if settings.openai_api_key else None,
        )
        self.dimensions = settings.vector_dimensions

    async def ensure_table(self) -> None:
        """Ensure the vector table exists."""
        await self.session.execute(
            text("CREATE EXTENSION IF NOT EXISTS vector")
        )
        await self.session.execute(
            text(f"""
                CREATE TABLE IF NOT EXISTS trend_documents (
                    id TEXT PRIMARY KEY,
                    source TEXT NOT NULL,
                    title TEXT NOT NULL,
                    content TEXT NOT NULL,
                    url TEXT,
                    author TEXT,
                    score INTEGER DEFAULT 0,
                    timestamp TIMESTAMPTZ NOT NULL,
                    metadata JSONB DEFAULT '{{}}',
                    embedding vector({self.dimensions}),
                    created_at TIMESTAMPTZ DEFAULT NOW()
                )
            """)
        )
        await self.session.execute(
            text("""
                CREATE INDEX IF NOT EXISTS trend_documents_embedding_idx
                ON trend_documents
                USING ivfflat (embedding vector_cosine_ops)
                WITH (lists = 100)
            """)
        )
        await self.session.commit()

    async def upsert(self, documents: list[TrendDocument]) -> int:
        """Upsert documents into the vector store."""
        if not documents:
            return 0

        # Generate embeddings for documents without them
        texts_to_embed = []
        docs_needing_embedding = []

        for doc in documents:
            if doc.embedding is None:
                texts_to_embed.append(f"{doc.title}\n\n{doc.content}")
                docs_needing_embedding.append(doc)

        if texts_to_embed:
            embeddings = await self.embeddings.aembed_documents(texts_to_embed)
            for doc, embedding in zip(docs_needing_embedding, embeddings):
                doc.embedding = embedding

        # Upsert to database
        for doc in documents:
            await self.session.execute(
                text("""
                    INSERT INTO trend_documents
                    (id, source, title, content, url, author, score, timestamp, metadata, embedding)
                    VALUES (:id, :source, :title, :content, :url, :author, :score, :timestamp, :metadata, :embedding)
                    ON CONFLICT (id) DO UPDATE SET
                        content = EXCLUDED.content,
                        score = EXCLUDED.score,
                        metadata = EXCLUDED.metadata,
                        embedding = EXCLUDED.embedding
                """),
                {
                    "id": doc.id,
                    "source": doc.source.value,
                    "title": doc.title,
                    "content": doc.content,
                    "url": doc.url,
                    "author": doc.author,
                    "score": doc.score,
                    "timestamp": doc.timestamp,
                    "metadata": doc.metadata,
                    "embedding": doc.embedding,
                },
            )

        await self.session.commit()
        logger.info("Upserted documents", count=len(documents))
        return len(documents)

    async def search(
        self,
        query: str,
        limit: int = 10,
        source_filter: str | None = None,
        min_score: int = 0,
    ) -> list[tuple[TrendDocument, float]]:
        """Search for similar documents."""
        query_embedding = await self.embeddings.aembed_query(query)

        filter_clause = ""
        params: dict[str, Any] = {
            "embedding": query_embedding,
            "limit": limit,
            "min_score": min_score,
        }

        if source_filter:
            filter_clause = "AND source = :source"
            params["source"] = source_filter

        result = await self.session.execute(
            text(f"""
                SELECT
                    id, source, title, content, url, author, score, timestamp, metadata,
                    1 - (embedding <=> :embedding::vector) as similarity
                FROM trend_documents
                WHERE score >= :min_score {filter_clause}
                ORDER BY embedding <=> :embedding::vector
                LIMIT :limit
            """),
            params,
        )

        rows = result.fetchall()
        documents = []

        for row in rows:
            doc = TrendDocument(
                id=row.id,
                source=row.source,
                title=row.title,
                content=row.content,
                url=row.url,
                author=row.author,
                score=row.score,
                timestamp=row.timestamp,
                metadata=row.metadata or {},
            )
            documents.append((doc, row.similarity))

        return documents

    async def hybrid_search(
        self,
        query: str,
        limit: int = 10,
        keyword_weight: float = 0.3,
    ) -> list[tuple[TrendDocument, float]]:
        """Hybrid search combining vector similarity and keyword matching."""
        query_embedding = await self.embeddings.aembed_query(query)

        result = await self.session.execute(
            text("""
                SELECT
                    id, source, title, content, url, author, score, timestamp, metadata,
                    (
                        (1 - :keyword_weight) * (1 - (embedding <=> :embedding::vector)) +
                        :keyword_weight * ts_rank(
                            to_tsvector('english', title || ' ' || content),
                            plainto_tsquery('english', :query)
                        )
                    ) as combined_score
                FROM trend_documents
                WHERE
                    to_tsvector('english', title || ' ' || content) @@ plainto_tsquery('english', :query)
                    OR (1 - (embedding <=> :embedding::vector)) > 0.5
                ORDER BY combined_score DESC
                LIMIT :limit
            """),
            {
                "embedding": query_embedding,
                "query": query,
                "keyword_weight": keyword_weight,
                "limit": limit,
            },
        )

        rows = result.fetchall()
        documents = []

        for row in rows:
            doc = TrendDocument(
                id=row.id,
                source=row.source,
                title=row.title,
                content=row.content,
                url=row.url,
                author=row.author,
                score=row.score,
                timestamp=row.timestamp,
                metadata=row.metadata or {},
            )
            documents.append((doc, row.combined_score))

        return documents
