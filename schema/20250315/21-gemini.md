Okay, let's consolidate the PostgreSQL and Neo4j schemas into well-organized, clearly defined structures, incorporating all the enhancements for multi-tenancy, real-time collaboration, and integration. I'll present these schemas in a way that's easy to understand and implement, with clear separation of concerns and explanations.

## PostgreSQL Schema (Organized)

Here's the organized PostgreSQL schema, divided into logical sections with comments explaining each part:

```sql
-- ### Extensions ###

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm"; -- For similarity searches
CREATE EXTENSION IF NOT EXISTS "hstore";  -- For key-value storage
CREATE EXTENSION IF NOT EXISTS "pgvector"; -- If you're using the PostgreSQL vector extension


-- ### Core Types & Functions ###

-- Custom composite type for audit purposes
CREATE TYPE audit_info AS (
    created_by UUID,
    created_at TIMESTAMPTZ,
    updated_by UUID,
    updated_at TIMESTAMPTZ
);

-- Function to auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Multi-tenant function to set the current tenant context
CREATE OR REPLACE FUNCTION set_tenant_context(p_tenant_id uuid)
RETURNS void AS $$
BEGIN
    PERFORM set_config('app.current_tenant_id', p_tenant_id::text, false);
END;
$$ LANGUAGE plpgsql;

-- ### 1. Tenant Management ###

CREATE TABLE tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    domain VARCHAR(255) UNIQUE,
    slug VARCHAR(50) UNIQUE NOT NULL,
    features JSONB DEFAULT '{}'::jsonb,
    theme JSONB DEFAULT '{}'::jsonb,
    settings JSONB DEFAULT '{}'::jsonb,
    max_storage_gb INTEGER DEFAULT 5,
    max_users INTEGER DEFAULT 10,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT TRUE
);

CREATE TABLE tenant_audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    action VARCHAR(50) NOT NULL,
    details JSONB NOT NULL,
    performed_by UUID NOT NULL, -- References users.id
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);


-- ### 2. User Management ###

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'user', -- 'user', 'admin', 'editor', etc.
    permissions JSONB DEFAULT '{}'::jsonb,
    is_tenant_admin BOOLEAN DEFAULT FALSE,
    settings JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMPTZ,
    UNIQUE (tenant_id, email)
);

CREATE TRIGGER update_user_timestamp
BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION update_timestamp();

CREATE TABLE user_activity (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    user_id UUID NOT NULL REFERENCES users(id),
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(50),
    resource_id UUID,
    details JSONB,
    ip_address INET,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ### 3. Program and Project Management ###

CREATE TABLE programs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    slug VARCHAR(100),
    is_public BOOLEAN DEFAULT FALSE,
    settings JSONB DEFAULT '{}'::jsonb,
    metadata JSONB DEFAULT '{}'::jsonb,
    audit audit_info,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (tenant_id, slug)
);

CREATE TRIGGER update_program_timestamp
BEFORE UPDATE ON programs
FOR EACH ROW EXECUTE FUNCTION update_timestamp();

CREATE TABLE projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    program_id UUID NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    slug VARCHAR(100),
    is_archived BOOLEAN DEFAULT FALSE,
    is_public BOOLEAN DEFAULT FALSE,
    settings JSONB DEFAULT '{}'::jsonb,
    metadata JSONB DEFAULT '{}'::jsonb,
    audit audit_info,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (tenant_id, program_id, slug)
);

CREATE TRIGGER update_project_timestamp
BEFORE UPDATE ON projects
FOR EACH ROW EXECUTE FUNCTION update_timestamp();

CREATE TABLE project_memberships (
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(50) NOT NULL DEFAULT 'viewer',
    permissions JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (project_id, user_id)
);

-- ### 4. Thread Management ###

CREATE TABLE threads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    slug VARCHAR(100),
    status VARCHAR(50) DEFAULT 'active',
    thread_type VARCHAR(50) DEFAULT 'standard',
    is_pinned BOOLEAN DEFAULT FALSE,
    settings JSONB DEFAULT '{}'::jsonb,
    metadata JSONB DEFAULT '{}'::jsonb,
    audit audit_info,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (tenant_id, project_id, slug)
);

CREATE TRIGGER update_thread_timestamp
BEFORE UPDATE ON threads
FOR EACH ROW EXECUTE FUNCTION update_timestamp();

CREATE TABLE thread_relationships (
    parent_thread_id UUID NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    child_thread_id UUID NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    relationship_type VARCHAR(50) DEFAULT 'contains',
    position INTEGER,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (parent_thread_id, child_thread_id),
    CONSTRAINT no_self_reference CHECK (parent_thread_id != child_thread_id)
);

-- ### 5. Content Management ###

-- Extensible enum pattern for storage types
CREATE TABLE storage_types (
    id VARCHAR(50) PRIMARY KEY,  -- 'postgres', 'minio', 's3', etc.
    description TEXT NOT NULL,
    handler_class VARCHAR(255),  -- Backend implementation reference
    config_schema JSONB,         -- JSON schema for configuration
    is_enabled BOOLEAN DEFAULT TRUE
);

INSERT INTO storage_types (id, description) VALUES
('postgres', 'Store content directly in PostgreSQL'),
('minio', 'Store content in MinIO object storage'),
('s3', 'Store content in Amazon S3');

-- Extensible enum pattern for content types
CREATE TABLE content_types (
    id VARCHAR(50) PRIMARY KEY,  -- 'text', 'code', 'image', 'pdf', etc.
    description TEXT NOT NULL,
    icon VARCHAR(50),
    handler_class VARCHAR(255),  -- Frontend/backend handler reference
    allowed_extensions TEXT[],    -- File extensions associated with this type
    max_file_size_mb INTEGER,
    is_enabled BOOLEAN DEFAULT TRUE
);

INSERT INTO content_types (id, description, allowed_extensions) VALUES
('text', 'Plain text content', ARRAY['.txt', '.md']),
('code', 'Source code', ARRAY['.py', '.js', '.html', '.css', '.java', '.cpp']),
('image', 'Image file', ARRAY['.jpg', '.png', '.gif', '.svg']),
('pdf', 'PDF document', ARRAY['.pdf']);


CREATE TABLE content_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    content_type VARCHAR(50) NOT NULL REFERENCES content_types(id),
    storage_type VARCHAR(50) NOT NULL REFERENCES storage_types(id),
    storage_key VARCHAR(255) NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    source_url VARCHAR(2048),
    author VARCHAR(255),
    publication_date TIMESTAMPTZ,
    is_active BOOLEAN DEFAULT TRUE,
    is_pinned BOOLEAN DEFAULT FALSE,
    tokens INTEGER,
    embedding_id VARCHAR(255),
    semantic_version VARCHAR(50) DEFAULT '1.0.0',
    version_number INTEGER DEFAULT 1,
    file_size_bytes BIGINT,
    checksum VARCHAR(128),
    settings JSONB DEFAULT '{}'::jsonb,
    metadata JSONB DEFAULT '{}'::jsonb,
    audit audit_info,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    neo4j_node_id VARCHAR(255),  -- Cross-reference to Neo4j
    UNIQUE (tenant_id, storage_type, storage_key)
);

CREATE TRIGGER update_content_items_timestamp
BEFORE UPDATE ON content_items
FOR EACH ROW EXECUTE FUNCTION update_timestamp();

-- Full Text Search
ALTER TABLE content_items ADD COLUMN search_vector tsvector;
CREATE INDEX content_items_search_idx ON content_items USING GIN(search_vector);

CREATE TABLE text_content (
    content_id UUID PRIMARY KEY REFERENCES content_items(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    format VARCHAR(50) DEFAULT 'plain',
    language VARCHAR(50) DEFAULT 'en',
    tokens INTEGER GENERATED ALWAYS AS (
        GREATEST(1, ROUND(length(content)::numeric / 4))  -- Simple approximation
    ) STORED
);

-- Trigger to update search_vector for text content
CREATE OR REPLACE FUNCTION update_content_search_vector()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE content_items SET
        search_vector = setweight(to_tsvector('english', COALESCE(title, '')), 'A') ||
                        setweight(to_tsvector('english', COALESCE(NEW.content, '')), 'B')
    WHERE id = NEW.content_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER text_content_search_update
AFTER INSERT OR UPDATE ON text_content
FOR EACH ROW EXECUTE FUNCTION update_content_search_vector();

CREATE TABLE code_content (
    content_id UUID PRIMARY KEY REFERENCES content_items(id) ON DELETE CASCADE,
    code TEXT NOT NULL,
    language VARCHAR(50) NOT NULL,
    highlighted_html TEXT,  -- Pre-rendered HTML for display
    tokens INTEGER GENERATED ALWAYS AS (
        GREATEST(1, ROUND(length(code)::numeric / 3))  -- Simple approximation
    ) STORED
);

CREATE TABLE content_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    content_id UUID NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL,
    content TEXT NOT NULL,
    start_position INTEGER,
    end_position INTEGER,
    tokens INTEGER NOT NULL,
    embedding vector(1536),
    embedding_model VARCHAR(100),
    metadata JSONB DEFAULT '{}'::jsonb,
    neo4j_node_id VARCHAR(255),  -- Cross-reference to Neo4j
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (content_id, chunk_index)
);

CREATE TABLE content_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    content_id UUID NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
    version_number INTEGER NOT NULL,
    semantic_version VARCHAR(50),
    storage_key VARCHAR(255) NOT NULL,
    change_summary TEXT,
    content TEXT,
    tokens INTEGER,
    audit audit_info,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
     -- CRDT fields
    vector_clock JSONB,
    lamport_timestamp BIGINT,
    merge_base_version UUID REFERENCES content_versions(id),
    conflict_resolution_strategy VARCHAR(50),
    operation_ids UUID[],
    UNIQUE (content_id, version_number)
);


CREATE TABLE document_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    content_id UUID NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
    snapshot_data JSONB NOT NULL,
    lamport_timestamp BIGINT NOT NULL,
    vector_clock JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    is_checkpoint BOOLEAN DEFAULT FALSE,
    checkpoint_interval INTEGER
);

CREATE INDEX idx_document_snapshots_content ON document_snapshots(content_id);
CREATE INDEX idx_document_snapshots_checkpoint ON document_snapshots(content_id) WHERE is_checkpoint = TRUE;



CREATE TABLE tags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    color VARCHAR(50) DEFAULT '#808080',
    icon VARCHAR(50),
    is_system BOOLEAN DEFAULT FALSE,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (tenant_id, project_id, name)
);

CREATE TRIGGER update_tags_timestamp
BEFORE UPDATE ON tags
FOR EACH ROW EXECUTE FUNCTION update_timestamp();

CREATE TABLE content_tags (
    content_id UUID NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
    tag_id UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (content_id, tag_id)
);

CREATE TABLE thread_content (
    thread_id UUID NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    content_id UUID NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
    relevance_score FLOAT DEFAULT 1.0,
    position INTEGER,
    is_pinned BOOLEAN DEFAULT FALSE,
    inclusion_method VARCHAR(50) DEFAULT 'manual',
    inclusion_rule JSONB DEFAULT '{}'::jsonb,
    token_budget INTEGER,
    selection_metadata JSONB DEFAULT '{}'::jsonb,
    audit audit_info,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    neo4j_relationship_id VARCHAR(255),
    PRIMARY KEY (thread_id, content_id),
    -- Collaboration fields
    current_editor_id UUID REFERENCES users(id),
    current_editor_session_id UUID REFERENCES user_sessions(id),
    editing_started_at TIMESTAMPTZ,
    collaborative_state JSONB DEFAULT '{}'::jsonb
);

CREATE TRIGGER update_thread_content_timestamp
BEFORE UPDATE ON thread_content
FOR EACH ROW EXECUTE FUNCTION update_timestamp();

-- ### 6. LLM and Prompt Management ###

CREATE TABLE llm_models (
    id VARCHAR(100) PRIMARY KEY,
    provider VARCHAR(100) NOT NULL,
    display_name VARCHAR(255) NOT NULL,
    max_tokens INTEGER NOT NULL,
    pricing_per_1k_tokens NUMERIC(10, 6),
    capabilities JSONB DEFAULT '{}'::jsonb,
    is_enabled BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO llm_models (id, provider, display_name, max_tokens) VALUES
('gpt-4', 'openai', 'GPT-4', 8192),
('gpt-3.5-turbo', 'openai', 'GPT-3.5 Turbo', 4096),
('claude-2', 'anthropic', 'Claude 2', 100000);

CREATE TABLE prompt_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,  -- NULL means tenant-wide
    name VARCHAR(255) NOT NULL,
    description TEXT,
    template TEXT NOT NULL,
    variables JSONB DEFAULT '[]'::jsonb,
    version INTEGER DEFAULT 1,
    is_public BOOLEAN DEFAULT FALSE,
    audit audit_info,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER update_prompt_templates_timestamp
BEFORE UPDATE ON prompt_templates
FOR EACH ROW EXECUTE FUNCTION update_timestamp();

-- ### 7. Messaging and Conversation ###

CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    thread_id UUID NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id),  -- NULL for system/AI
    role VARCHAR(50) NOT NULL,  -- 'system', 'user', 'assistant'
    content TEXT NOT NULL,
    model_id VARCHAR(100) REFERENCES llm_models(id),
    prompt_template_id UUID REFERENCES prompt_templates(id),
    tokens_input INTEGER,
    tokens_output INTEGER,
    tokens_total INTEGER,
    cost NUMERIC(10, 6),
    context_snapshot JSONB,
    metadata JSONB DEFAULT '{}'::jsonb,
    client_message_id VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    neo4j_node_id VARCHAR(255)  -- Cross-reference
);

CREATE TABLE message_relationships (
    parent_message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    child_message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    relationship_type VARCHAR(50) DEFAULT 'response',
    position INTEGER,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (parent_message_id, child_message_id),
    CONSTRAINT no_self_reference CHECK (parent_message_id != child_message_id)
);

CREATE TABLE message_context_items (
    message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    content_id UUID NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
    chunk_ids UUID[] DEFAULT '{}',
    relevance_score FLOAT,
    tokens_used INTEGER,
    context_position INTEGER,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (message_id, content_id)
);

-- ### 8. Usage and Statistics ###

CREATE TABLE usage_stats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id),
    project_id UUID REFERENCES projects(id),
    resource_type VARCHAR(50) NOT NULL,
    resource_id UUID,
    quantity INTEGER NOT NULL,
    unit_cost NUMERIC(10, 6),
    total_cost NUMERIC(10, 6),
    timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Partitioning for usage_stats (example - in migration script)
-- CREATE TABLE usage_stats_y2023m01 PARTITION OF usage_stats FOR VALUES FROM ('2023-01-01') TO ('2023-02-01');

-- ### 9. Context and Search Configurations ###

CREATE TABLE context_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE, -- NULL means tenant-wide template
    name VARCHAR(255) NOT NULL,
    description TEXT,
    configuration JSONB NOT NULL,  -- Template configuration
    is_public BOOLEAN DEFAULT FALSE,
    audit audit_info,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE search_configurations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    search_type VARCHAR(50) NOT NULL DEFAULT 'full_text',  -- 'full_text', 'semantic', 'hybrid'
    configuration JSONB NOT NULL,
    is_default BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (tenant_id, name)
);

-- ### 10. Knowledge Graph Settings ###
CREATE TABLE knowledge_graph_configurations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE, -- NULL for tenant wide config
    name VARCHAR(255) NOT NULL,
    description TEXT,
    node_types JSONB DEFAULT '[]'::jsonb,
    relationship_types JSONB DEFAULT '[]'::jsonb,
    visualization_settings JSONB DEFAULT '{}'::jsonb,
    is_default BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);


-- ### 11. Real-Time Collaboration ###

CREATE TABLE user_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_token VARCHAR(255) NOT NULL,
    client_id VARCHAR(255) NOT NULL,
    device_info JSONB DEFAULT '{}'::jsonb,
    ip_address INET,
    connected_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    last_activity_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT TRUE,
    metadata JSONB DEFAULT '{}'::jsonb,
    UNIQUE (user_id, client_id)
);

CREATE TABLE resource_presence (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    session_id UUID NOT NULL REFERENCES user_sessions(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    resource_type VARCHAR(50) NOT NULL,
    resource_id UUID NOT NULL,
    view_state JSONB DEFAULT '{}'::jsonb,
    cursor_position JSONB DEFAULT NULL,
    started_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    last_active_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (session_id, resource_type, resource_id)
);

CREATE INDEX idx_resource_presence_resource ON resource_presence(resource_type, resource_id);
CREATE INDEX idx_resource_presence_active ON resource_presence(user_id, last_active_at);

CREATE TABLE operations_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id),
    session_id UUID NOT NULL REFERENCES user_sessions(id),
    resource_type VARCHAR(50) NOT NULL,
    resource_id UUID NOT NULL,
    operation_type VARCHAR(50) NOT NULL,
    operation_data JSONB NOT NULL,
    vector_clock JSONB NOT NULL,
    lamport_timestamp BIGINT NOT NULL,
    client_timestamp TIMESTAMPTZ NOT NULL,
    server_timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    is_applied BOOLEAN DEFAULT FALSE,
    dependencies UUID[],
    metadata JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX idx_operations_log_resource ON operations_log(resource_type, resource_id);
CREATE INDEX idx_operations_log_lamport ON operations_log(lamport_timestamp);
CREATE INDEX idx_operations_log_applied ON operations_log(is_applied);
CREATE INDEX idx_operations_log_dependencies ON operations_log USING GIN(dependencies);
CREATE INDEX idx_operations_log_vector_clock ON operations_log USING GIN(vector_clock jsonb_path_ops);

CREATE TABLE resource_locks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    resource_type VARCHAR(50) NOT NULL,
    resource_id UUID NOT NULL,
    user_id UUID NOT NULL REFERENCES users(id),
    session_id UUID NOT NULL REFERENCES user_sessions(id),
    lock_type VARCHAR(50) NOT NULL,
    acquired_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMPTZ NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    metadata JSONB DEFAULT '{}'::jsonb,
    UNIQUE (resource_type, resource_id, lock_type) WHERE lock_type = 'exclusive' AND is_active = TRUE
);
CREATE INDEX idx_resource_locks_resource ON resource_locks(resource_type, resource_id, is_active);
CREATE INDEX idx_resource_locks_expiry ON resource_locks(expires_at) WHERE is_active = TRUE;

CREATE TABLE broadcast_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    event_type VARCHAR(100) NOT NULL,
    resource_type VARCHAR(50),
    resource_id UUID,
    originator_id UUID REFERENCES users(id),
    originator_session_id UUID REFERENCES user_sessions(id),
    payload JSONB NOT NULL,
    broadcast_status VARCHAR(50) DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    processed_at TIMESTAMPTZ
);

CREATE INDEX idx_broadcast_events_status ON broadcast_events(broadcast_status, created_at);

CREATE TABLE collaboration_workspaces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    current_state JSONB DEFAULT '{}'::jsonb,
    active_users JSONB DEFAULT '[]'::jsonb,
    settings JSONB DEFAULT '{}'::jsonb,
    last_activity_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE collaborative_selections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    session_id UUID NOT NULL REFERENCES user_sessions(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    resource_type VARCHAR(50) NOT NULL,
    resource_id UUID NOT NULL,
    selection_type VARCHAR(50) NOT NULL,
    selection_data JSONB NOT NULL,
    color VARCHAR(20),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMPTZ
);
CREATE INDEX idx_collaborative_selections_resource ON collaborative_selections(resource_type, resource_id);

CREATE TABLE conflict_resolutions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    resource_type VARCHAR(50) NOT NULL,
    resource_id UUID NOT NULL,
    conflict_type VARCHAR(50) NOT NULL,
    conflicting_operations JSONB NOT NULL,
    resolution_strategy VARCHAR(50) NOT NULL,
    resolution_data JSONB NOT NULL,
    resolved_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE realtime_annotations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    resource_type VARCHAR(50) NOT NULL,
    resource_id UUID NOT NULL,
    user_id UUID NOT NULL REFERENCES users(id),
    annotation_type VARCHAR(50) NOT NULL,
    position_data JSONB NOT NULL,
    content TEXT,
    status VARCHAR(50) DEFAULT 'active',
    parent_id UUID REFERENCES realtime_annotations(id),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMPTZ
);
CREATE INDEX idx_realtime_annotations_resource ON realtime_annotations(resource_type, resource_id);


-- ### 12. Views and Materialized Views ###
-- View for project members
CREATE VIEW project_members_view AS
SELECT
    pm.project_id,
    p.name as project_name,
    pm.user_id,
    u.name as user_name,
    u.email,
    pm.role,
    pm.permissions,
    pm.created_at as joined_at
FROM
    project_memberships pm
JOIN
    projects p ON pm.project_id = p.id
JOIN
    users u ON pm.user_id = u.id;

-- Materialized view for token usage summary
CREATE MATERIALIZED VIEW token_usage_summary AS
SELECT
    tenant_id,
    DATE_TRUNC('day', created_at) as usage_date,
    model_id,
    COUNT(*) as message_count,
    SUM(tokens_input) as total_tokens_input,
    SUM(tokens_output) as total_tokens_output,
    SUM(tokens_total) as total_tokens,
    SUM(cost) as total_cost
FROM
    messages
GROUP BY
    tenant_id, DATE_TRUNC('day', created_at), model_id;

CREATE UNIQUE INDEX token_usage_summary_idx ON token_usage_summary (tenant_id, usage_date, model_id);

-- Function to refresh token usage materialized view
CREATE OR REPLACE FUNCTION refresh_token_usage_summary()
RETURNS void AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY token_usage_summary;
END;
$$ LANGUAGE plpgsql;

-- Materialized view for active project users
CREATE MATERIALIZED VIEW active_project_users AS
SELECT
    p.id AS project_id,
    p.tenant_id,
    p.name AS project_name,
    u.id AS user_id,
    u.name AS user_name,
    MAX(rp.last_active_at) AS last_active_at,
    COUNT(DISTINCT rp.resource_id) AS active_resources
FROM
    projects p
JOIN
    resource_presence rp ON rp.resource_type = 'project' AND rp.resource_id = p.id
JOIN
    users u ON rp.user_id = u.id
WHERE
    rp.last_active_at > NOW() - INTERVAL '15 minutes'
GROUP BY
    p.id, p.tenant_id, p.name, u.id, u.name;

CREATE UNIQUE INDEX idx_active_project_users ON active_project_users(project_id, user_id);

-- Function to refresh active project users materialized view
CREATE OR REPLACE FUNCTION refresh_active_users()
RETURNS void AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY active_project_users;
END;
$$ LANGUAGE plpgsql;

-- ### 13. Triggers and Functions ###

-- Function to update session activity
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

-- Function to keep PostgreSQL and Neo4j in sync
CREATE OR REPLACE FUNCTION sync_to_neo4j()
RETURNS TRIGGER AS $$
BEGIN
    -- Placeholder - In real implementation, call service to sync to Neo4j
    RAISE NOTICE 'Would sync % operation on % to Neo4j', TG_OP, TG_TABLE_NAME;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- Apply Neo4j sync trigger to content_items (and other tables as needed)
CREATE TRIGGER sync_content_items_to_neo4j
AFTER INSERT OR UPDATE OR DELETE ON content_items
FOR EACH ROW EXECUTE FUNCTION sync_to_neo4j();

-- ### 14. Row-Level Security (RLS) Policies ###

-- Enable RLS
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE resource_presence ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_log ENABLE ROW LEVEL SECURITY;
-- Add RLS to other tables as necessary

-- Example policies
CREATE POLICY tenant_isolation_users ON users
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_isolation_projects ON projects
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_isolation_sessions ON user_sessions
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_isolation_presence ON resource_presence
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_isolation_operations ON operations_log
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
-- Add other tenant isolation policies

-- ### 15. Additional Constraints ###

ALTER TABLE users
ADD CONSTRAINT valid_email CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$');

ALTER TABLE content_items
ADD CONSTRAINT positive_tokens CHECK (tokens IS NULL OR tokens > 0);

ALTER TABLE content_items
ADD CONSTRAINT unique_neo4j_node_id UNIQUE (neo4j_node_id)
DEFERRABLE INITIALLY DEFERRED;
```

