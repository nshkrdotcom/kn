# Clean Database Schemas for ContextNexus with Real-Time Collaboration

## PostgreSQL Schema

```sql
------------------------------------------
-- CORE MULTI-TENANCY
------------------------------------------

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "hstore";

-- Tenants (organizations) table
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

-- Tenant audit log
CREATE TABLE tenant_audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    action VARCHAR(50) NOT NULL,
    details JSONB NOT NULL,
    performed_by UUID NOT NULL,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Auto-updating timestamp function
CREATE OR REPLACE FUNCTION update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Audit info composite type
CREATE TYPE audit_info AS (
    created_by UUID,
    created_at TIMESTAMPTZ,
    updated_by UUID,
    updated_at TIMESTAMPTZ
);

------------------------------------------
-- USER AND SESSION MANAGEMENT
------------------------------------------

-- Users table
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'user',
    permissions JSONB DEFAULT '{}'::jsonb,
    is_tenant_admin BOOLEAN DEFAULT FALSE,
    settings JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMPTZ,
    UNIQUE (tenant_id, email),
    CONSTRAINT valid_email CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$')
);

CREATE TRIGGER update_user_timestamp
BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION update_timestamp();

-- User activity log
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

-- Real-time session management
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

-- Real-time presence tracking
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

-- Automatic session activity update
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

------------------------------------------
-- PROJECT STRUCTURE
------------------------------------------

-- Programs (top-level containers)
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

-- Projects (belong to programs)
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

-- Project membership
CREATE TABLE project_memberships (
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(50) NOT NULL DEFAULT 'viewer',
    permissions JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (project_id, user_id)
);

-- Threads (renamed from Contexts)
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

-- Thread hierarchy
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

------------------------------------------
-- CONTENT MANAGEMENT
------------------------------------------

-- Storage types
CREATE TABLE storage_types (
    id VARCHAR(50) PRIMARY KEY,
    description TEXT NOT NULL,
    handler_class VARCHAR(255),
    config_schema JSONB,
    is_enabled BOOLEAN DEFAULT TRUE
);

INSERT INTO storage_types (id, description) VALUES 
('postgres', 'Store content directly in PostgreSQL'),
('minio', 'Store content in MinIO object storage'),
('s3', 'Store content in Amazon S3');

-- Content types
CREATE TABLE content_types (
    id VARCHAR(50) PRIMARY KEY,
    description TEXT NOT NULL,
    icon VARCHAR(50),
    handler_class VARCHAR(255),
    allowed_extensions TEXT[],
    max_file_size_mb INTEGER,
    is_enabled BOOLEAN DEFAULT TRUE
);

INSERT INTO content_types (id, description, allowed_extensions) VALUES 
('text', 'Plain text content', ARRAY['.txt', '.md']),
('code', 'Source code', ARRAY['.py', '.js', '.html', '.css', '.java', '.cpp']),
('image', 'Image file', ARRAY['.jpg', '.png', '.gif', '.svg']),
('pdf', 'PDF document', ARRAY['.pdf']);

-- Content items
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
    neo4j_node_id VARCHAR(255),
    UNIQUE (tenant_id, storage_type, storage_key),
    CONSTRAINT positive_tokens CHECK (tokens IS NULL OR tokens > 0)
);

CREATE TRIGGER update_content_items_timestamp
BEFORE UPDATE ON content_items
FOR EACH ROW EXECUTE FUNCTION update_timestamp();

ALTER TABLE content_items ADD COLUMN search_vector tsvector;
CREATE INDEX content_items_search_idx ON content_items USING GIN(search_vector);

-- Text content
CREATE TABLE text_content (
    content_id UUID PRIMARY KEY REFERENCES content_items(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    format VARCHAR(50) DEFAULT 'plain',
    language VARCHAR(50) DEFAULT 'en',
    tokens INTEGER GENERATED ALWAYS AS (
        GREATEST(1, ROUND(length(content)::numeric / 4))
    ) STORED
);

-- Update content search vector
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

-- Code content
CREATE TABLE code_content (
    content_id UUID PRIMARY KEY REFERENCES content_items(id) ON DELETE CASCADE,
    code TEXT NOT NULL,
    language VARCHAR(50) NOT NULL,
    highlighted_html TEXT,
    tokens INTEGER GENERATED ALWAYS AS (
        GREATEST(1, ROUND(length(code)::numeric / 3))
    ) STORED
);

-- Content chunks
CREATE TABLE content_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    content_id UUID NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL,
    content TEXT NOT NULL,
    start_position INTEGER,
    end_position INTEGER,
    tokens INTEGER NOT NULL,
    embedding VECTOR(1536),
    embedding_model VARCHAR(100),
    metadata JSONB DEFAULT '{}'::jsonb,
    neo4j_node_id VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (content_id, chunk_index)
);

-- Tags
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

-- Content tagging
CREATE TABLE content_tags (
    content_id UUID NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
    tag_id UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (content_id, tag_id)
);

------------------------------------------
-- COLLABORATION & REAL-TIME FEATURES
------------------------------------------

-- Operations log for CRDT
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

-- Content versions with CRDT support
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
    vector_clock JSONB,
    lamport_timestamp BIGINT,
    merge_base_version UUID REFERENCES content_versions(id),
    conflict_resolution_strategy VARCHAR(50),
    operation_ids UUID[],
    audit audit_info,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (content_id, version_number)
);

-- Document snapshots for fast loading
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

-- Resource locks for collaborative editing
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

-- Event broadcasting
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

-- Collaboration workspaces
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

-- Collaborative cursors and selections
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

-- Collaboration conflict resolution
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

-- Real-time comments and annotations
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

------------------------------------------
-- THREAD CONTENT & MESSAGING
------------------------------------------

-- Thread content (context items)
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
    -- Collaborative fields
    current_editor_id UUID REFERENCES users(id),
    current_editor_session_id UUID REFERENCES user_sessions(id),
    editing_started_at TIMESTAMPTZ,
    collaborative_state JSONB DEFAULT '{}'::jsonb,
    -- Standard fields
    audit audit_info,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    neo4j_relationship_id VARCHAR(255),
    PRIMARY KEY (thread_id, content_id)
);

CREATE TRIGGER update_thread_content_timestamp
BEFORE UPDATE ON thread_content
FOR EACH ROW EXECUTE FUNCTION update_timestamp();

-- LLM models
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

-- Prompt templates
CREATE TABLE prompt_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
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

-- Messages
CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    thread_id UUID NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id),
    role VARCHAR(50) NOT NULL,
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
    neo4j_node_id VARCHAR(255)
);

-- Message relationships
CREATE TABLE message_relationships (
    parent_message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    child_message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    relationship_type VARCHAR(50) DEFAULT 'response',
    position INTEGER,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (parent_message_id, child_message_id),
    CONSTRAINT no_self_reference CHECK (parent_message_id != child_message_id)
);

-- Message context items
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

------------------------------------------
-- ANALYTICS & REPORTING
------------------------------------------

-- Usage statistics
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

-- Create materialized view of active users
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

-- Function to refresh active users
CREATE OR REPLACE FUNCTION refresh_active_users()
RETURNS void AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY active_project_users;
END;
$$ LANGUAGE plpgsql;

-- Token usage summary
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

-- Add refresh function for the materialized view
CREATE OR REPLACE FUNCTION refresh_token_usage_summary()
RETURNS void AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY token_usage_summary;
END;
$$ LANGUAGE plpgsql;

------------------------------------------
-- KNOWLEDGE GRAPH INTEGRATION
------------------------------------------

-- NEO4J INTEGRATION
ALTER TABLE content_items
ADD CONSTRAINT unique_neo4j_node_id UNIQUE (neo4j_node_id) 
DEFERRABLE INITIALLY DEFERRED;

-- Create function to sync data to Neo4j
CREATE OR REPLACE FUNCTION sync_to_neo4j()
RETURNS TRIGGER AS $$
BEGIN
    -- Logic to call Neo4j sync service would go here
    RAISE NOTICE 'Would sync % operation on % to Neo4j', TG_OP, TG_TABLE_NAME;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply Neo4j sync triggers
CREATE TRIGGER sync_content_items_to_neo4j
AFTER INSERT OR UPDATE OR DELETE ON content_items
FOR EACH ROW EXECUTE FUNCTION sync_to_neo4j();

CREATE TRIGGER sync_threads_to_neo4j
AFTER INSERT OR UPDATE OR DELETE ON threads
FOR EACH ROW EXECUTE FUNCTION sync_to_neo4j();

CREATE TRIGGER sync_thread_content_to_neo4j
AFTER INSERT OR UPDATE OR DELETE ON thread_content
FOR EACH ROW EXECUTE FUNCTION sync_to_neo4j();

------------------------------------------
-- ROW-LEVEL SECURITY
------------------------------------------

-- Enable RLS on tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE thread_content ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE resource_presence ENABLE ROW LEVEL SECURITY;

-- Create tenant isolation policies
CREATE POLICY tenant_isolation_users ON users
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_isolation_programs ON programs
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_isolation_projects ON projects
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_isolation_threads ON threads
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_isolation_content_items ON content_items
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- Multi-tenant function
CREATE OR REPLACE FUNCTION set_tenant_context(p_tenant_id uuid)
RETURNS void AS $$
BEGIN
    PERFORM set_config('app.current_tenant_id', p_tenant_id::text, false);
END;
$$ LANGUAGE plpgsql;
```

