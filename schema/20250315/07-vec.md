# Comprehensive Vector Search Schema for ContextNexus

After evaluating several vector database technologies (including Pinecone, Weaviate, Milvus, and Qdrant), I recommend using **PostgreSQL with pgvector extension** for ContextNexus. This approach keeps vector functionality within your existing system of record, simplifies architecture, and provides transactional guarantees with your content data.

## PostgreSQL pgvector Schema Design

### 1. Initial Setup and Extensions

```sql
-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgvector";

-- Create enum for embedding models
CREATE TYPE embedding_model_type AS ENUM (
    'openai-text-embedding-ada-002',   -- 1536 dimensions
    'openai-text-embedding-3-small',   -- 1536 dimensions
    'openai-text-embedding-3-large',   -- 3072 dimensions
    'cohere-embed-english-v3.0',       -- 1024 dimensions
    'sentence-transformer-all-mpnet',  -- 768 dimensions
    'bge-large-en'                     -- 1024 dimensions
);
```

### 2. Content Embedding Tables Structure

```sql
-- Add embedding columns to content_chunks table
ALTER TABLE content_chunks
    ADD COLUMN embedding_model embedding_model_type,
    ADD COLUMN embedding vector(1536),
    ADD COLUMN embedding_updated_at TIMESTAMPTZ;

-- Add embedding columns to content_items for document-level embeddings
ALTER TABLE content_items
    ADD COLUMN embedding_model embedding_model_type,
    ADD COLUMN embedding vector(1536),
    ADD COLUMN embedding_updated_at TIMESTAMPTZ;

-- Table to track embedding processing status and errors
CREATE TABLE embedding_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    content_id UUID NOT NULL,
    chunk_id UUID,
    job_type VARCHAR(50) NOT NULL, -- 'generate', 'update', 'refresh'
    status VARCHAR(50) NOT NULL DEFAULT 'pending', -- 'pending', 'processing', 'completed', 'failed'
    embedding_model embedding_model_type NOT NULL,
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT content_or_chunk_check CHECK (
        (content_id IS NOT NULL AND chunk_id IS NULL) OR
        (content_id IS NOT NULL AND chunk_id IS NOT NULL)
    )
);

-- Table to store embedding model configurations
CREATE TABLE embedding_model_configs (
    model_name embedding_model_type PRIMARY KEY,
    dimensions INTEGER NOT NULL,
    max_input_tokens INTEGER NOT NULL,
    provider VARCHAR(100) NOT NULL,
    api_endpoint VARCHAR(255),
    cost_per_1k_tokens NUMERIC(10, 6),
    is_default BOOLEAN DEFAULT FALSE,
    enabled BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Table to track tenant embedding model preferences
CREATE TABLE tenant_embedding_configs (
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    model_name embedding_model_type NOT NULL REFERENCES embedding_model_configs(model_name),
    is_default BOOLEAN DEFAULT FALSE,
    enabled BOOLEAN DEFAULT TRUE,
    config JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, model_name)
);
```

### 3. Indexing Strategy

```sql
-- Create HNSW indexes for different embedding dimensions
-- For OpenAI ada-002 and text-embedding-3-small (1536 dimensions)
CREATE INDEX idx_content_chunks_embedding_1536 ON content_chunks 
USING hnsw (embedding vector_l2_ops)
WITH (
    m = 16,        -- Max number of connections per layer
    ef_construction = 64  -- Size of dynamic candidate list for construction
)
WHERE embedding_model IN ('openai-text-embedding-ada-002', 'openai-text-embedding-3-small') 
  AND embedding IS NOT NULL;

-- For OpenAI text-embedding-3-large (3072 dimensions)
CREATE INDEX idx_content_chunks_embedding_3072 ON content_chunks 
USING hnsw (embedding vector_l2_ops)
WITH (
    m = 16,
    ef_construction = 64
)
WHERE embedding_model = 'openai-text-embedding-3-large' 
  AND embedding IS NOT NULL;

-- For models with 1024 dimensions
CREATE INDEX idx_content_chunks_embedding_1024 ON content_chunks 
USING hnsw (embedding vector_l2_ops)
WITH (
    m = 16, 
    ef_construction = 64
)
WHERE embedding_model IN ('cohere-embed-english-v3.0', 'bge-large-en') 
  AND embedding IS NOT NULL;

-- Create indexes for document-level embeddings
CREATE INDEX idx_content_items_embedding_1536 ON content_items 
USING hnsw (embedding vector_l2_ops)
WITH (m = 16, ef_construction = 64)
WHERE embedding_model IN ('openai-text-embedding-ada-002', 'openai-text-embedding-3-small') 
  AND embedding IS NOT NULL;
```

### 4. Embedding Processing Functions

