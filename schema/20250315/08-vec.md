# Detailed Vector Database Schema for ContextNexus

After considering the requirements of your context management system, I recommend using **Qdrant** as your vector database. It offers an excellent balance of performance, flexibility, and control while being open source (with a cloud option if you prefer managed services later).

## Why Qdrant for ContextNexus

Qdrant is ideal for your use case because:

1. **High performance** with HNSW indexing for fast vector search
2. **Rich filtering capabilities** critical for multi-tenant isolation
3. **Open source** with self-hosted options avoiding vendor lock-in
4. **REST API and client libraries** for easy integration
5. **Payload storage** for metadata alongside vectors
6. **Optimized for production** with horizontal scaling support
7. **Active development** and strong community support

## Detailed Schema Design

### 1. Collection Structure

In Qdrant, we'll create a single collection called `content_chunks`:

```python
# Collection creation
client.create_collection(
    collection_name="content_chunks",
    vectors_config=models.VectorParams(
        size=1536,               # OpenAI embeddings dimension
        distance=models.Distance.COSINE  # Cosine similarity
    )
)
```

### 2. PostgreSQL Schema Enhancements

```sql
-- Modify the content_chunks table
ALTER TABLE content_chunks
ADD COLUMN vector_id TEXT,            -- ID in Qdrant
ADD COLUMN embedding_model VARCHAR(100) NOT NULL DEFAULT 'text-embedding-ada-002',
ADD COLUMN embedding_version VARCHAR(50) NOT NULL DEFAULT '1',
ADD COLUMN embedding_status VARCHAR(50) NOT NULL DEFAULT 'pending', -- 'pending', 'processing', 'completed', 'failed'
ADD COLUMN embedding_error TEXT,
ADD COLUMN last_embedded_at TIMESTAMPTZ;

-- Create index on embedding status for efficient querying
CREATE INDEX idx_content_chunks_embedding_status ON content_chunks(embedding_status);

-- Create embedding queue table to track processing
CREATE TABLE embedding_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    content_chunk_id UUID NOT NULL REFERENCES content_chunks(id) ON DELETE CASCADE,
    status VARCHAR(50) NOT NULL DEFAULT 'pending', -- 'pending', 'processing', 'completed', 'failed'
    priority INTEGER NOT NULL DEFAULT 5, -- 1 (highest) to 10 (lowest)
    attempt_count INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    last_attempt_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMPTZ,
    error_message TEXT,
    UNIQUE (content_chunk_id)
);

CREATE INDEX idx_embedding_queue_status_priority ON embedding_queue(status, priority, created_at);
```

### 3. Vector Record Structure in Qdrant

```python
# Each vector record in Qdrant will include:
vector_record = {
    # The vector data (e.g., from OpenAI embeddings API)
    "vector": [0.1, 0.2, ...],  # 1536-dimensional array
    
    # Unique ID (using content_chunk.id as string)
    "id": content_chunk_id,
    
    # Metadata (payload in Qdrant terminology)
    "payload": {
        # Core identification and filtering fields
        "tenant_id": tenant_id,
        "project_id": project_id,
        "content_id": content_id,
        "chunk_index": chunk_index,
        
        # Content metadata for filtering and display
        "content_type": content_type,
        "thread_ids": [thread_id1, thread_id2],  # threads containing this content
        "title": content_title,  # From parent content item
        "created_at": created_timestamp,
        "updated_at": updated_timestamp,
        
        # Optional: preview text for faster results display
        "preview_text": chunk_text[:150],
        
        # Tracking fields
        "embedding_model": "text-embedding-ada-002",
        "embedding_version": "1"
    }
}
```

### 4. Qdrant Collection Indexing Configuration

```python
# Set up payload indexes for efficient filtering
client.create_payload_index(
    collection_name="content_chunks",
    field_name="tenant_id",
    field_schema=models.PayloadSchemaType.KEYWORD
)

client.create_payload_index(
    collection_name="content_chunks",
    field_name="project_id",
    field_schema=models.PayloadSchemaType.KEYWORD
)

client.create_payload_index(
    collection_name="content_chunks",
    field_name="content_type",
    field_schema=models.PayloadSchemaType.KEYWORD
)

client.create_payload_index(
    collection_name="content_chunks",
    field_name="thread_ids",
    field_schema=models.PayloadSchemaType.KEYWORD
)

client.create_payload_index(
    collection_name="content_chunks",
    field_name="created_at",
    field_schema=models.PayloadSchemaType.DATETIME
)
```

## Synchronization Process

### 1. Content Creation/Update Flow

