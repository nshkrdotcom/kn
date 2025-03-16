-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Multi-tenancy foundation
CREATE TABLE tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(50) UNIQUE NOT NULL,
    settings JSONB DEFAULT '{}'::jsonb,
    theme JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT TRUE
);

-- Users
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'user',
    settings JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMPTZ,
    UNIQUE (tenant_id, email)
);

-- Projects (workspaces for organizing threads)
CREATE TABLE projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    settings JSONB DEFAULT '{}'::jsonb,
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (tenant_id, name)
);

-- Project members
CREATE TABLE project_members (
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(50) NOT NULL DEFAULT 'member',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (project_id, user_id)
);

-- Threads (conversation contexts)
CREATE TABLE threads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    status VARCHAR(50) DEFAULT 'active',
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    version BIGINT DEFAULT 1    -- For optimistic locking
);

-- Thread hierarchy (parent-child relationships)
CREATE TABLE thread_relationships (
    parent_thread_id UUID NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    child_thread_id UUID NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    position INTEGER,    -- For ordering
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (parent_thread_id, child_thread_id),
    CONSTRAINT no_self_reference CHECK (parent_thread_id != child_thread_id)
);

-- Content items (text, code, etc.)
CREATE TABLE content_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    content_type VARCHAR(50) NOT NULL,    -- 'text', 'code', 'list', etc.
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    tokens INTEGER,    -- Token count for budgeting
    metadata JSONB DEFAULT '{}'::jsonb,
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    version BIGINT DEFAULT 1    -- For optimistic locking
);

-- Content chunks (for paragraph-level selection)
CREATE TABLE content_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    content_id UUID NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL,
    content TEXT NOT NULL,
    start_position INTEGER,    -- Character position in original content
    end_position INTEGER,
    tokens INTEGER NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (content_id, chunk_index)
);

-- Thread content associations (with selection properties)
CREATE TABLE thread_content (
    thread_id UUID NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    content_id UUID NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
    is_selected BOOLEAN DEFAULT TRUE,    -- If currently selected for context
    relevance_score FLOAT DEFAULT 1.0,   -- For prioritization (0.0 to 1.0)
    position INTEGER,                    -- For ordering within thread
    selection_metadata JSONB DEFAULT '{}'::jsonb,   -- For detailed selection data
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (thread_id, content_id)
);

-- Thread chunk selections (which chunks are selected)
CREATE TABLE thread_chunk_selections (
    thread_id UUID NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    chunk_id UUID NOT NULL REFERENCES content_chunks(id) ON DELETE CASCADE,
    is_selected BOOLEAN DEFAULT TRUE,
    relevance_score FLOAT DEFAULT 1.0,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (thread_id, chunk_id)
);

-- LLM models configuration
CREATE TABLE llm_models (
    id VARCHAR(100) PRIMARY KEY,    -- e.g., 'gpt-4', 'claude-3'
    provider VARCHAR(100) NOT NULL, -- 'openai', 'anthropic', etc.
    display_name VARCHAR(255) NOT NULL,
    max_tokens INTEGER NOT NULL,
    pricing_per_1k_tokens NUMERIC(10, 6),
    is_enabled BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Messages (LLM interactions)
CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    thread_id UUID NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id),    -- NULL for AI messages
    role VARCHAR(50) NOT NULL,            -- 'user', 'assistant', 'system'
    content TEXT NOT NULL,
    model_id VARCHAR(100) REFERENCES llm_models(id),
    tokens_input INTEGER,                 -- Tokens used in prompt
    tokens_output INTEGER,                -- Tokens in response
    context_snapshot JSONB,               -- Snapshot of what was in context
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    version BIGINT DEFAULT 1              -- For optimistic locking
);

-- Message relationships (for branching conversations)
CREATE TABLE message_relationships (
    parent_message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    child_message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    relationship_type VARCHAR(50) DEFAULT 'response',    -- 'response', 'alternative', etc.
    position INTEGER,                                    -- For ordering
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (parent_message_id, child_message_id),
    CONSTRAINT no_self_reference CHECK (parent_message_id != child_message_id)
);