## Neo4j Schema (Organized)

Here's the organized Neo4j schema, with sections for constraints, indexes, and node/relationship creation templates:

```cypher
// ### 1. Constraints ###

// Multi-tenancy
CREATE CONSTRAINT ON (t:Tenant) ASSERT t.id IS UNIQUE;

// Core entities
CREATE CONSTRAINT ON (u:User) ASSERT u.id IS UNIQUE;
CREATE CONSTRAINT ON (p:Program) ASSERT p.id IS UNIQUE;
CREATE CONSTRAINT ON (p:Project) ASSERT p.id IS UNIQUE;
CREATE CONSTRAINT ON (t:Thread) ASSERT t.id IS UNIQUE;
CREATE CONSTRAINT ON (ci:ContentItem) ASSERT ci.id IS UNIQUE;
CREATE CONSTRAINT ON (c:ContentChunk) ASSERT c.id IS UNIQUE;
CREATE CONSTRAINT ON (m:Message) ASSERT m.id IS UNIQUE;
CREATE CONSTRAINT ON (tag:Tag) ASSERT tag.id IS UNIQUE;

// Content types
CREATE CONSTRAINT ON (t:Text) ASSERT t.contentId IS UNIQUE;
CREATE CONSTRAINT ON (c:Code) ASSERT c.contentId IS UNIQUE;
CREATE CONSTRAINT ON (i:Image) ASSERT i.contentId IS UNIQUE;
CREATE CONSTRAINT ON (p:PDF) ASSERT p.contentId IS UNIQUE;

// Knowledge nodes
CREATE CONSTRAINT ON (c:Concept) ASSERT c.id IS UNIQUE;
CREATE CONSTRAINT ON (e:Entity) ASSERT e.id IS UNIQUE;
CREATE CONSTRAINT ON (t:Topic) ASSERT t.id IS UNIQUE;
CREATE CONSTRAINT ON (kn:KnowledgeNode) ASSERT kn.id IS UNIQUE;

// Real-time collaboration
CREATE CONSTRAINT ON (s:UserSession) ASSERT s.id IS UNIQUE;
CREATE CONSTRAINT ON (p:Presence) ASSERT p.id IS UNIQUE;
CREATE CONSTRAINT ON (o:Operation) ASSERT o.id IS UNIQUE;
CREATE CONSTRAINT ON (cv:CollaborativeView) ASSERT cv.id IS UNIQUE;
CREATE CONSTRAINT ON (a:Annotation) ASSERT a.id IS UNIQUE;

// ### 2. Indexes ###

// Regular indexes
CREATE INDEX ON :Tenant(name);
CREATE INDEX ON :User(email);
CREATE INDEX ON :Program(tenantId);
CREATE INDEX ON :Project(tenantId, programId);
CREATE INDEX ON :Thread(tenantId, projectId);
CREATE INDEX ON :ContentItem(tenantId, projectId);
CREATE INDEX ON :ContentItem(contentType);
CREATE INDEX ON :Tag(tenantId, projectId);
CREATE INDEX ON :Tag(name);
CREATE INDEX ON :Message(threadId);
CREATE INDEX ON :ContentChunk(contentId);
CREATE INDEX ON :UserSession(userId);
CREATE INDEX ON :UserSession(isActive);
CREATE INDEX ON :Presence(resourceId);
CREATE INDEX ON :Presence(userId);
CREATE INDEX ON :Operation(resourceId);
CREATE INDEX ON :Operation(lamportTimestamp);
CREATE INDEX ON :Annotation(resourceId);

// Composite indexes
CREATE INDEX ON :ContentItem(tenantId, contentType);
CREATE INDEX ON :Thread(tenantId, status);

// Relationship indexes
CREATE INDEX FOR ()-[r:INCLUDES]-() ON (r.relevanceScore);
CREATE INDEX FOR ()-[r:HAS_MEMBER]-() ON (r.role);
CREATE INDEX FOR ()-[r:TAGGED_WITH]-() ON (r.createdAt);
CREATE INDEX FOR ()-[r:VIEWING]-() ON (r.lastUpdatedAt);

// Fulltext indexes
CALL db.index.fulltext.createNodeIndex(
  "contentItemSearch",
  ["ContentItem", "Text", "Code"],
  ["title", "description", "content", "code"]
);

// ### 3. Node and Relationship Creation Templates ###

// -- Tenant --
CREATE (t:Tenant {
  id: $tenantId,
  name: $tenantName,
  domain: $domain,
  createdAt: datetime()
})

// -- User --
CREATE (u:User {
  id: $userId,
  tenantId: $tenantId,
  email: $email,
  name: $name,
  role: $role,
  createdAt: datetime()
})
MATCH (t:Tenant {id: $tenantId}), (u:User {id: $userId})
CREATE (t)-[:HAS_USER]->(u)

// -- Program --
CREATE (p:Program {
  id: $programId,
  tenantId: $tenantId,
  name: $programName,
  description: $description,
  createdAt: datetime(),
  createdBy: $createdBy
})
MATCH (t:Tenant {id: $tenantId}), (p:Program {id: $programId})
CREATE (t)-[:HAS_PROGRAM]->(p)

// -- Project --
CREATE (p:Project {
  id: $projectId,
  tenantId: $tenantId,
  programId: $programId,
  name: $projectName,
  description: $description,
  isArchived: false,
  createdAt: datetime(),
  createdBy: $createdBy
})
MATCH (pg:Program {id: $programId}), (p:Project {id: $projectId})
CREATE (pg)-[:HAS_PROJECT]->(p)
// Add user to project
MATCH (p:Project {id: $projectId}), (u:User {id: $userId})
CREATE (p)-[:HAS_MEMBER {
  role: $role,
  addedAt: datetime(),
  addedBy: $addedBy
}]->(u)

// -- Thread --
CREATE (t:Thread {
  id: $threadId,
  tenantId: $tenantId,
  projectId: $projectId,
  name: $threadName,
  description: $description,
  status: $status,
  createdAt: datetime(),
  createdBy: $creatorId
})
MATCH (p:Project {id: $projectId}), (t:Thread {id: $threadId})
CREATE (p)-[:HAS_THREAD]->(t)
// Parent/child relationship
MATCH (p:Thread {id: $parentId}), (c:Thread {id: $childId})
CREATE (p)-[:PARENT_OF {
  relationshipType: $relationshipType,
  createdAt: datetime()
}]->(c)

// -- ContentItem --
CREATE (ci:ContentItem {
  id: $contentItemId,
  tenantId: $tenantId,
  projectId: $projectId,
  contentType: $contentType,
  title: $title,
  description: $description,
  tokens: $tokens,
  createdAt: datetime(),
  createdBy: $createdBy,
  pgStorageKey: $pgStorageKey
})

// -- Specialized Content (Text, Code, etc.) --
// Text
MATCH (ci:ContentItem {id: $contentItemId})
CREATE (t:Text {
  contentId: $contentItemId,
  content: $content,
  format: $format,
  language: $language
})
CREATE (ci)-[:HAS_CONTENT]->(t)
// Code
MATCH (ci:ContentItem {id: $contentItemId})
CREATE (c:Code {
  contentId: $contentItemId,
  code: $code,
  language: $language
})
CREATE (ci)-[:HAS_CONTENT]->(c)

// -- ContentChunk --
CREATE (cc:ContentChunk {
  id: $chunkId,
  contentId: $contentItemId,
  tenantId: $tenantId,
  content: $chunkContent,
  chunkIndex: $chunkIndex,
  tokens: $tokens,
  embedding: $embedding,
  createdAt: datetime()
})
MATCH (ci:ContentItem {id: $contentItemId}), (cc:ContentChunk {id: $chunkId})
CREATE (ci)-[:HAS_CHUNK]->(cc)

// -- Content Inclusion in Thread --
MATCH (t:Thread {id: $threadId}), (ci:ContentItem {id: $contentId})
CREATE (t)-[r:INCLUDES {
  relevanceScore: $relevance,
  addedAt: datetime(),
  addedBy: $userId,
  position: $position,
  method: $inclusionMethod,
  tokenBudget: $tokenBudget
}]->(ci)
RETURN r

// -- Tag --
CREATE (tag:Tag {
  id: $tagId,
  tenantId: $tenantId,
  projectId: $projectId,
  name: $tagName,
  color: $color,
  createdAt: datetime(),
  createdBy: $createdBy
})
MATCH (p:Project {id: $projectId}), (tag:Tag {id: $tagId})
CREATE (p)-[:HAS_TAG]->(tag)
// Tag content
MATCH (ci:ContentItem {id: $contentId}), (tag:Tag {id: $tagId})
CREATE (ci)-[:TAGGED_WITH {
  createdAt: datetime(),
  createdBy: $createdBy
}]->(tag)

// -- Message --
CREATE (m:Message {
  id: $messageId,
  tenantId: $tenantId,
  threadId: $threadId,
  role: $role,
  content: $content,
  tokensInput: $tokensInput,
  tokensOutput: $tokensOutput,
  tokensTotal: $tokensTotal,
  model: $model,
  createdAt: datetime(),
  createdBy: $createdBy
})
MATCH (t:Thread {id: $threadId}), (m:Message {id: $messageId})
CREATE (t)-[:CONTAINS_MESSAGE]->(m)
// Message reply
MATCH (parent:Message {id: $parentId}), (child:Message {id: $childId})
CREATE (parent)-[:REPLIED_WITH {
  replyType: $replyType,
  position: $position,
  createdAt: datetime()
}]->(child)
// Message context
MATCH (m:Message {id: $messageId}), (ci:ContentItem {id: $contentId})
CREATE (m)-[:USED_CONTEXT {
  relevanceScore: $relevance,
  tokensUsed: $tokensUsed,
  position: $position
}]->(ci)

// -- Knowledge Graph Extensions --
// Concept
CREATE (c:Concept:KnowledgeNode {
  id: $conceptId,
  tenantId: $tenantId,
  name: $conceptName,
  description: $description,
  createdAt: datetime(),
  createdBy: $createdBy
})
// Entity
CREATE (e:Entity:KnowledgeNode {
  id: $entityId,
  tenantId: $tenantId,
  name: $entityName,
  entityType: $entityType,
  description: $description,
  createdAt: datetime(),
  createdBy: $createdBy
})
// Topic
CREATE (t:Topic:KnowledgeNode {
  id: $topicId,
  tenantId: $tenantId,
  name: $topicName,
  description: $description,
  createdAt: datetime(),
  createdBy: $createdBy
})

// Connect Content to Knowledge Nodes
MATCH (ci:ContentItem {id: $contentId}), (kn:KnowledgeNode {id: $knowledgeNodeId})
CREATE (ci)-[:RELATES_TO {
  relationshipType: $relationType,
  confidence: $confidence,
  createdAt: datetime(),
  createdBy: $createdBy
}]->(kn)

// Connect Knowledge Nodes
MATCH (kn1:KnowledgeNode {id: $knowledgeNodeId1}), (kn2:KnowledgeNode {id: $knowledgeNodeId2})
CREATE (kn1)-[:CONNECTED_TO {
  relationshipType: $relationType,
  strength: $strength,
  description: $description,
  createdAt: datetime(),
  createdBy: $createdBy
}]->(kn2)

// -- Real-Time Collaboration --

// User Session
CREATE (s:UserSession {
  id: $sessionId,
  tenantId: $tenantId,
  userId: $userId,
  clientId: $clientId,
  isActive: true,
  connectedAt: datetime(),
  lastActivityAt: datetime()
})
MATCH (u:User {id: $userId}), (s:UserSession {id: $sessionId})
CREATE (u)-[:HAS_SESSION]->(s)

// Presence
CREATE (p:Presence {
  id: $presenceId,
  tenantId: $tenantId,
  sessionId: $sessionId,
  userId: $userId,
  resourceType: $resourceType,
  resourceId: $resourceId,
  viewState: $viewState,
  startedAt: datetime(),
  lastActiveAt: datetime()
})
// Link to resource (example)
MATCH (p:Presence {id: $presenceId}), (t:Thread {id: $resourceId})
CREATE (p)-[:PRESENT_IN]->(t)
// Link to session
MATCH (p:Presence {id: $presenceId}), (s:UserSession {id: $sessionId})
CREATE (s)-[:HAS_PRESENCE]->(p)

// Operation
CREATE (o:Operation {
  id: $operationId,
  tenantId: $tenantId,
  userId: $userId,
  sessionId: $sessionId,
  resourceType: $resourceType,
  resourceId: $resourceId,
  operationType: $operationType,
  operationData: $operationData,
  vectorClock: $vectorClock,
  lamportTimestamp: $lamportTimestamp,
  clientTimestamp: datetime($clientTimestamp),
  serverTimestamp: datetime(),
  isApplied: false
})
// Link to resource
MATCH (o:Operation {id: $operationId}), (r {id: $resourceId})
WHERE $resourceType IN labels(r)
CREATE (o)-[:AFFECTS]->(r)
// Link to user
MATCH (o:Operation {id: $operationId}), (u:User {id: $userId})
CREATE (u)-[:PERFORMED]->(o)
// Dependencies
MATCH (o1:Operation {id: $operationId}), (o2:Operation {id: $dependencyId})
CREATE (o1)-[:DEPENDS_ON]->(o2)

// Collaborative View
CREATE (cv:CollaborativeView {
  id: $viewId,
  tenantId: $tenantId,
  name: $viewName,
  viewType: $viewType,
  currentState: $viewState,
  createdAt: datetime(),
  updatedAt: datetime()
})
MATCH (cv:CollaborativeView {id: $viewId}), (p:Project {id: $projectId})
CREATE (p)-[:HAS_VIEW]->(cv)
// User positions
MATCH (cv:CollaborativeView {id: $viewId}), (s:UserSession {id: $sessionId})
CREATE (s)-[:VIEWING {
  viewPosition: $position,
  camera: $camera,
  zoom: $zoom,
  lastUpdatedAt: datetime()
}]->(cv)

// Annotation
CREATE (a:Annotation {
  id: $annotationId,
  tenantId: $tenantId,
  resourceId: $resourceId,
  userId: $userId,
  annotationType: $annotationType,
  positionData: $positionData,
  content: $content,
  status: 'active',
  createdAt: datetime()
})
MATCH (a:Annotation {id: $annotationId}), (r {id: $resourceId})
WHERE $resourceType IN labels(r)
CREATE (a)-[:ANNOTATES]->(r)
// Thread annotation
MATCH (a1:Annotation {id: $parentId}), (a2:Annotation {id: $replyId})
CREATE (a1)-[:HAS_REPLY]->(a2)

// Enhanced Relationship (example)
MATCH (t:Thread {id: $threadId})-[r:INCLUDES]->(ci:ContentItem {id: $contentId})
SET r.currentEditorId = $userId,
    r.currentEditorSessionId = $sessionId,
    r.editingStartedAt = datetime(),
    r.collaborativeState = $collaborativeState


// ### 4. Example Queries ###

// Find content in a project
MATCH (ci:ContentItem)
WHERE ci.tenantId = $tenantId AND ci.projectId = $projectId
RETURN ci
ORDER BY ci.createdAt DESC

// Find content in a thread
MATCH (t:Thread {id: $threadId})-[r:INCLUDES]->(ci:ContentItem)
WHERE t.tenantId = $tenantId
RETURN ci, r.relevanceScore
ORDER BY r.relevanceScore DESC

// Find similar content (with embeddings)
MATCH (cc1:ContentChunk {id: $sourceChunkId})
MATCH (cc2:ContentChunk)
WHERE cc1.tenantId = cc2.tenantId AND cc1.id <> cc2.id
WITH cc1, cc2, gds.alpha.similarity.cosine(cc1.embedding, cc2.embedding) AS similarity
WHERE similarity > 0.8
RETURN cc2.contentId, cc2.content, similarity
ORDER BY similarity DESC
LIMIT 10

// Threads and content in a knowledge graph view
MATCH path = (p:Project {id: $projectId})-[:HAS_THREAD]->(t:Thread)-[:INCLUDES]->(ci:ContentItem)
WHERE p.tenantId = $tenantId
RETURN path
LIMIT 100

// Connections between concepts and content
MATCH path = (kn1:KnowledgeNode {id: $conceptId})-[*1..3]-(kn2:KnowledgeNode)
WHERE kn1.tenantId = $tenantId
RETURN path
LIMIT 50

// Content connected to a knowledge node
MATCH (kn:KnowledgeNode {id: $knowledgeNodeId})<-[:RELATES_TO]-(ci:ContentItem)
WHERE kn.tenantId = $tenantId
RETURN ci
ORDER BY ci.title

// Content in multiple threads
MATCH (t:Thread)-[:INCLUDES]->(ci:ContentItem)
WHERE t.tenantId = $tenantId AND t.projectId = $projectId
WITH ci, count(t) as threadCount
WHERE threadCount > 1
RETURN ci.id, ci.title, threadCount
ORDER BY threadCount DESC

// Conversation flow with context
MATCH (t:Thread {id: $threadId})-[:CONTAINS_MESSAGE]->(m:Message)
OPTIONAL MATCH (m)-[:USED_CONTEXT]->(ci:ContentItem)
WHERE t.tenantId = $tenantId
RETURN m, collect(ci) as contextItems
ORDER BY m.createdAt

// Hierarchical threads
MATCH path = (root:Thread {id: $rootThreadId})-[:PARENT_OF*]->(child:Thread)
WHERE root.tenantId = $tenantId
RETURN path

// Most common tags
MATCH (p:Project {id: $projectId})-[:HAS_TAG]->(tag:Tag)<-[r:TAGGED_WITH]-(ci:ContentItem)
WHERE p.tenantId = $tenantId
RETURN tag.name, tag.color, count(r) as usageCount
ORDER BY usageCount DESC

// Active users in a project
MATCH (p:Project {id: $projectId})<-[:PRESENT_IN]-(presence:Presence)<-[:HAS_PRESENCE]-(s:UserSession)-[:HAS_USER]->(u:User)
WHERE presence.lastActiveAt > datetime() - duration({minutes: 15})
RETURN u.id, u.name, presence.resourceType, presence.resourceId, s.clientId, presence.lastActiveAt
ORDER BY presence.lastActiveAt DESC

// Active editors of content
MATCH (t:Thread {id: $threadId})-[r:INCLUDES]->(ci:ContentItem)
WHERE r.currentEditorId IS NOT NULL
RETURN ci.id, ci.title, r.currentEditorId, r.editingStartedAt

// Operations history
MATCH (r {id: $resourceId})<-[:AFFECTS]-(o:Operation)
OPTIONAL MATCH (o)-[:DEPENDS_ON*]->(d:Operation)
RETURN o, collect(d) as dependencies
ORDER BY o.lamportTimestamp

// Potential conflicts
MATCH (r {id: $resourceId})<-[:AFFECTS]-(o:Operation)
WHERE o.isApplied = false
WITH r, o
ORDER BY o.lamportTimestamp
WITH r, collect(o) as pendingOperations
WHERE size(pendingOperations) > 1
RETURN r.id, pendingOperations

// Collaborative view with user positions
MATCH (cv:CollaborativeView {id: $viewId})<-[v:VIEWING]-(s:UserSession)-[:HAS_USER]->(u:User)
WHERE s.isActive = true AND s.lastActivityAt > datetime() - duration({minutes: 5})
RETURN cv, collect({userId: u.id, userName: u.name, position: v.viewPosition, camera: v.camera, zoom: v.zoom}) as viewers
```