```sql
-- Function to trigger embedding generation
CREATE OR REPLACE FUNCTION trigger_embedding_generation()
RETURNS TRIGGER AS $$
DECLARE
    model_name embedding_model_type;
BEGIN
    -- Get default embedding model for tenant
    SELECT model_name INTO model_name
    FROM tenant_embedding_configs
    WHERE tenant_id = NEW.tenant_id AND is_default = TRUE
    LIMIT 1;
    
    -- If no tenant-specific default, use global default
    IF model_name IS NULL THEN
        SELECT model_name INTO model_name
        FROM embedding_model_configs
        WHERE is_default = TRUE
        LIMIT 1;
    END IF;
    
    -- Schedule embedding job
    INSERT INTO embedding_jobs (
        tenant_id, content_id, chunk_id, job_type, embedding_model
    ) VALUES (
        NEW.tenant_id, 
        CASE WHEN TG_TABLE_NAME = 'content_chunks' THEN NEW.content_id ELSE NEW.id END,
        CASE WHEN TG_TABLE_NAME = 'content_chunks' THEN NEW.id ELSE NULL END,
        'generate', 
        model_name
    );
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to content_chunks
CREATE TRIGGER trg_content_chunks_embedding
AFTER INSERT ON content_chunks
FOR EACH ROW
EXECUTE FUNCTION trigger_embedding_generation();

-- Apply trigger to content_items for document-level embeddings
CREATE TRIGGER trg_content_items_embedding
AFTER INSERT ON content_items
FOR EACH ROW
EXECUTE FUNCTION trigger_embedding_generation();
```

### 5. Vector Search Functions

```sql
-- Function to search content chunks by similarity
CREATE OR REPLACE FUNCTION search_similar_chunks(
    p_query_text TEXT,
    p_tenant_id UUID,
    p_project_id UUID DEFAULT NULL,
    p_content_type VARCHAR DEFAULT NULL,
    p_embedding_model embedding_model_type DEFAULT 'openai-text-embedding-ada-002',
    p_limit INTEGER DEFAULT 10,
    p_threshold FLOAT DEFAULT 0.7
)
RETURNS TABLE (
    chunk_id UUID,
    content_id UUID,
    content_title TEXT,
    chunk_text TEXT,
    similarity FLOAT,
    content_type VARCHAR,
    project_id UUID
) AS $$
DECLARE
    query_embedding vector;
    dimensions INTEGER;
BEGIN
    -- Get embedding dimensions for the specified model
    SELECT ec.dimensions INTO dimensions
    FROM embedding_model_configs ec
    WHERE ec.model_name = p_embedding_model;
    
    -- Generate embedding for query text (placeholder - in real implementation, call external service)
    -- This would be replaced with actual embedding generation logic
    query_embedding := embedding_service(p_query_text, p_embedding_model);
    
    -- Return similar chunks
    RETURN QUERY
    SELECT 
        cc.id AS chunk_id,
        cc.content_id,
        ci.title AS content_title,
        cc.content AS chunk_text,
        1 - (cc.embedding <-> query_embedding) AS similarity,
        ci.content_type,
        ci.project_id
    FROM 
        content_chunks cc
    JOIN 
        content_items ci ON cc.content_id = ci.id
    WHERE 
        cc.tenant_id = p_tenant_id
        AND cc.embedding_model = p_embedding_model
        AND (p_project_id IS NULL OR ci.project_id = p_project_id)
        AND (p_content_type IS NULL OR ci.content_type = p_content_type)
        AND (1 - (cc.embedding <-> query_embedding)) >= p_threshold
    ORDER BY 
        cc.embedding <-> query_embedding
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- Function to find similar content items
CREATE OR REPLACE FUNCTION find_similar_content(
    p_content_id UUID,
    p_tenant_id UUID,
    p_limit INTEGER DEFAULT 10,
    p_threshold FLOAT DEFAULT 0.7
)
RETURNS TABLE (
    content_id UUID,
    title TEXT,
    similarity FLOAT,
    content_type VARCHAR
) AS $$
DECLARE
    source_embedding vector;
    source_model embedding_model_type;
BEGIN
    -- Get the embedding of the source content
    SELECT embedding, embedding_model INTO source_embedding, source_model
    FROM content_items
    WHERE id = p_content_id AND tenant_id = p_tenant_id;
    
    -- If no embedding found, return empty result
    IF source_embedding IS NULL THEN
        RETURN;
    END IF;
    
    -- Find similar content items
    RETURN QUERY
    SELECT 
        ci.id AS content_id,
        ci.title,
        1 - (ci.embedding <-> source_embedding) AS similarity,
        ci.content_type
    FROM 
        content_items ci
    WHERE 
        ci.tenant_id = p_tenant_id
        AND ci.id != p_content_id
        AND ci.embedding_model = source_model
        AND ci.embedding IS NOT NULL
        AND (1 - (ci.embedding <-> source_embedding)) >= p_threshold
    ORDER BY 
        ci.embedding <-> source_embedding
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;
```