## Neo4j Schema

```cypher
//==========================================
// CONSTRAINTS AND INDEXES
//==========================================

// MULTI-TENANCY
CREATE CONSTRAINT ON (t:Tenant) ASSERT t.id IS UNIQUE;
CREATE INDEX ON :Tenant(name);

// CORE ENTITY CONSTRAINTS
CREATE CONSTRAINT ON (u:User) ASSERT u.id IS UNIQUE;
CREATE CONSTRAINT ON (p:Program) ASSERT p.id IS UNIQUE;
CREATE CONSTRAINT ON (p:Project) ASSERT p.id IS UNIQUE;
CREATE CONSTRAINT ON (t:Thread) ASSERT t.id IS UNIQUE;
CREATE CONSTRAINT ON (ci:ContentItem) ASSERT ci.id IS UNIQUE;
CREATE CONSTRAINT ON (cc:ContentChunk) ASSERT cc.id IS UNIQUE;
CREATE CONSTRAINT ON (m:Message) ASSERT m.id IS UNIQUE;
CREATE CONSTRAINT ON (tag:Tag) ASSERT tag.id IS UNIQUE;

// CONTENT TYPE CONSTRAINTS
CREATE CONSTRAINT ON (t:Text) ASSERT t.contentId IS UNIQUE;
CREATE CONSTRAINT ON (c:Code) ASSERT c.contentId IS UNIQUE;
CREATE CONSTRAINT ON (i:Image) ASSERT i.contentId IS UNIQUE;
CREATE CONSTRAINT ON (p:PDF) ASSERT p.contentId IS UNIQUE;

// SESSION AND PRESENCE CONSTRAINTS
CREATE CONSTRAINT ON (s:UserSession) ASSERT s.id IS UNIQUE;
CREATE CONSTRAINT ON (p:Presence) ASSERT p.id IS UNIQUE;

// OPERATION CONSTRAINTS
CREATE CONSTRAINT ON (o:Operation) ASSERT o.id IS UNIQUE;

// VISUALIZATION CONSTRAINTS
CREATE CONSTRAINT ON (cv:CollaborativeView) ASSERT cv.id IS UNIQUE;

// ANNOTATION CONSTRAINTS
CREATE CONSTRAINT ON (a:Annotation) ASSERT a.id IS UNIQUE;

// KNOWLEDGE GRAPH CONSTRAINTS
CREATE CONSTRAINT ON (c:Concept) ASSERT c.id IS UNIQUE;
CREATE CONSTRAINT ON (e:Entity) ASSERT e.id IS UNIQUE;
CREATE CONSTRAINT ON (t:Topic) ASSERT t.id IS UNIQUE;
CREATE CONSTRAINT ON (kn:KnowledgeNode) ASSERT kn.id IS UNIQUE;

// PERFORMANCE INDEXES
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

// COMPOSITE INDEXES
CREATE INDEX ON :ContentItem(tenantId, contentType);
CREATE INDEX ON :Thread(tenantId, status);

// RELATIONSHIP INDEXES
CREATE INDEX FOR ()-[r:INCLUDES]-() ON (r.relevanceScore);
CREATE INDEX FOR ()-[r:HAS_MEMBER]-() ON (r.role);
CREATE INDEX FOR ()-[r:TAGGED_WITH]-() ON (r.createdAt);
CREATE INDEX FOR ()-[r:VIEWING]-() ON (r.lastUpdatedAt);

// FULLTEXT SEARCH
CALL db.index.fulltext.createNodeIndex(
  "contentItemSearch",
  ["ContentItem", "Text", "Code"],
  ["title", "description", "content", "code"]
);

//==========================================
// NODE CREATION PATTERNS
//==========================================

//------------------------------------------
// CORE ENTITIES
//------------------------------------------

// Create Tenant
// CALL {
CREATE (t:Tenant {
  id: $tenantId,
  name: $tenantName,
  domain: $domain,
  slug: $slug,
  features: $features,
  theme: $theme,
  settings: $settings,
  createdAt: datetime()
})
// }

// Create User with tenant association
// CALL {
CREATE (u:User {
  id: $userId,
  tenantId: $tenantId,
  email: $email,
  name: $name,
  role: $role,
  permissions: $permissions,
  isTenantAdmin: $isTenantAdmin,
  createdAt: datetime()
})

MATCH (t:Tenant {id: $tenantId}), (u:User {id: $userId})
CREATE (t)-[:HAS_USER]->(u)
// }

// Create Program
// CALL {
CREATE (p:Program {
  id: $programId,
  tenantId: $tenantId,
  name: $programName,
  description: $description,
  slug: $slug,
  isPublic: $isPublic,
  settings: $settings,
  metadata: $metadata,
  createdAt: datetime(),
  createdBy: $createdBy
})

MATCH (t:Tenant {id: $tenantId}), (p:Program {id: $programId})
CREATE (t)-[:HAS_PROGRAM]->(p)
// }

// Create Project
// CALL {
CREATE (p:Project {
  id: $projectId,
  tenantId: $tenantId,
  programId: $programId,
  name: $projectName,
  description: $description,
  slug: $slug,
  isArchived: $isArchived,
  isPublic: $isPublic,
  settings: $settings,
  metadata: $metadata,
  createdAt: datetime(),
  createdBy: $createdBy
})

MATCH (pg:Program {id: $programId}), (p:Project {id: $projectId})
CREATE (pg)-[:HAS_PROJECT]->(p)
// }

// Add user to project with role
// CALL {
MATCH (p:Project {id: $projectId}), (u:User {id: $userId})
CREATE (p)-[:HAS_MEMBER {
  role: $role,
  permissions: $permissions,
  addedAt: datetime(),
  addedBy: $addedBy
}]->(u)
// }

// Create Thread
// CALL {
CREATE (t:Thread {
  id: $threadId,
  tenantId: $tenantId,
  projectId: $projectId,
  name: $threadName,
  description: $description,
  slug: $slug,
  status: $status,
  threadType: $threadType,
  isPinned: $isPinned,
  settings: $settings,
  metadata: $metadata,
  createdAt: datetime(),
  createdBy: $creatorId
})

MATCH (p:Project {id: $projectId}), (t:Thread {id: $threadId})
CREATE (p)-[:HAS_THREAD]->(t)
// }

// Create parent/child relationship between threads
// CALL {
MATCH (p:Thread {id: $parentId}), (c:Thread {id: $childId})
CREATE (p)-[:PARENT_OF {
  relationshipType: $relationshipType,
  position: $position,
  metadata: $metadata,
  createdAt: datetime()
}]->(c)
// }

//------------------------------------------
// CONTENT MANAGEMENT
//------------------------------------------

// Create ContentItem (base node)
// CALL {
CREATE (ci:ContentItem {
  id: $contentItemId,
  tenantId: $tenantId,
  projectId: $projectId,
  contentType: $contentType,
  title: $title,
  description: $description,
  tokens: $tokens,
  version: $version,
  isActive: $isActive,
  isPinned: $isPinned,
  createdAt: datetime(),
  createdBy: $createdBy,
  pgStorageKey: $pgStorageKey  // Reference to PostgreSQL storage
})

MATCH (p:Project {id: $projectId})
CREATE (p)-[:HAS_CONTENT]->(ci)
// }

// Create Text content (specialized content)
// CALL {
MATCH (ci:ContentItem {id: $contentItemId})
CREATE (t:Text {
  contentId: $contentItemId,
  content: $content,
  format: $format,
  language: $language
})
CREATE (ci)-[:HAS_CONTENT]->(t)
// }

// Create Code content (specialized content)
// CALL {
MATCH (ci:ContentItem {id: $contentItemId})
CREATE (c:Code {
  contentId: $contentItemId,
  code: $code,
  language: $language
})
CREATE (ci)-[:HAS_CONTENT]->(c)
// }

// Create ContentChunk
// CALL {
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
// }

// Link ContentItem to Thread with relevance
// CALL {
MATCH (t:Thread {id: $threadId}), (ci:ContentItem {id: $contentId})
CREATE (t)-[r:INCLUDES {
  relevanceScore: $relevance,
  position: $position,
  isPinned: $isPinned,
  method: $inclusionMethod,
  tokenBudget: $tokenBudget,
  currentEditorId: $currentEditorId,
  currentEditorSessionId: $currentEditorSessionId,
  editingStartedAt: datetime($editingStartedAt),
  collaborativeState: $collaborativeState,
  addedAt: datetime(),
  addedBy: $userId
}]->(ci)
// }

// Create Tag
// CALL {
CREATE (tag:Tag {
  id: $tagId,
  tenantId: $tenantId,
  projectId: $projectId,
  name: $tagName,
  description: $description,
  color: $color,
  icon: $icon,
  isSystem: $isSystem,
  createdAt: datetime(),
  createdBy: $createdBy
})

MATCH (p:Project {id: $projectId}), (tag:Tag {id: $tagId})
CREATE (p)-[:HAS_TAG]->(tag)
// }

// Tag Content
// CALL {
MATCH (ci:ContentItem {id: $contentId}), (tag:Tag {id: $tagId})
CREATE (ci)-[:TAGGED_WITH {
  createdAt: datetime(),
  createdBy: $createdBy
}]->(tag)
// }

//------------------------------------------
// MESSAGING
//------------------------------------------

// Create a Message
// CALL {
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
  contextSnapshot: $contextSnapshot,
  metadata: $metadata,
  createdAt: datetime(),
  createdBy: $createdBy
})

MATCH (t:Thread {id: $threadId}), (m:Message {id: $messageId})
CREATE (t)-[:CONTAINS_MESSAGE]->(m)
// }

// Create parent/child Message relationship
// CALL {
MATCH (parent:Message {id: $parentId}), (child:Message {id: $childId})
CREATE (parent)-[:REPLIED_WITH {
  replyType: $replyType,
  position: $position,
  createdAt: datetime()
}]->(child)
// }

// Connect Message to ContentItems used in context
// CALL {
MATCH (m:Message {id: $messageId}), (ci:ContentItem {id: $contentId})
CREATE (m)-[:USED_CONTEXT {
  relevanceScore: $relevance,
  tokensUsed: $tokensUsed,
  position: $position,
  chunkIds: $chunkIds
}]->(ci)
// }

//------------------------------------------
// REAL-TIME COLLABORATION
//------------------------------------------

// Create a session node
// CALL {
CREATE (s:UserSession {
  id: $sessionId,
  tenantId: $tenantId,
  userId: $userId,
  clientId: $clientId,
  deviceInfo: $deviceInfo,
  ipAddress: $ipAddress,
  isActive: true,
  connectedAt: datetime(),
  lastActivityAt: datetime()
})

MATCH (u:User {id: $userId}), (s:UserSession {id: $sessionId})
CREATE (u)-[:HAS_SESSION]->(s)
// }

// Create a presence node
// CALL {
CREATE (p:Presence {
  id: $presenceId,
  tenantId: $tenantId,
  sessionId: $sessionId,
  userId: $userId,
  resourceType: $resourceType,
  resourceId: $resourceId,
  viewState: $viewState,
  cursorPosition: $cursorPosition,
  startedAt: datetime(),
  lastActiveAt: datetime()
})

// Link presence to resource (dynamic match based on resource type)
MATCH (p:Presence {id: $presenceId}), (r {id: $resourceId})
WHERE $resourceType IN labels(r)
CREATE (p)-[:PRESENT_IN]->(r)

// Link presence to user session
MATCH (p:Presence {id: $presenceId}), (s:UserSession {id: $sessionId})
CREATE (s)-[:HAS_PRESENCE]->(p)
// }

// Create an operation node
// CALL {
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
  isApplied: false,
  metadata: $metadata
})

// Link operation to resource
MATCH (o:Operation {id: $operationId}), (r {id: $resourceId})
WHERE $resourceType IN labels(r)
CREATE (o)-[:AFFECTS]->(r)

// Link operation to user
MATCH (o:Operation {id: $operationId}), (u:User {id: $userId})
CREATE (u)-[:PERFORMED]->(o)
// }

// Operation dependencies (causal relationships)
// CALL {
MATCH (o1:Operation {id: $operationId}), (o2:Operation {id: $dependencyId})
CREATE (o1)-[:DEPENDS_ON]->(o2)
// }

// Create a collaborative view
// CALL {
CREATE (cv:CollaborativeView {
  id: $viewId,
  tenantId: $tenantId,
  projectId: $projectId,
  name: $viewName,
  description: $description,
  viewType: $viewType,
  currentState: $viewState,
  activeUsers: $activeUsers,
  settings: $settings,
  createdAt: datetime(),
  updatedAt: datetime()
})

// Link view to project
MATCH (cv:CollaborativeView {id: $viewId}), (p:Project {id: $projectId})
CREATE (p)-[:HAS_VIEW]->(cv)
// }

// User view positions in collaborative visualization
// CALL {
MATCH (cv:CollaborativeView {id: $viewId}), (s:UserSession {id: $sessionId})
CREATE (s)-[:VIEWING {
  viewPosition: $position,
  camera: $camera,
  zoom: $zoom,
  lastUpdatedAt: datetime()
}]->(cv)
// }

// Create real-time annotation node
// CALL {
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

// Link annotation to resource
MATCH (a:Annotation {id: $annotationId}), (r {id: $resourceId})
WHERE $resourceType IN labels(r)
CREATE (a)-[:ANNOTATES]->(r)
// }

// Thread annotation relationship
// CALL {
MATCH (a1:Annotation {id: $parentId}), (a2:Annotation {id: $replyId})
CREATE (a1)-[:HAS_REPLY]->(a2)
// }

//------------------------------------------
// KNOWLEDGE GRAPH
//------------------------------------------

// Create a Concept node (for abstract ideas)
// CALL {
CREATE (c:Concept:KnowledgeNode {
  id: $conceptId,
  tenantId: $tenantId,
  name: $conceptName,
  description: $description,
  metadata: $metadata,
  createdAt: datetime(),
  createdBy: $createdBy
})
// }

// Create an Entity node (for named entities)
// CALL {
CREATE (e:Entity:KnowledgeNode {
  id: $entityId,
  tenantId: $tenantId,
  name: $entityName,
  entityType: $entityType,
  description: $description,
  metadata: $metadata,
  createdAt: datetime(),
  createdBy: $createdBy
})
// }

// Create Topic node (for subject areas)
// CALL {
CREATE (t:Topic:KnowledgeNode {
  id: $topicId,
  tenantId: $tenantId,
  name: $topicName,
  description: $description,
  metadata: $metadata,
  createdAt: datetime(),
  createdBy: $createdBy
})
// }

// Connect Content to Knowledge Nodes
// CALL {
MATCH (ci:ContentItem {id: $contentId}), (kn:KnowledgeNode {id: $knowledgeNodeId})
CREATE (ci)-[:RELATES_TO {
  relationshipType: $relationType,
  confidence: $confidence,
  createdAt: datetime(),
  createdBy: $createdBy
}]->(kn)
// }

// Connect Knowledge Nodes to each other
// CALL {
MATCH (kn1:KnowledgeNode {id: $knowledgeNodeId1}), (kn2:KnowledgeNode {id: $knowledgeNodeId2})
CREATE (kn1)-[:CONNECTED_TO {
  relationshipType: $relationType,
  strength: $strength,
  description: $description,
  createdAt: datetime(),
  createdBy: $createdBy
}]->(kn2)
// }

//==========================================
// QUERY PATTERNS
//==========================================

//------------------------------------------
// MULTI-TENANT QUERIES
//------------------------------------------

// Find all content in a project with tenant isolation
// CALL {
MATCH (ci:ContentItem)
WHERE ci.tenantId = $tenantId AND ci.projectId = $projectId
RETURN ci
ORDER BY ci.createdAt DESC
// }

//------------------------------------------
// COLLABORATION QUERIES
//------------------------------------------

// Find all active users in a project with their current activities
// CALL {
MATCH (p:Project {id: $projectId})<-[:PRESENT_IN]-(presence:Presence)<-[:HAS_PRESENCE]-(s:UserSession)-[:HAS_USER]->(u:User)
WHERE presence.lastActiveAt > datetime() - duration({minutes: 15})
  AND s.tenantId = $tenantId
RETURN u.id, u.name, presence.resourceType, presence.resourceId, s.clientId, presence.lastActiveAt, presence.viewState
ORDER BY presence.lastActiveAt DESC
// }

// Find all active editors of content items in a thread
// CALL {
MATCH (t:Thread {id: $threadId})-[r:INCLUDES]->(ci:ContentItem)
WHERE r.currentEditorId IS NOT NULL
  AND t.tenantId = $tenantId
RETURN ci.id, ci.title, r.currentEditorId, r.editingStartedAt
// }

// Get operations history for a resource with causal dependencies
// CALL {
MATCH (r {id: $resourceId})<-[:AFFECTS]-(o:Operation)
WHERE o.tenantId = $tenantId
OPTIONAL MATCH (o)-[:DEPENDS_ON*]->(d:Operation)
RETURN o, collect(d) as dependencies
ORDER BY o.lamportTimestamp
// }

// Find potential operation conflicts
// CALL {
MATCH (r {id: $resourceId})<-[:AFFECTS]-(o:Operation)
WHERE o.isApplied = false AND o.tenantId = $tenantId
WITH r, o
ORDER BY o.lamportTimestamp
WITH r, collect(o) as pendingOperations
WHERE size(pendingOperations) > 1
RETURN r.id, pendingOperations
// }

// Get a collaborative view with all user positions
// CALL {
MATCH (cv:CollaborativeView {id: $viewId})<-[v:VIEWING]-(s:UserSession)-[:HAS_USER]->(u:User)
WHERE s.isActive = true 
  AND s.lastActivityAt > datetime() - duration({minutes: 5})
  AND cv.tenantId = $tenantId
RETURN cv, collect({userId: u.id, userName: u.name, position: v.viewPosition, camera: v.camera, zoom: v.zoom}) as viewers
// }

//------------------------------------------
// CONTENT AND CONTEXT QUERIES
//------------------------------------------

// Find content within a thread, ordered by relevance
// CALL {
MATCH (t:Thread {id: $threadId})-[r:INCLUDES]->(ci:ContentItem)
WHERE t.tenantId = $tenantId
RETURN ci, r.relevanceScore, r.collaborativeState
ORDER BY r.relevanceScore DESC
// }

// Find similar content using vector similarity
// CALL {
MATCH (cc1:ContentChunk {id: $sourceChunkId})
MATCH (cc2:ContentChunk)
WHERE cc1.tenantId = cc2.tenantId AND cc1.id <> cc2.id
WITH cc1, cc2, gds.alpha.similarity.cosine(cc1.embedding, cc2.embedding) AS similarity
WHERE similarity > 0.8
RETURN cc2.contentId, cc2.content, similarity
ORDER BY similarity DESC
LIMIT 10
// }

// Find all threads and their content in a knowledge graph view
// CALL {
MATCH path = (p:Project {id: $projectId})-[:HAS_THREAD]->(t:Thread)-[:INCLUDES]->(ci:ContentItem)
WHERE p.tenantId = $tenantId
RETURN path
LIMIT 100
// }

//------------------------------------------
// KNOWLEDGE GRAPH QUERIES
//------------------------------------------

// Find connections between concepts and content
// CALL {
MATCH path = (kn1:KnowledgeNode {id: $conceptId})-[*1..3]-(kn2:KnowledgeNode)
WHERE kn1.tenantId = $tenantId
RETURN path
LIMIT 50
// }

// Find all content connected to a specific knowledge node
// CALL {
MATCH (kn:KnowledgeNode {id: $knowledgeNodeId})<-[:RELATES_TO]-(ci:ContentItem)
WHERE kn.tenantId = $tenantId
RETURN ci
ORDER BY ci.title
// }

//------------------------------------------
// ANALYTICS QUERIES
//------------------------------------------

// Find content that appears in multiple threads
// CALL {
MATCH (t:Thread)-[:INCLUDES]->(ci:ContentItem)
WHERE t.tenantId = $tenantId AND t.projectId = $projectId
WITH ci, count(t) as threadCount
WHERE threadCount > 1
RETURN ci.id, ci.title, threadCount
ORDER BY threadCount DESC
// }

// Get conversation flow with context
// CALL {
MATCH (t:Thread {id: $threadId})-[:CONTAINS_MESSAGE]->(m:Message)
OPTIONAL MATCH (m)-[:USED_CONTEXT]->(ci:ContentItem)
WHERE t.tenantId = $tenantId
RETURN m, collect(ci) as contextItems
ORDER BY m.createdAt
// }

// Get a hierarchical view of threads
// CALL {
MATCH path = (root:Thread {id: $rootThreadId})-[:PARENT_OF*]->(child:Thread)
WHERE root.tenantId = $tenantId
RETURN path
// }

// Find the most common tags in a project
// CALL {
MATCH (p:Project {id: $projectId})-[:HAS_TAG]->(tag:Tag)<-[r:TAGGED_WITH]-(ci:ContentItem)
WHERE p.tenantId = $tenantId
RETURN tag.name, tag.color, count(r) as usageCount
ORDER BY usageCount DESC
// }
```

Both schemas have been organized into clear, logical sections with comprehensive support for multi-tenancy, real-time collaboration, and cross-database integration. The PostgreSQL schema leverages advanced features like row-level security, composite types, and materialized views, while the Neo4j schema uses specialized graph capabilities for complex relationship traversals and knowledge graph operations.
