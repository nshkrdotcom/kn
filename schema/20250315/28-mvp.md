Okay, let's synthesize everything we've covered about ContextNexus, incorporating the insights from the `README.md` and refining the database schema and system architecture. The goal is a streamlined, PostgreSQL-only MVP focused on *core context management*, deferring AI-driven features and the knowledge graph (Neo4j) to a later stage.

**Core Requirements (from README and Discussions)**

1.  **Context Management:** The system's primary function is to allow users to explicitly and visually manage the context provided to a Large Language Model (LLM). This is the *defining* feature.
2.  **Rapid Content Selection:** Users need to quickly select relevant content to include in the context.
3.  **Multi-Level Organization:** Context should be organizable hierarchically (threads and sub-threads).
4.  **Dynamic Branching:** Users should be able to create separate conversation branches with different contexts.
5.  **Token Optimization:** The system should minimize token usage by including only relevant content.
6.  **Real-time Collaboration (Secondary):**  While full CRDT-based collaboration is complex, basic presence and awareness are desirable.
7.  **Multi-tenancy:** The system must support multiple isolated tenants (organizations).
8.  **Persistence:**  Context and conversations should be persistently stored.
9.  **LLM Integration (Basic):** The system needs to interact with an LLM (e.g., OpenAI, Anthropic) to generate responses.

**Simplifications for the MVP**