### 6. Integration with Neo4j

```sql
-- Function to sync vector similarity relationships to Neo4j
CREATE OR REPLACE FUNCTION sync_vector_similarity_to_neo4j(
    p_content_id UUID,
    p_tenant_id UUID,
    p_threshold FLOAT DEFAULT 0.8,
    p_max_relations INTEGER DEFAULT 5
)
RETURNS void AS $$
DECLARE
    similarity_record RECORD;
    neo4j_query TEXT;
    source_node_id TEXT;
    target_node_id TEXT;
BEGIN
    -- Get Neo4j node ID for source content
    SELECT neo4j_node_id INTO source_node_id
    FROM content_items
    WHERE id = p_content_id AND tenant_id = p_tenant_id;
    
    IF source_node_id IS NULL THEN
        RAISE EXCEPTION 'Source content has no Neo4j node ID';
    END IF;
    
    -- Find similar content items
    FOR similarity_record IN
        SELECT 
            ci.id AS similar_id,
            ci.neo4j_node_id AS similar_neo4j_id,
            1 - (ci.embedding <-> source.embedding) AS similarity
        FROM 
            content_items source,
            content_items ci
        WHERE 
            source.id = p_content_id
            AND source.tenant_id = p_tenant_id
            AND ci.tenant_id = p_tenant_id
            AND ci.id != p_content_id
            AND ci.embedding_model = source.embedding_model
            AND (1 - (ci.embedding <-> source.embedding)) >= p_threshold
        ORDER BY 
            ci.embedding <-> source.embedding
        LIMIT p_max_relations
    LOOP
        IF similarity_record.similar_neo4j_id IS NOT NULL THEN
            -- Construct Neo4j Cypher query to create SIMILAR_TO relationship
            neo4j_query := FORMAT(
                'MATCH (source), (target) ' ||
                'WHERE ID(source) = %L AND ID(target) = %L ' ||
                'MERGE (source)-[r:SIMILAR_TO {' ||
                '  score: %s, ' ||
                '  method: "vector_similarity", ' ||
                '  model: %L, ' ||
                '  createdAt: datetime() ' ||
                '}]->(target)',
                source_node_id,
                similarity_record.similar_neo4j_id,
                similarity_record.similarity,
                (SELECT embedding_model FROM content_items WHERE id = p_content_id)
            );
            
            -- Execute Neo4j query (this would call your Neo4j sync service)
            PERFORM exec_neo4j_query(neo4j_query);
        END IF;
    END LOOP;
END;
$$ LANGUAGE plpgsql;
```

### 7. Embedding Refresh and Maintenance

```sql
-- Function to schedule refreshing of outdated embeddings
CREATE OR REPLACE FUNCTION schedule_embedding_refresh(
    p_model_name embedding_model_type,
    p_tenant_id UUID DEFAULT NULL,
    p_max_age_days INTEGER DEFAULT 90
)
RETURNS INTEGER AS $$
DECLARE
    affected_rows INTEGER;
BEGIN
    INSERT INTO embedding_jobs (
        tenant_id, content_id, chunk_id, job_type, embedding_model
    )
    SELECT 
        ci.tenant_id,
        ci.id,
        NULL,
        'refresh',
        p_model_name
    FROM 
        content_items ci
    WHERE 
        (p_tenant_id IS NULL OR ci.tenant_id = p_tenant_id)
        AND (
            ci.embedding IS NULL
            OR ci.embedding_model != p_model_name
            OR ci.embedding_updated_at < NOW() - (p_max_age_days || ' days')::INTERVAL
        )
        AND NOT EXISTS (
            SELECT 1 FROM embedding_jobs ej 
            WHERE ej.content_id = ci.id 
              AND ej.chunk_id IS NULL
              AND ej.status IN ('pending', 'processing')
        );
    
    GET DIAGNOSTICS affected_rows = ROW_COUNT;
    
    -- Also schedule chunk embedding refreshes
    INSERT INTO embedding_jobs (
        tenant_id, content_id, chunk_id, job_type, embedding_model
    )
    SELECT 
        cc.tenant_id,
        cc.content_id,
        cc.id,
        'refresh',
        p_model_name
    FROM 
        content_chunks cc
    WHERE 
        (p_tenant_id IS NULL OR cc.tenant_id = p_tenant_id)
        AND (
            cc.embedding IS NULL
            OR cc.embedding_model != p_model_name
            OR cc.embedding_updated_at < NOW() - (p_max_age_days || ' days')::INTERVAL
        )
        AND NOT EXISTS (
            SELECT 1 FROM embedding_jobs ej 
            WHERE ej.chunk_id = cc.id 
              AND ej.status IN ('pending', 'processing')
        );
    
    GET DIAGNOSTICS affected_rows = affected_rows + ROW_COUNT;
    
    RETURN affected_rows;
END;
$$ LANGUAGE plpgsql;
```

