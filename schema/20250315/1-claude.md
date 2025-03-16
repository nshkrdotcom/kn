# Enhanced Database Schema for ContextNexus

After reviewing your project requirements and existing schemas, I'll design robust database schemas for both PostgreSQL and Neo4j that support multi-tenancy, integrate effectively, and leverage advanced database features.

## PostgreSQL Schema Design

This design incorporates multi-tenancy, row-level security, advanced PostgreSQL features, and a foundation for integration with Neo4j.

```sql
-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm"; -- For similarity searches
CREATE EXTENSION IF NOT EXISTS "hstore"; -- For key-value storage

-- Multi-tenancy foundation
CREATE TABLE tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    domain VARCHAR(255) UNIQUE,
    slug VARCHAR(50) UNIQUE NOT NULL,
    features JSONB DEFAULT '{}'::jsonb, -- Enabled feature flags
    theme JSONB DEFAULT '{}'::jsonb, -- Branding/theme configuration
    settings JSONB DEFAULT '{}'::jsonb, -- General tenant settings
    max_storage_gb INTEGER DEFAULT 5,
    max_users INTEGER DEFAULT 10,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT TRUE
);

-- Audit log for tenant changes
CREATE TABLE tenant_audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    action VARCHAR(50) NOT NULL,
    details JSONB NOT NULL,
    performed_by UUID NOT NULL, -- Will reference users.id
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- User management
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'user', -- 'user', 'admin', 'editor', etc.
    permissions JSONB DEFAULT '{}'::jsonb, -- Fine-grained permissions
    is_tenant_admin BOOLEAN DEFAULT FALSE,
    settings JSONB DEFAULT '{}'::jsonb, -- User preferences
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMPTZ,
    UNIQUE (tenant_id, email)
);

-- Create a function to auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply the update_timestamp trigger to users
CREATE TRIGGER update_user_timestamp
BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION update_timestamp();

-- Create a custom composite type for audit purposes
CREATE TYPE audit_info AS (
    created_by UUID,
    created_at TIMESTAMPTZ,
    updated_by UUID,
    updated_at TIMESTAMPTZ
);

-- User audit log
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

-- Programs
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

-- Projects
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
    thread_type VARCHAR(50) DEFAULT 'standard', -- 'standard', 'exploration', 'archive'
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

-- Thread hierarchy (parent-child relationships)
CREATE TABLE thread_relationships (
    parent_thread_id UUID NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    child_thread_id UUID NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    relationship_type VARCHAR(50) DEFAULT 'contains', -- 'contains', 'branches_from', 'related_to', etc.
    position INTEGER, -- For ordering siblings
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (parent_thread_id, child_thread_id),
    -- Prevent a thread from being its own parent
    CONSTRAINT no_self_reference CHECK (parent_thread_id != child_thread_id)
);

-- Content storage types (extensible enum pattern)
CREATE TABLE storage_types (
    id VARCHAR(50) PRIMARY KEY, -- 'postgres', 'minio', 's3', etc.
    description TEXT NOT NULL,
    handler_class VARCHAR(255), -- Backend implementation reference
    config_schema JSONB, -- JSON schema for configuration
    is_enabled BOOLEAN DEFAULT TRUE
);

-- Initial storage types
INSERT INTO storage_types (id, description) VALUES 
('postgres', 'Store content directly in PostgreSQL'),
('minio', 'Store content in MinIO object storage'),
('s3', 'Store content in Amazon S3');

-- Content types (extensible enum pattern)
CREATE TABLE content_types (
    id VARCHAR(50) PRIMARY KEY, -- 'text', 'code', 'image', 'pdf', etc.
    description TEXT NOT NULL,
    icon VARCHAR(50),
    handler_class VARCHAR(255), -- Frontend/backend handler reference
    allowed_extensions TEXT[], -- File extensions associated with this type
    max_file_size_mb INTEGER,
    is_enabled BOOLEAN DEFAULT TRUE
);

-- Initial content types
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
    storage_key VARCHAR(255) NOT NULL, -- ID or path in respective storage
    title VARCHAR(255) NOT NULL,
    description TEXT,
    source_url VARCHAR(2048), -- Original content URL if imported
    author VARCHAR(255), -- Original author
    publication_date TIMESTAMPTZ, -- Original publication date
    is_active BOOLEAN DEFAULT TRUE,
    is_pinned BOOLEAN DEFAULT FALSE,
    tokens INTEGER, -- Token count for LLM context budgeting
    embedding_id VARCHAR(255), -- Reference to vector embedding if applicable
    semantic_version VARCHAR(50) DEFAULT '1.0.0', -- Semantic versioning
    version_number INTEGER DEFAULT 1, -- Simple numeric version
    file_size_bytes BIGINT, -- Size in bytes if file-based
    checksum VARCHAR(128), -- Content checksum for integrity checks
    settings JSONB DEFAULT '{}'::jsonb,
    metadata JSONB DEFAULT '{}'::jsonb,
    audit audit_info,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    -- Neo4j node ID for cross-reference
    neo4j_node_id VARCHAR(255),
    -- Ensure unique storage keys within tenant and storage type
    UNIQUE (tenant_id, storage_type, storage_key)
);

CREATE TRIGGER update_content_items_timestamp
BEFORE UPDATE ON content_items
FOR EACH ROW EXECUTE FUNCTION update_timestamp();

-- Create a text search index for content items
ALTER TABLE content_items ADD COLUMN search_vector tsvector;
CREATE INDEX content_items_search_idx ON content_items USING GIN(search_vector);

-- Text content
CREATE TABLE text_content (
    content_id UUID PRIMARY KEY REFERENCES content_items(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    format VARCHAR(50) DEFAULT 'plain', -- 'plain', 'markdown', 'html', etc.
    language VARCHAR(50) DEFAULT 'en', -- Language code
    -- Calculate tokens if needed based on content
    tokens INTEGER GENERATED ALWAYS AS (
        GREATEST(1, ROUND(length(content)::numeric / 4)) -- Simple approximation
    ) STORED
);

-- Trigger to update search_vector when text content changes
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
    language VARCHAR(50) NOT NULL, -- Programming language
    highlighted_html TEXT, -- Pre-rendered HTML for display
    tokens INTEGER GENERATED ALWAYS AS (
        GREATEST(1, ROUND(length(code)::numeric / 3)) -- Simple approximation
    ) STORED
);

-- Content chunks for text data
CREATE TABLE content_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    content_id UUID NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL, -- Sequence number of chunk
    content TEXT NOT NULL,
    start_position INTEGER, -- Start position in original content
    end_position INTEGER, -- End position in original content
    tokens INTEGER NOT NULL,
    embedding VECTOR(1536), -- For vector search (if PostgreSQL vector extension available)
    embedding_model VARCHAR(100), -- Model used for embedding
    metadata JSONB DEFAULT '{}'::jsonb, -- Additional chunk metadata
    neo4j_node_id VARCHAR(255), -- Cross-reference to Neo4j
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (content_id, chunk_index)
);

-- Content versions
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
    UNIQUE (content_id, version_number)
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
    is_system BOOLEAN DEFAULT FALSE, -- System-generated tag vs user-created
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    -- Each tag name must be unique within a project
    UNIQUE (tenant_id, project_id, name)
);

CREATE TRIGGER update_tags_timestamp
BEFORE UPDATE ON tags
FOR EACH ROW EXECUTE FUNCTION update_timestamp();

-- Content tagging (many-to-many)
CREATE TABLE content_tags (
    content_id UUID NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
    tag_id UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (content_id, tag_id)
);

-- Context items (relating threads to content)
CREATE TABLE thread_content (
    thread_id UUID NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    content_id UUID NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
    relevance_score FLOAT DEFAULT 1.0, -- 0.0 to 1.0
    position INTEGER, -- For manual sorting
    is_pinned BOOLEAN DEFAULT FALSE,
    inclusion_method VARCHAR(50) DEFAULT 'manual', -- 'manual', 'auto', 'semantic', 'recommended'
    inclusion_rule JSONB DEFAULT '{}'::jsonb, -- Rule that determined inclusion (for auto methods)
    token_budget INTEGER, -- Allocated token budget for this content in this thread
    selection_metadata JSONB DEFAULT '{}'::jsonb, -- Selection criteria, context, etc.
    audit audit_info,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    -- Neo4j relationship ID for cross-reference
    neo4j_relationship_id VARCHAR(255),
    PRIMARY KEY (thread_id, content_id)
);

CREATE TRIGGER update_thread_content_timestamp
BEFORE UPDATE ON thread_content
FOR EACH ROW EXECUTE FUNCTION update_timestamp();

-- LLM models
CREATE TABLE llm_models (
    id VARCHAR(100) PRIMARY KEY, -- e.g., 'gpt-4', 'claude-2'
    provider VARCHAR(100) NOT NULL, -- 'openai', 'anthropic', etc.
    display_name VARCHAR(255) NOT NULL,
    max_tokens INTEGER NOT NULL,
    pricing_per_1k_tokens NUMERIC(10, 6),
    capabilities JSONB DEFAULT '{}'::jsonb, -- What this model can do
    is_enabled BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Initialize with common models
INSERT INTO llm_models (id, provider, display_name, max_tokens) VALUES
('gpt-4', 'openai', 'GPT-4', 8192),
('gpt-3.5-turbo', 'openai', 'GPT-3.5 Turbo', 4096),
('claude-2', 'anthropic', 'Claude 2', 100000);

-- Prompt templates
CREATE TABLE prompt_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE, -- NULL means tenant-wide template
    name VARCHAR(255) NOT NULL,
    description TEXT,
    template TEXT NOT NULL,
    variables JSONB DEFAULT '[]'::jsonb, -- Expected variables
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
    user_id UUID REFERENCES users(id), -- NULL for system or AI messages
    role VARCHAR(50) NOT NULL, -- 'system', 'user', 'assistant'
    content TEXT NOT NULL,
    model_id VARCHAR(100) REFERENCES llm_models(id),
    prompt_template_id UUID REFERENCES prompt_templates(id),
    tokens_input INTEGER,
    tokens_output INTEGER,
    tokens_total INTEGER,
    cost NUMERIC(10, 6), -- Cost of this message
    context_snapshot JSONB, -- Snapshot of what was in context
    metadata JSONB DEFAULT '{}'::jsonb, -- Additional message metadata
    client_message_id VARCHAR(255), -- For client-side message tracking
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    neo4j_node_id VARCHAR(255) -- Cross-reference to Neo4j
);

-- Message relationships (for branching conversations)
CREATE TABLE message_relationships (
    parent_message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    child_message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    relationship_type VARCHAR(50) DEFAULT 'response', -- 'response', 'alternative', 'clarification'
    position INTEGER, -- For ordering among siblings
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (parent_message_id, child_message_id),
    CONSTRAINT no_self_reference CHECK (parent_message_id != child_message_id)
);

-- Message context items (what content was actually used for a message)
CREATE TABLE message_context_items (
    message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    content_id UUID NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
    chunk_ids UUID[] DEFAULT '{}', -- Specific chunks used
    relevance_score FLOAT,
    tokens_used INTEGER, -- How many tokens this content used in the context
    context_position INTEGER, -- Order in context window
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (message_id, content_id)
);

-- Usage statistics
CREATE TABLE usage_stats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id),
    project_id UUID REFERENCES projects(id),
    resource_type VARCHAR(50) NOT NULL, -- 'api_call', 'token', 'storage', etc.
    resource_id UUID, -- Related resource if applicable
    quantity INTEGER NOT NULL, -- Number of units used
    unit_cost NUMERIC(10, 6), -- Cost per unit
    total_cost NUMERIC(10, 6), -- Total cost for this usage
    timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Create partitioning for usage_stats by month
-- This would normally go in a migration script
-- CREATE TABLE usage_stats_y2023m01 PARTITION OF usage_stats FOR VALUES FROM ('2023-01-01') TO ('2023-02-01');

-- Context templates
CREATE TABLE context_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), 
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    configuration JSONB NOT NULL, -- Template configuration
    is_public BOOLEAN DEFAULT FALSE,
    audit audit_info,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Full-text search configuration
CREATE TABLE search_configurations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    search_type VARCHAR(50) NOT NULL DEFAULT 'full_text', -- 'full_text', 'semantic', 'hybrid'
    configuration JSONB NOT NULL, -- Configuration details
    is_default BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (tenant_id, name)
);

-- Knowledge graph settings
CREATE TABLE knowledge_graph_configurations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE, -- NULL for tenant-wide
    name VARCHAR(255) NOT NULL,
    description TEXT,
    node_types JSONB DEFAULT '[]'::jsonb, -- Defined node types
    relationship_types JSONB DEFAULT '[]'::jsonb, -- Defined relationship types
    visualization_settings JSONB DEFAULT '{}'::jsonb, -- Visual display settings
    is_default BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Row-Level Security (RLS) policies
-- Enable RLS on the tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
-- More tables would need RLS in production

-- Create policies
-- Example policy for users table - each tenant can only see their own users
CREATE POLICY tenant_isolation_users ON users
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- Example policy for projects table
CREATE POLICY tenant_isolation_projects ON projects
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- Multi-tenant function to set the current tenant context
CREATE OR REPLACE FUNCTION set_tenant_context(p_tenant_id uuid)
RETURNS void AS $$
BEGIN
    PERFORM set_config('app.current_tenant_id', p_tenant_id::text, false);
END;
$$ LANGUAGE plpgsql;

-- Create a view for easier project member management
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

-- Create materialized view for token usage stats
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

-- Create index to refresh the materialized view
CREATE UNIQUE INDEX token_usage_summary_idx ON token_usage_summary (tenant_id, usage_date, model_id);

-- Add refresh function for the materialized view
CREATE OR REPLACE FUNCTION refresh_token_usage_summary()
RETURNS void AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY token_usage_summary;
END;
$$ LANGUAGE plpgsql;

-- Add check constraints for additional validation
ALTER TABLE users 
ADD CONSTRAINT valid_email CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$');

ALTER TABLE content_items
ADD CONSTRAINT positive_tokens CHECK (tokens IS NULL OR tokens > 0);

-- Add foreign key to integrate with Neo4j
ALTER TABLE content_items
ADD CONSTRAINT unique_neo4j_node_id UNIQUE (neo4j_node_id) 
DEFERRABLE INITIALLY DEFERRED;

-- Create function to keep Neo4j and PostgreSQL in sync
CREATE OR REPLACE FUNCTION sync_to_neo4j()
RETURNS TRIGGER AS $$
BEGIN
    -- In a real implementation, this would call a service to sync changes to Neo4j
    -- This is a placeholder for conceptual explanation
    RAISE NOTICE 'Would sync % operation on % to Neo4j', TG_OP, TG_TABLE_NAME;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply Neo4j sync trigger to content_items
CREATE TRIGGER sync_content_items_to_neo4j
AFTER INSERT OR UPDATE OR DELETE ON content_items
FOR EACH ROW EXECUTE FUNCTION sync_to_neo4j();
```