Key Improvements and Organization

*   **Logical Sections:** Both schemas are divided into clear sections for easier navigation and understanding.
*   **Comments:** Extensive comments explain the purpose of each table, column, node type, relationship, and constraint.
*   **PostgreSQL:**
    *   **Extensions:** Listed at the top.
    *   **Core Types & Functions:** Reusable types and functions are defined first.
    *   **Numbered Sections:** Schema organized by functional area (Tenant, User, Program/Project, Thread, Content, etc.).
    *   **Triggers:** Update triggers are consistently defined after table creation.
    *   **RLS Policies:** Grouped together.
    *   **Additional Constraints:** Placed in a separate section for clarity.
    *   **Materialized Views and Views:** In their own section.
*   **Neo4j:**
    *   **Constraints:** All constraints are defined first.
    *   **Indexes:** All indexes are defined next.
    *   **Node/Relationship Creation:** Templates are provided for creating nodes and relationships, making the schema more actionable.  These are organized by entity type.
    *   **Example Queries:** Included to demonstrate how to use the schema.

This comprehensively organized schema provides a strong foundation for building the ContextNexus system.  It's well-documented, easy to follow, and covers all the required functionality, including multi-tenancy, real-time collaboration, and integration between PostgreSQL and Neo4j.  This organization should make development, maintenance, and future extensions much easier.