## Worker Implementation for Embeddings

The vector schema requires a worker process that processes embedding jobs. Here's a pseudocode implementation:

```python
# Embedding worker pseudocode
def process_embedding_jobs():
    # Find pending embedding jobs
    jobs = fetch_pending_embedding_jobs(limit=10)
    
    for job in jobs:
        try:
            # Mark job as processing
            update_job_status(job.id, 'processing')
            
            # Get content text
            if job.chunk_id:
                text = fetch_chunk_text(job.chunk_id)
            else:
                text = fetch_content_text(job.content_id)
            
            # Generate embedding
            embedding = generate_embedding(text, job.embedding_model)
            
            # Store embedding
            if job.chunk_id:
                update_chunk_embedding(
                    job.chunk_id, 
                    embedding, 
                    job.embedding_model
                )
            else:
                update_content_embedding(
                    job.content_id, 
                    embedding, 
                    job.embedding_model
                )
            
            # If this is a content item, also sync to Neo4j
            if not job.chunk_id:
                sync_vector_similarity_to_neo4j(
                    job.content_id,
                    job.tenant_id
                )
            
            # Mark job as completed
            update_job_status(job.id, 'completed')
            
        except Exception as e:
            # Handle error
            update_job_status(job.id, 'failed', str(e))
            increment_retry_count(job.id)
```

## API Layer for Vector Search

Here's how the API layer would interact with vector search:

```typescript
// TypeScript API interface
interface VectorSearchParams {
  queryText: string;
  tenantId: string;
  projectId?: string;
  contentType?: string;
  embeddingModel?: string;
  limit?: number;
  threshold?: number;
}

interface ChunkSearchResult {
  chunkId: string;
  contentId: string;
  contentTitle: string;
  chunkText: string;
  similarity: number;
  contentType: string;
  projectId: string;
}

// API endpoint implementation pseudocode
async function searchSimilarContent(params: VectorSearchParams): Promise<ChunkSearchResult[]> {
  const { queryText, tenantId, projectId, contentType, embeddingModel, limit, threshold } = params;
  
  // Generate embedding for query text
  const queryEmbedding = await generateEmbedding(queryText, embeddingModel);
  
  // Perform vector search in database
  const results = await db.query(`
    SELECT * FROM search_similar_chunks($1, $2, $3, $4, $5, $6, $7)
  `, [
    queryText, tenantId, projectId, contentType, 
    embeddingModel || 'openai-text-embedding-ada-002', 
    limit || 10, 
    threshold || 0.7
  ]);
  
  return results;
}
```

## Neo4j Integration

The vector similarity information enriches the knowledge graph in Neo4j through these patterns:

```cypher
// Neo4j query to find semantically similar content
MATCH (c:ContentItem {id: $contentId})
MATCH (similar:ContentItem)-[r:SIMILAR_TO]-(c)
WHERE r.score > 0.8
RETURN similar, r.score ORDER BY r.score DESC

// Neo4j query to find content clusters based on similarity
MATCH (c:ContentItem)
MATCH (c)-[r:SIMILAR_TO]-(similar:ContentItem)
WHERE r.score > 0.85
WITH c, collect(similar) AS similarContent
WHERE size(similarContent) > 3
RETURN c, similarContent

// Find paths between concepts through similar content
MATCH path = (c1:Concept)-[:RELATES_TO]-(:ContentItem)-[:SIMILAR_TO*1..2]-(:ContentItem)-[:RELATES_TO]-(c2:Concept)
WHERE c1.id = $concept1Id AND c2.id = $concept2Id
RETURN path
```

## Front-End Integration

Vector search capabilities can be exposed in the ContextNexus UI through:

1. **Semantic search bar** that finds related content based on meaning, not just keywords
2. **"Find similar content"** options on content items that use vector similarity
3. **Content recommendations** in threads based on semantic relevance to current context
4. **Semantic clustering visualization** in knowledge graphs, showing content grouped by embedding similarity

## Performance Considerations

For optimal performance with pgvector:

1. **Use HNSW indexes** for efficient approximate nearest neighbor search
2. **Partition large tables** by tenant_id and embedding_model for better index performance
3. **Set appropriate m and ef_construction values** based on your data size and performance requirements
4. **Implement connection pooling** to handle concurrent vector search requests
5. **Consider read replicas** for heavy vector search workloads

As your vector collection grows beyond tens of millions of vectors, you may want to consider specialized vector databases like Pinecone, Weaviate, or Qdrant, but the pgvector approach provides an excellent starting point with minimal operational complexity.