-- Selection templates (saved selection patterns)
CREATE TABLE selection_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,    -- NULL for tenant-wide
    name VARCHAR(255) NOT NULL,
    description TEXT,
    selection_pattern JSONB NOT NULL,     -- Pattern for selecting content
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- User selection preferences (modes and shortcuts)
CREATE TABLE user_selection_preferences (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    selection_mode VARCHAR(50) NOT NULL DEFAULT 'visual',    -- 'visual', 'ninja', 'smart'
    keyboard_shortcuts JSONB DEFAULT '{}'::jsonb,
    default_relevance FLOAT DEFAULT 1.0,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id)
);

-- Token usage tracking
CREATE TABLE token_usage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id),
    thread_id UUID NOT NULL REFERENCES threads(id),
    message_id UUID REFERENCES messages(id),
    tokens_used INTEGER NOT NULL,
    usage_type VARCHAR(50) NOT NULL,    -- 'input', 'output'
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX idx_content_items_project ON content_items(project_id);
CREATE INDEX idx_content_chunks_content ON content_chunks(content_id);
CREATE INDEX idx_messages_thread ON messages(thread_id, created_at);
CREATE INDEX idx_thread_content_thread ON thread_content(thread_id);
CREATE INDEX idx_threads_project ON threads(project_id);
CREATE INDEX idx_thread_relationships_parent ON thread_relationships(parent_thread_id);
CREATE INDEX idx_thread_relationships_child ON thread_relationships(child_thread_id);
CREATE INDEX idx_token_usage_thread ON token_usage(thread_id);
CREATE INDEX idx_token_usage_tenant ON token_usage(tenant_id);

-- Functions for token management
CREATE OR REPLACE FUNCTION update_content_tokens()
RETURNS TRIGGER AS $$
BEGIN
    -- This is a placeholder - in production, use proper tokenizer
    NEW.tokens := GREATEST(1, ROUND(length(NEW.content)::numeric / 4));
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER content_item_tokens_trigger
BEFORE INSERT OR UPDATE OF content ON content_items
FOR EACH ROW EXECUTE FUNCTION update_content_tokens();

-- Function to calculate selected tokens in a thread
CREATE OR REPLACE FUNCTION calculate_thread_selected_tokens(p_thread_id UUID)
RETURNS INTEGER AS $$
DECLARE
    total_tokens INTEGER;
BEGIN
    -- Sum tokens from selected chunks
    SELECT COALESCE(SUM(cc.tokens), 0) INTO total_tokens
    FROM thread_chunk_selections tcs
    JOIN content_chunks cc ON tcs.chunk_id = cc.id
    WHERE tcs.thread_id = p_thread_id AND tcs.is_selected = TRUE;
    
    RETURN total_tokens;
END;
$$ LANGUAGE plpgsql;

-- Function to update timestamps
CREATE OR REPLACE FUNCTION update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply update timestamp triggers
CREATE TRIGGER update_tenants_timestamp
BEFORE UPDATE ON tenants
FOR EACH ROW EXECUTE FUNCTION update_timestamp();

CREATE TRIGGER update_users_timestamp
BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION update_timestamp();

CREATE TRIGGER update_projects_timestamp
BEFORE UPDATE ON projects
FOR EACH ROW EXECUTE FUNCTION update_timestamp();

CREATE TRIGGER update_threads_timestamp
BEFORE UPDATE ON threads
FOR EACH ROW EXECUTE FUNCTION update_timestamp();

CREATE TRIGGER update_content_items_timestamp
BEFORE UPDATE ON content_items
FOR EACH ROW EXECUTE FUNCTION update_timestamp();

CREATE TRIGGER update_selection_templates_timestamp
BEFORE UPDATE ON selection_templates
FOR EACH ROW EXECUTE FUNCTION update_timestamp();

-- Insert default tenant and admin user for development purposes
INSERT INTO tenants (name, slug) 
VALUES ('Default Tenant', 'default');

-- Password is 'admin123' (hashed)
INSERT INTO users (tenant_id, email, name, password_hash, role)
VALUES (
    (SELECT id FROM tenants WHERE slug = 'default'),
    'admin@contextnexus.io',
    'Admin User',
    crypt('admin123', gen_salt('bf')),
    'admin'
);

-- Default project
INSERT INTO projects (tenant_id, name, created_by)
VALUES (
    (SELECT id FROM tenants WHERE slug = 'default'),
    'Default Project',
    (SELECT id FROM users WHERE email = 'admin@contextnexus.io')
);