*   **No Neo4j (for now):** We'll defer the knowledge graph and Neo4j integration to a later phase.
*   **No Specialized Vector Database (for now):** We'll use basic text search and manual relevance scoring for the MVP. We will *not* incorporate a vector database yet.
*   **Simplified Real-time Collaboration:** Focus on presence (who's online/viewing a thread) and basic locking, *not* full CRDT-based co-editing.
*   **Manual Relevance:** Users will manually set relevance scores (rather than using AI-driven scoring).
*   **No Automatic Chunking:** While chunking is useful, we are deferring this to a later stage.
*   **No AI-Driven Features:** No semantic search, automatic summarization, or AI-powered relationship discovery in the MVP. Focus on manual context management.

**PostgreSQL Schema (Streamlined MVP)**

```sql
-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto"; -- For password hashing, if needed
-- CREATE EXTENSION IF NOT EXISTS "pg_trgm"; -- If you want trigram-based text search
-- CREATE EXTENSION IF NOT EXISTS "hstore"; -- If you want hstore

-- Tenants (Multi-tenancy)
CREATE TABLE tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(50) UNIQUE NOT NULL,  -- For URLs
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT TRUE
    -- Add other tenant-level settings here (e.g., theme, features) if needed.
    -- Keep it MINIMAL for the MVP.
);

-- Users
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL, -- Store hashed passwords!
    role VARCHAR(50) NOT NULL DEFAULT 'user', -- 'user', 'admin', etc.
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMPTZ,
    UNIQUE (tenant_id, email)
);

-- Projects (simplified)
CREATE TABLE projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT, -- Keep descriptions, they're useful.
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (tenant_id, name) -- Unique project names within a tenant
);

-- Threads (Contexts)
CREATE TABLE threads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    status VARCHAR(50) DEFAULT 'active',  -- 'active', 'archived'
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (tenant_id, project_id, name) -- Unique thread names within a project
);

-- Thread Hierarchy (Parent-Child Relationships)
CREATE TABLE thread_relationships (
    parent_thread_id UUID NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    child_thread_id UUID NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    relationship_type VARCHAR(50) DEFAULT 'contains', -- Keep this for flexibility
    position INTEGER,  -- For ordering sibling threads
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (parent_thread_id, child_thread_id),
    CONSTRAINT no_self_reference CHECK (parent_thread_id != child_thread_id)
);

-- Content Items (simplified - no external storage for MVP)
CREATE TABLE content_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
     title VARCHAR(255) NOT NULL,
    content_type VARCHAR(50) NOT NULL,  -- 'text', 'code', 'message' - keep it simple
    content TEXT NOT NULL,             -- Store content directly in PostgreSQL for MVP
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    -- source_url and author can be added if needed
);

-- Thread Content (Linking Threads to Content)
CREATE TABLE thread_content (
    thread_id UUID NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    content_item_id UUID NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
    relevance_score INTEGER DEFAULT 1,  -- Manual relevance (1-5, for example)
    position INTEGER,                   -- For manual ordering within the thread
    added_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (thread_id, content_item_id)
);

-- Messages (Within Threads)
CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    thread_id UUID NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id), -- NULL for system/AI messages
    role VARCHAR(50) NOT NULL,     -- 'system', 'user', 'assistant'
    content TEXT NOT NULL,
    model_id VARCHAR(100), --  e.g., 'gpt-4', 'claude-2'.  Keep this.
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Message Relationships (for branching conversations - keep this)
CREATE TABLE message_relationships (
    parent_message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    child_message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    relationship_type VARCHAR(50) DEFAULT 'response', -- 'response', 'alternative'
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (parent_message_id, child_message_id),
    CONSTRAINT no_self_reference CHECK (parent_message_id != child_message_id)
);

-- --- Real-time Collaboration (Simplified) ---

-- User Sessions (Simplified)
CREATE TABLE user_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    connected_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    last_activity_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT TRUE,
    expires_at TIMESTAMPTZ NOT NULL
    -- Remove client_id, device_info, ip_address, metadata for MVP simplicity
);

-- Resource Presence (Simplified)
CREATE TABLE resource_presence (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    session_id UUID NOT NULL REFERENCES user_sessions(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    resource_type VARCHAR(50) NOT NULL, -- 'project', 'thread' (Keep it simple)
    resource_id UUID NOT NULL,
    last_active_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (session_id, resource_type, resource_id)
);
CREATE INDEX idx_resource_presence_resource ON resource_presence(resource_type, resource_id);

-- --- LLM Integration (Basic) ---
-- Keep track of available models
CREATE TABLE llm_models (
    id VARCHAR(100) PRIMARY KEY,  -- e.g., 'gpt-4', 'claude-2'
    provider VARCHAR(100) NOT NULL, -- 'openai', 'anthropic', etc.
    display_name VARCHAR(255) NOT NULL,
    max_tokens INTEGER NOT NULL,
    is_enabled BOOLEAN DEFAULT TRUE
);

-- --- Optimistic Locking ---
ALTER TABLE content_items ADD COLUMN pg_version BIGINT DEFAULT 1;
ALTER TABLE threads ADD COLUMN pg_version BIGINT DEFAULT 1;
ALTER TABLE messages ADD COLUMN pg_version BIGINT DEFAULT 1;

-- --- Indexes ---

CREATE INDEX idx_messages_thread_created ON messages (tenant_id, thread_id, created_at);

-- --- Helper Functions ---
CREATE OR REPLACE FUNCTION update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Auto-update trigger
CREATE TRIGGER update_content_items_timestamp
BEFORE UPDATE ON content_items
FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER update_threads_timestamp
BEFORE UPDATE ON threads
FOR EACH ROW EXECUTE FUNCTION update_timestamp();

-- Function to update session activity (simplified)
CREATE OR REPLACE FUNCTION update_session_activity()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE user_sessions
    SET last_activity_at = CURRENT_TIMESTAMP
    WHERE id = NEW.session_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_session_on_presence
AFTER INSERT OR UPDATE ON resource_presence
FOR EACH ROW
EXECUTE FUNCTION update_session_activity();

-- --- Debezium Outbox Table (Simplified) ---
CREATE TABLE outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type VARCHAR(255) NOT NULL,
  aggregate_type VARCHAR(255) NOT NULL,
  aggregate_id UUID NOT NULL,
  payload JSONB NOT NULL,
  emitted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- --- Example Debezium Trigger ---
-- (This is a SIMPLIFIED example.  In a real system, you'd likely have separate
--  triggers for INSERT, UPDATE, and DELETE, and more sophisticated logic
--  to construct the payload.)
CREATE OR REPLACE FUNCTION outbox_event()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO outbox (event_type, aggregate_type, aggregate_id, payload, emitted_at)
  VALUES (
      CASE TG_OP
          WHEN 'INSERT' THEN TG_TABLE_NAME || '.created'
          WHEN 'UPDATE' THEN TG_TABLE_NAME || '.updated'
          WHEN 'DELETE' THEN TG_TABLE_NAME || '.deleted'
          END,
      TG_TABLE_NAME, -- e.g., 'content_items'
      CASE TG_OP
        WHEN 'DELETE' THEN OLD.id
        ELSE NEW.id
      END,
      CASE TG_OP
        WHEN 'DELETE' THEN row_to_json(OLD)
        ELSE row_to_json(NEW)
        END,
      NOW()
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply the trigger to relevant tables (example):
CREATE TRIGGER content_items_outbox_trigger
AFTER INSERT OR UPDATE OR DELETE ON content_items
FOR EACH ROW EXECUTE FUNCTION outbox_event();
```

**Key Changes and Justification:**

*   **Removed:** Many tables related to advanced features (vector DB integration, detailed usage stats, knowledge graph configuration, CRDT operations log, document snapshots, annotations, selections, conflict resolutions, etc.). These are all deferred to later stages.
*   **Simplified:** `content_items` now stores content directly as `TEXT`. This eliminates the need for separate `text_content`, `code_content`, etc., tables in the MVP.
*   **Simplified:** `user_sessions` and `resource_presence` are streamlined for basic presence tracking.
*   **Simplified:** `storage_types`, `content_types`, `prompt_templates`, `context_templates`, and `search_configurations` are all removed for the MVP.
*   **Added:** `pg_version` for optimistic locking.
*   **Added:** Basic `outbox` table for Debezium integration (simplified).
*   **Added:** Basic triggers for outbox and `pg_version`.
* **Kept:** Core multi-tenancy, project/thread structure, message handling, basic LLM model tracking.
* **Kept:**  Basic audit columns.

**System Architecture (MVP)**

The MVP architecture will be considerably simpler:

```
+---------------------+     +---------------------+     +---------------------+     +---------------------+
|     User Client     |     |      API Gateway      |     |     PostgreSQL      |     |         LLM         |
|    (Web Browser)    | <-> |     (GraphQL/REST)    | <-> |   (Primary Data)    | <-> |       (e.g., OpenAI)  |
+---------------------+     +---------------------+     +---------------------+     +---------------------+
                              ^                                      ^
                              |                                      |
                              |         +------------------------+   |
                              |         |        Debezium        |   |
                              |         +------------------------+   |
                              |                   |                |
                              |         +------------------------+   |
                              |         |     Message Queue      |   |  (e.g., Kafka, RabbitMQ)
                              |         +------------------------+   |
                              |                   |                |
                              |         +------------------------+   |
                              |         |   Sync Service (TBD)   |   |
                              |         +------------------------+   |
                              +------------------------------------+
                                         Application Logic

```

*   **User Client:**  Web browser running a JavaScript frontend (e.g., React, Vue, Angular).
*   **API Gateway:**  A GraphQL or REST API that handles user authentication, authorization, and data access.
*   **PostgreSQL:**  The primary database, storing all application data.
*   **LLM:**  An external LLM API (e.g., OpenAI, Anthropic).  The API Gateway interacts with the LLM.
*   **Debezium:**  Captures changes from PostgreSQL's `outbox` table and publishes them to the Message Queue.
*   **Message Queue:**  Kafka or RabbitMQ.  Used for asynchronous communication between Debezium and the Sync Service.
*   **Sync Service (TBD):**  A service (likely written in Python, Go, or Java) that consumes messages from the Message Queue.  For the MVP, its *only* job is to handle potential future database migrations. This can wait.

**Next Steps (Prioritized Implementation Plan for MVP)**

1.  **Implement Core PostgreSQL Schema:** Create the tables defined above in your PostgreSQL database.
2.  **Build API Endpoints:** Create API endpoints (GraphQL or REST) for:
    *   User authentication and management.
    *   Project creation and management.
    *   Thread creation and management.
    *   Content item creation, retrieval, updating, and deletion.
    *   Message creation and retrieval (within threads).
    *   Adding/removing content items from threads (managing `thread_content`).
    *   Basic presence updates (`resource_presence`).
3.  **Implement Basic UI:** Build a user interface that allows users to:
    *   Create and manage projects and threads.
    *   Add and manage content items (text and code).
    *   Participate in conversations within threads (send messages to the LLM and receive responses).
    *   Select content items to include in the context for each message.
4.  **Integrate with LLM API:**  Implement the logic to send prompts to the LLM API and receive responses.  Include the selected content items in the prompt context.
5.  **Implement Basic Presence:**  Use WebSockets (or a library like Phoenix Channels) to track which users are online and viewing which threads.
6.  **Implement Optimistic Locking:** Add logic to handle concurrent updates using the `pg_version` column.
7. **Setup Debezium and Kafka/RabbitMQ.**
8. **Build very simple service that reads outbox and does nothing** This is a placeholder.

This streamlined approach focuses on the *core* context management features, deferring the more complex aspects (vector search, knowledge graph, full real-time collaboration) to later iterations.  This allows you to build a functional MVP quickly and then iterate based on user feedback and evolving requirements.