```python
def process_content_chunk(chunk_id):
    # 1. Get chunk data from PostgreSQL
    chunk = db.query("SELECT * FROM content_chunks WHERE id = %s", (chunk_id,))
    content_item = db.query("SELECT * FROM content_items WHERE id = %s", (chunk.content_id,))
    
    # 2. Update chunk status
    db.execute("UPDATE content_chunks SET embedding_status = 'processing' WHERE id = %s", (chunk_id,))
    
    try:
        # 3. Generate embedding via OpenAI API
        embedding = openai.Embedding.create(
            input=chunk.content,
            model="text-embedding-ada-002"
        )["data"][0]["embedding"]
        
        # 4. Get related thread IDs
        thread_ids = db.query(
            "SELECT thread_id FROM thread_content WHERE content_id = %s", 
            (chunk.content_id,)
        )
        
        # 5. Create/update vector in Qdrant
        client.upsert(
            collection_name="content_chunks",
            points=[
                models.PointStruct(
                    id=str(chunk_id),
                    vector=embedding,
                    payload={
                        "tenant_id": str(chunk.tenant_id),
                        "project_id": str(content_item.project_id),
                        "content_id": str(chunk.content_id),
                        "chunk_index": chunk.chunk_index,
                        "content_type": content_item.content_type,
                        "thread_ids": [str(t.thread_id) for t in thread_ids],
                        "title": content_item.title,
                        "preview_text": chunk.content[:150],
                        "created_at": chunk.created_at.isoformat(),
                        "updated_at": datetime.now().isoformat(),
                        "embedding_model": "text-embedding-ada-002",
                        "embedding_version": "1"
                    }
                )
            ]
        )
        
        # 6. Update PostgreSQL with success status
        db.execute(
            """
            UPDATE content_chunks 
            SET embedding_status = 'completed', 
                vector_id = %s,
                embedding_model = %s,
                embedding_version = %s,
                last_embedded_at = NOW() 
            WHERE id = %s
            """, 
            (str(chunk_id), "text-embedding-ada-002", "1", chunk_id)
        )
        
        # 7. Mark queue item as completed
        db.execute(
            """
            UPDATE embedding_queue 
            SET status = 'completed', completed_at = NOW() 
            WHERE content_chunk_id = %s
            """, 
            (chunk_id,)
        )
    
    except Exception as e:
        # Handle errors
        db.execute(
            """
            UPDATE content_chunks 
            SET embedding_status = 'failed', embedding_error = %s 
            WHERE id = %s
            """, 
            (str(e), chunk_id)
        )
        
        # Update queue with failure
        db.execute(
            """
            UPDATE embedding_queue 
            SET status = 'failed', error_message = %s, 
                attempt_count = attempt_count + 1,
                last_attempt_at = NOW()
            WHERE content_chunk_id = %s
            """, 
            (str(e), chunk_id)
        )
        
        # Retry if under max attempts
        db.execute(
            """
            UPDATE embedding_queue 
            SET status = 'pending'
            WHERE content_chunk_id = %s AND attempt_count < max_attempts
            """, 
            (chunk_id,)
        )
```

### 2. Triggering the Embedding Process

```sql
-- PostgreSQL trigger to queue embedding generation
CREATE OR REPLACE FUNCTION queue_embedding_job()
RETURNS TRIGGER AS $$
BEGIN
    -- Create/update embedding queue entry when content chunk is created or changed
    INSERT INTO embedding_queue (tenant_id, content_chunk_id, priority)
    VALUES (NEW.tenant_id, NEW.id, 5)
    ON CONFLICT (content_chunk_id) 
    DO UPDATE SET 
        status = 'pending',
        attempt_count = 0,
        last_attempt_at = NULL,
        error_message = NULL;
    
    -- Update content chunk status
    UPDATE content_chunks 
    SET embedding_status = 'pending', 
        embedding_error = NULL
    WHERE id = NEW.id;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER queue_content_chunk_embedding
AFTER INSERT OR UPDATE OF content ON content_chunks
FOR EACH ROW EXECUTE FUNCTION queue_embedding_job();

-- Trigger for when content is added to or removed from threads
CREATE OR REPLACE FUNCTION update_thread_content_embedding()
RETURNS TRIGGER AS $$
BEGIN
    -- When content is added to or removed from a thread,
    -- we need to update the thread_ids in Qdrant
    -- Mark all chunks for this content item as needing updates
    INSERT INTO embedding_queue (
        tenant_id, 
        content_chunk_id, 
        priority,
        status
    )
    SELECT 
        cc.tenant_id, 
        cc.id, 
        7, -- Lower priority than new content
        'pending'
    FROM 
        content_chunks cc
    WHERE 
        cc.content_id = NEW.content_id OR cc.content_id = OLD.content_id
    ON CONFLICT (content_chunk_id) 
    DO UPDATE SET 
        status = 'pending',
        priority = 7;
    
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER thread_content_embedding_update
AFTER INSERT OR UPDATE OR DELETE ON thread_content
FOR EACH ROW EXECUTE FUNCTION update_thread_content_embedding();
```

## Search Query Implementation