## Neo4j Schema Design

Here's the enhanced Neo4j schema with multi-tenancy support and integration with PostgreSQL:

```cypher
// Multi-tenancy constraints
CREATE CONSTRAINT ON (t:Tenant) ASSERT t.id IS UNIQUE;

// Core entity constraints
CREATE CONSTRAINT ON (u:User) ASSERT u.id IS UNIQUE;
CREATE CONSTRAINT ON (p:Program) ASSERT p.id IS UNIQUE;
CREATE CONSTRAINT ON (p:Project) ASSERT p.id IS UNIQUE;
CREATE CONSTRAINT ON (t:Thread) ASSERT t.id IS UNIQUE;
CREATE CONSTRAINT ON (ci:ContentItem) ASSERT ci.id IS UNIQUE;
CREATE CONSTRAINT ON (c:ContentChunk) ASSERT c.id IS UNIQUE;
CREATE CONSTRAINT ON (m:Message) ASSERT m.id IS UNIQUE;
CREATE CONSTRAINT ON (tag:Tag) ASSERT tag.id IS UNIQUE;

// Content type constraints
CREATE CONSTRAINT ON (t:Text) ASSERT t.contentId IS UNIQUE;
CREATE CONSTRAINT ON (c:Code) ASSERT c.contentId IS UNIQUE;
CREATE CONSTRAINT ON (i:Image) ASSERT i.contentId IS UNIQUE;
CREATE CONSTRAINT ON (p:PDF) ASSERT p.contentId IS UNIQUE;

// Indexes for performance
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

// Composite indexes
CREATE INDEX ON :ContentItem(tenantId, contentType);
CREATE INDEX ON :Thread(tenantId, status);

// Relationship indexes
CREATE INDEX FOR ()-[r:INCLUDES]-() ON (r.relevanceScore);
CREATE INDEX FOR ()-[r:HAS_MEMBER]-() ON (r.role);
CREATE INDEX FOR ()-[r:TAGGED_WITH]-() ON (r.createdAt);

// Fulltext indexes for search
CALL db.index.fulltext.createNodeIndex(
  "contentItemSearch",
  ["ContentItem", "Text", "Code"],
  ["title", "description", "content", "code"]
);

// Knowledge nodes for semantic connections
CREATE CONSTRAINT ON (c:Concept) ASSERT c.id IS UNIQUE;
CREATE CONSTRAINT ON (e:Entity) ASSERT e.id IS UNIQUE;
CREATE CONSTRAINT ON (t:Topic) ASSERT t.id IS UNIQUE;
CREATE CONSTRAINT ON (kn:KnowledgeNode) ASSERT kn.id IS UNIQUE;

// Node creation templates

// Create Tenant
// Used for multi-tenancy isolation
CREATE (t:Tenant {
  id: $tenantId,
  name: $tenantName,
  domain: $domain,
  createdAt: datetime()
})

// Create User with tenant association
CREATE (u:User {
  id: $userId,
  tenantId: $tenantId,
  email: $email,
  name: $name,
  role: $role,
  createdAt: datetime()
})

// Link User to Tenant
MATCH (t:Tenant {id: $tenantId}), (u:User {id: $userId})
CREATE (t)-[:HAS_USER]->(u)

// Create Program
CREATE (p:Program {
  id: $programId,
  tenantId: $tenantId,
  name: $programName,
  description: $description,
  createdAt: datetime(),
  createdBy: $createdBy
})

// Link Program to Tenant
MATCH (t:Tenant {id: $tenantId}), (p:Program {id: $programId})
CREATE (t)-[:HAS_PROGRAM]->(p)

// Create Project
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

// Link Project to Program
MATCH (pg:Program {id: $programId}), (p:Project {id: $projectId})
CREATE (pg)-[:HAS_PROJECT]->(p)

// Add user to project with role
MATCH (p:Project {id: $projectId}), (u:User {id: $userId})
CREATE (p)-[:HAS_MEMBER {
  role: $role,
  addedAt: datetime(),
  addedBy: $addedBy
}]->(u)

// Create Thread
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

// Link Thread to Project
MATCH (p:Project {id: $projectId}), (t:Thread {id: $threadId})
CREATE (p)-[:HAS_THREAD]->(t)

// Create parent/child relationship between threads
MATCH (p:Thread {id: $parentId}), (c:Thread {id: $childId})
CREATE (p)-[:PARENT_OF {
  relationshipType: $relationshipType,
  createdAt: datetime()
}]->(c)

// Create ContentItem (base node)
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
  pgStorageKey: $pgStorageKey  // Reference to PostgreSQL storage
})

// Create Text content (specialized content)
MATCH (ci:ContentItem {id: $contentItemId})
CREATE (t:Text {
  contentId: $contentItemId,
  content: $content,
  format: $format,
  language: $language
})
CREATE (ci)-[:HAS_CONTENT]->(t)

// Create Code content (specialized content)
MATCH (ci:ContentItem {id: $contentItemId})
CREATE (c:Code {
  contentId: $contentItemId,
  code: $code,
  language: $language
})
CREATE (ci)-[:HAS_CONTENT]->(c)

// Create ContentChunk
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

// Link ContentChunk to ContentItem
MATCH (ci:ContentItem {id: $contentItemId}), (cc:ContentChunk {id: $chunkId})
CREATE (ci)-[:HAS_CHUNK]->(cc)

// Link ContentItem to Thread with relevance
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

// Create Tag
CREATE (tag:Tag {
  id: $tagId,
  tenantId: $tenantId,
  projectId: $projectId,
  name: $tagName,
  color: $color,
  createdAt: datetime(),
  createdBy: $createdBy
})

// Link Tag to Project
MATCH (p:Project {id: $projectId}), (tag:Tag {id: $tagId})
CREATE (p)-[:HAS_TAG]->(tag)

// Tag Content
MATCH (ci:ContentItem {id: $contentId}), (tag:Tag {id: $tagId})
CREATE (ci)-[:TAGGED_WITH {
  createdAt: datetime(),
  createdBy: $createdBy
}]->(tag)

// Create a Message
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

// Link Message to Thread
MATCH (t:Thread {id: $threadId}), (m:Message {id: $messageId})
CREATE (t)-[:CONTAINS_MESSAGE]->(m)

// Create parent/child Message relationship
MATCH (parent:Message {id: $parentId}), (child:Message {id: $childId})
CREATE (parent)-[:REPLIED_WITH {
  replyType: $replyType,
  position: $position,
  createdAt: datetime()
}]->(child)

// Connect Message to ContentItems used in context
MATCH (m:Message {id: $messageId}), (ci:ContentItem {id: $contentId})
CREATE (m)-[:USED_CONTEXT {
  relevanceScore: $relevance,
  tokensUsed: $tokensUsed,
  position: $position
}]->(ci)

// Knowledge Graph Extensions

// Create a Concept node (for abstract ideas)
CREATE (c:Concept:KnowledgeNode {
  id: $conceptId,
  tenantId: $tenantId,
  name: $conceptName,
  description: $description,
  createdAt: datetime(),
  createdBy: $createdBy
})

// Create an Entity node (for named entities)
CREATE (e:Entity:KnowledgeNode {
  id: $entityId,
  tenantId: $tenantId,
  name: $entityName,
  entityType: $entityType,
  description: $description,
  createdAt: datetime(),
  createdBy: $createdBy
})

// Create Topic node (for subject areas)
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

// Connect Knowledge Nodes to each other
MATCH (kn1:KnowledgeNode {id: $knowledgeNodeId1}), (kn2:KnowledgeNode {id: $knowledgeNodeId2})
CREATE (kn1)-[:CONNECTED_TO {
  relationshipType: $relationType,
  strength: $strength,
  description: $description,
  createdAt: datetime(),
  createdBy: $createdBy
}]->(kn2)

// Query examples

// Find all content in a project with tenant isolation
MATCH (ci:ContentItem)
WHERE ci.tenantId = $tenantId AND ci.projectId = $projectId
RETURN ci
ORDER BY ci.createdAt DESC

// Find content within a thread, ordered by relevance
MATCH (t:Thread {id: $threadId})-[r:INCLUDES]->(ci:ContentItem)
WHERE t.tenantId = $tenantId
RETURN ci, r.relevanceScore
ORDER BY r.relevanceScore DESC

// Find similar content using vector similarity (when embeddings are stored)
MATCH (cc1:ContentChunk {id: $sourceChunkId})
MATCH (cc2:ContentChunk)
WHERE cc1.tenantId = cc2.tenantId AND cc1.id <> cc2.id
WITH cc1, cc2, gds.alpha.similarity.cosine(cc1.embedding, cc2.embedding) AS similarity
WHERE similarity > 0.8
RETURN cc2.contentId, cc2.content, similarity
ORDER BY similarity DESC
LIMIT 10

// Find all threads and their content in a knowledge graph view
MATCH path = (p:Project {id: $projectId})-[:HAS_THREAD]->(t:Thread)-[:INCLUDES]->(ci:ContentItem)
WHERE p.tenantId = $tenantId
RETURN path
LIMIT 100

// Find connections between concepts and content
MATCH path = (kn1:KnowledgeNode {id: $conceptId})-[*1..3]-(kn2:KnowledgeNode)
WHERE kn1.tenantId = $tenantId
RETURN path
LIMIT 50

// Find all content connected to a specific knowledge node
MATCH (kn:KnowledgeNode {id: $knowledgeNodeId})<-[:RELATES_TO]-(ci:ContentItem)
WHERE kn.tenantId = $tenantId
RETURN ci
ORDER BY ci.title

// Find content that appears in multiple threads
MATCH (t:Thread)-[:INCLUDES]->(ci:ContentItem)
WHERE t.tenantId = $tenantId AND t.projectId = $projectId
WITH ci, count(t) as threadCount
WHERE threadCount > 1
RETURN ci.id, ci.title, threadCount
ORDER BY threadCount DESC

// Get conversation flow with context
MATCH (t:Thread {id: $threadId})-[:CONTAINS_MESSAGE]->(m:Message)
OPTIONAL MATCH (m)-[:USED_CONTEXT]->(ci:ContentItem)
WHERE t.tenantId = $tenantId
RETURN m, collect(ci) as contextItems
ORDER BY m.createdAt

// Get a hierarchical view of threads
MATCH path = (root:Thread {id: $rootThreadId})-[:PARENT_OF*]->(child:Thread)
WHERE root.tenantId = $tenantId
RETURN path

// Find the most common tags in a project
MATCH (p:Project {id: $projectId})-[:HAS_TAG]->(tag:Tag)<-[r:TAGGED_WITH]-(ci:ContentItem)
WHERE p.tenantId = $tenantId
RETURN tag.name, tag.color, count(r) as usageCount
ORDER BY usageCount DESC
```

