
import pytest
from sqlalchemy import inspect
from ae_api.db.models.run import Run
from ae_api.db.models.artifact import Artifact
from ae_api.db.models.genesis import NicheCandidate, ProductSpec, TechnicalSpec, TaskGraph

def test_foreign_keys_indexes():
    """Verify that foreign keys have indexes.

    This test ensures that all ForeignKey columns in the specified models
    have an index to prevent performance issues during joins and cascading deletes.
    """
    models_to_check = [Run, Artifact, NicheCandidate, ProductSpec, TechnicalSpec, TaskGraph]

    for model in models_to_check:
        mapper = inspect(model)

        for column in mapper.columns:
            if column.foreign_keys:
                # Check if this column is indexed
                has_index = False

                # Check explicit index=True on Column/mapped_column
                if column.index:
                    has_index = True

                # Check Table indexes
                if not has_index:
                    for idx in model.__table__.indexes:
                        if column.name in [c.name for c in idx.columns]:
                            has_index = True
                            break

                if not has_index:
                    pytest.fail(f"{model.__tablename__}.{column.name} is a Foreign Key but NOT indexed!")