```python
def semantic_search(query_text, tenant_id, project_id=None, thread_id=None, limit=10):
    # 1. Generate embedding for query
    embedding = openai.Embedding.create(
        input=query_text,
        model="text-embedding-ada-002"
    )["data"][0]["embedding"]
    
    # 2. Build filter conditions
    filter_conditions = models.Filter(
        must=[
            models.FieldCondition(
                key="tenant_id",
                match=models.MatchValue(value=str(tenant_id))
            )
        ]
    )
    
    # Add project filter if specified
    if project_id:
        filter_conditions.must.append(
            models.FieldCondition(
                key="project_id",
                match=models.MatchValue(value=str(project_id))
            )
        )
    
    # Add thread filter if specified
    if thread_id:
        filter_conditions.must.append(
            models.FieldCondition(
                key="thread_ids",
                match=models.MatchValue(value=str(thread_id))
            )
        )
    
    # 3. Perform search
    search_results = client.search(
        collection_name="content_chunks",
        query_vector=embedding,
        limit=limit,
        query_filter=filter_conditions
    )
    
    # 4. Process results
    content_chunk_ids = [uuid.UUID(result.id) for result in search_results]
    scores = {result.id: result.score for result in search_results}
    
    # 5. Fetch full content from PostgreSQL
    chunks = db.query(
        """
        SELECT cc.*, ci.title, ci.id as content_item_id 
        FROM content_chunks cc
        JOIN content_items ci ON cc.content_id = ci.id
        WHERE cc.id = ANY(%s)
        """, 
        (content_chunk_ids,)
    )
    
    # 6. Combine and return results
    results = []
    for chunk in chunks:
        results.append({
            "chunk_id": chunk.id,
            "content_id": chunk.content_id,
            "title": chunk.title,
            "content": chunk.content,
            "similarity_score": scores[str(chunk.id)],
            "preview": chunk.content[:150] + "..." if len(chunk.content) > 150 else chunk.content
        })
    
    # Sort by similarity score (highest first)
    results.sort(key=lambda x: x["similarity_score"], reverse=True)
    
    return results
```

## Additional Schema Extensions for Advanced Features

### 1. Document-Level Embedding Storage

```sql
-- Add embedding fields to content_items table for document-level embeddings
ALTER TABLE content_items
ADD COLUMN has_document_embedding BOOLEAN DEFAULT FALSE,
ADD COLUMN document_vector_id TEXT,
ADD COLUMN document_embedding_status VARCHAR(50) DEFAULT NULL;

-- Add to embedding queue
CREATE TABLE document_embedding_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    content_id UUID NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    priority INTEGER NOT NULL DEFAULT 6,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    last_attempt_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMPTZ,
    error_message TEXT,
    UNIQUE (content_id)
);
```

### 2. Vector Collection for Content-Content Similarity

```python
# Create a separate collection for content-level embeddings
client.create_collection(
    collection_name="content_items",
    vectors_config=models.VectorParams(
        size=1536,
        distance=models.Distance.COSINE
    )
)

# Set up necessary payload indexes
client.create_payload_index(
    collection_name="content_items",
    field_name="tenant_id",
    field_schema=models.PayloadSchemaType.KEYWORD
)

client.create_payload_index(
    collection_name="content_items",
    field_name="project_id",
    field_schema=models.PayloadSchemaType.KEYWORD
)
```

## Implementation Recommendations

1. **Worker Design**: Implement an asynchronous worker service to process the embedding queue

2. **Batch Processing**: Process embeddings in batches to reduce API costs and improve throughput:
   ```python
   def process_embedding_batch(batch_size=50):
       # Get batch of pending items
       pending_items = db.query(
           """
           SELECT content_chunk_id 
           FROM embedding_queue 
           WHERE status = 'pending' 
           ORDER BY priority, created_at 
           LIMIT %s
           """, 
           (batch_size,)
       )
       
       # Process each item
       for item in pending_items:
           process_content_chunk(item.content_chunk_id)
   ```

3. **Regular Reindexing**: Schedule periodic reindexing when embedding models are updated:
   ```python
   def schedule_reindexing(new_model_version):
       # Mark all chunks for reindexing
       db.execute(
           """
           INSERT INTO embedding_queue (tenant_id, content_chunk_id, priority, status)
           SELECT tenant_id, id, 8, 'pending'
           FROM content_chunks
           WHERE embedding_version != %s
           ON CONFLICT (content_chunk_id) 
           DO UPDATE SET status = 'pending', priority = 8
           """,
           (new_model_version,)
       )
   ```

4. **Health Monitoring**: Create a monitoring endpoint to track embedding status:
   ```python
   def get_embedding_health():
       stats = db.query(
           """
           SELECT 
               embedding_status, 
               COUNT(*) as count,
               (COUNT(*) * 100.0 / (SELECT COUNT(*) FROM content_chunks)) as percentage
           FROM content_chunks
           GROUP BY embedding_status
           """
       )
       return stats
   ```

This schema provides a robust foundation for integrating vector search capabilities into ContextNexus with clearly defined data structures, synchronization processes, and query patterns. The Qdrant implementation offers excellent performance characteristics while maintaining the flexibility you'll need as your system evolves.