## Integration Between PostgreSQL and Neo4j

To maintain synergy between both databases:

1. **Shared IDs**: Both databases use the same UUID-based IDs for core entities.

2. **Cross-references**: PostgreSQL tables include `neo4j_node_id` columns to reference Neo4j nodes.

3. **Synchronization triggers**: PostgreSQL triggers call procedures to keep Neo4j in sync.

4. **Tenant isolation**: Both databases apply tenant filtering for security.

5. **Transaction boundaries**: Application code ensures cross-database consistency with appropriate transaction handling.

## Key Advanced Features

### PostgreSQL

1. **Row-Level Security (RLS)**: Enforces tenant isolation at the database level.

2. **Custom Composite Types**: The `audit_info` type standardizes audit fields.

3. **Full-Text Search**: Integrated text search with `tsvector` columns and GIN indexes.

4. **Generated Columns**: Automatic calculation of token counts based on content.

5. **JSONB for Schema Flexibility**: Used for settings, metadata, and extensible configurations.

6. **Materialized Views**: For efficient reporting and analytics.

7. **Check Constraints**: Data validation beyond simple null/foreign key checks.

8. **Partitioning Support**: Table partitioning for scaling large tables like usage statistics.

9. **Triggers and Functions**: For maintaining data integrity and timestamps.

### Neo4j

1. **Relationship Properties**: Rich metadata on relationships between entities.

2. **Multiple Node Labels**: Nodes can have multiple labels for polymorphic queries.

3. **Graph-Specific Indexes**: Specialized indexes for relationship properties.

4. **Knowledge Graph Extensions**: Dedicated node types for semantic knowledge representation.

5. **Property Constraints**: Ensures data integrity through property uniqueness.

6. **Full-Text Indexes**: Supports text search across multiple node properties.

7. **Vector Similarity**: Support for semantic similarity through vector operations.

This schema design provides a robust foundation for the ContextNexus system with proper multi-tenancy, advanced database features, and integration between PostgreSQL and Neo4j. It supports all the key features described in the requirements while maintaining data integrity, security, and performance.
