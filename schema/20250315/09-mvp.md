# Review of ContextNexus Specification & Streamlined PostgreSQL Approach

## Specification Analysis

After reviewing the ContextNexus concept document and the mockup, I can see this is primarily a **context management system** focused on giving users precise control over what content goes into LLM conversations. The key features are:

1. **Content Selection**: Paragraph-level, content-type aware selection (shown in the UI mockup)
2. **Context Organization**: Hierarchical structures with main threads and sub-threads
3. **Token Management**: Visual indicators, optimization, and budgeting
4. **Conversation Management**: Support for branching conversations

The mockup shows a user interface with:
- Selection mode controls
- Token usage indicators
- Message selection with checkboxes
- Context management panel
- Keyboard shortcuts

## Simplification Opportunities

The current schema design is extremely complex with:
- Dual-database architecture (PostgreSQL + Neo4j)
- Vector embeddings for semantic search
- Complex real-time collaboration
- Extensive knowledge graph capabilities

For an MVP focused on **manual context management**, we can dramatically simplify while preserving extensibility.

## Streamlined PostgreSQL-Only Approach

### Core Tables Design

```sql
-- Multi-tenancy
CREATE TABLE tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(50) UNIQUE NOT NULL,
    settings JSONB DEFAULT '{}'::jsonb,
    theme JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
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
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Project members
CREATE TABLE project_members (
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(50) NOT NULL DEFAULT 'member', -- 'member', 'admin', etc.
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (project_id, user_id)
);

-- Threads (conversation contexts)
CREATE TABLE threads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    parent_thread_id UUID REFERENCES threads(id), -- For hierarchical organization
    name VARCHAR(255) NOT NULL,
    description TEXT,
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Content items (text, code, etc.)
CREATE TABLE content_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    content_type VARCHAR(50) NOT NULL, -- 'text', 'code', 'list', 'image'
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    tokens INTEGER, -- Token count for budgeting
    metadata JSONB DEFAULT '{}'::jsonb, -- For content-specific properties
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Thread content associations (with selection properties)
CREATE TABLE thread_content (
    thread_id UUID NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    content_id UUID NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
    is_selected BOOLEAN DEFAULT TRUE, -- If this content is currently selected for context
    relevance_score FLOAT DEFAULT 1.0, -- For prioritization (0.0 to 1.0)
    position INTEGER, -- For ordering within thread
    selection_metadata JSONB DEFAULT '{}'::jsonb, -- Store selection details (paragraph ranges, etc.)
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (thread_id, content_id)
);

-- Content chunks (for paragraph-level selection)
CREATE TABLE content_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    content_id UUID NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL,
    content TEXT NOT NULL,
    start_position INTEGER, -- Character position in original content
    end_position INTEGER,
    tokens INTEGER NOT NULL, -- Token count for this chunk
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (content_id, chunk_index)
);

-- Thread chunk selections (which chunks are selected in each thread)
CREATE TABLE thread_chunk_selections (
    thread_id UUID NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    chunk_id UUID NOT NULL REFERENCES content_chunks(id) ON DELETE CASCADE,
    is_selected BOOLEAN DEFAULT TRUE,
    relevance_score FLOAT DEFAULT 1.0,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (thread_id, chunk_id)
);

-- Messages (LLM interactions)
CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    thread_id UUID NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id), -- NULL for AI messages
    role VARCHAR(50) NOT NULL, -- 'user', 'assistant', 'system'
    content TEXT NOT NULL,
    tokens_input INTEGER, -- Tokens used in prompt
    tokens_output INTEGER, -- Tokens in response
    context_snapshot JSONB, -- Snapshot of what was in context when message was sent
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Selection templates (saved selection patterns)
CREATE TABLE selection_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE, -- NULL for tenant-wide templates
    name VARCHAR(255) NOT NULL,
    description TEXT,
    selection_pattern JSONB NOT NULL, -- Pattern for selecting content
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- User preferences for selection modes
CREATE TABLE user_selection_preferences (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    selection_mode VARCHAR(50) NOT NULL DEFAULT 'visual', -- 'visual', 'ninja', 'smart'
    keyboard_shortcuts JSONB DEFAULT '{}'::jsonb, -- User's custom shortcuts
    default_relevance FLOAT DEFAULT 1.0,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id)
);

-- Basic analytics for token usage
CREATE TABLE token_usage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id),
    thread_id UUID NOT NULL REFERENCES threads(id),
    tokens_used INTEGER NOT NULL,
    usage_type VARCHAR(50) NOT NULL, -- 'input', 'output'
    timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
```

### Key Indexes

```sql
-- Essential indexes for performance
CREATE INDEX idx_content_items_project ON content_items(project_id);
CREATE INDEX idx_content_chunks_content ON content_chunks(content_id);
CREATE INDEX idx_messages_thread ON messages(thread_id, created_at);
CREATE INDEX idx_thread_content_thread ON thread_content(thread_id);
CREATE INDEX idx_threads_project ON threads(project_id);
CREATE INDEX idx_threads_parent ON threads(parent_thread_id) WHERE parent_thread_id IS NOT NULL;
```

### Functions for Token Management

```sql
-- Function to recalculate token counts for content items
CREATE OR REPLACE FUNCTION update_content_tokens()
RETURNS TRIGGER AS $$
BEGIN
    -- Simple approximation - in practice, use a tokenizer library
    -- This is just a placeholder
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
```

## Key Features Implementation

### 1. Content Selection

The schema supports the selection modes shown in the UI:

- **Visual Mode**: Using `thread_chunk_selections` to track paragraph-level selections
- **Ninja Mode**: Fast keyboard shortcuts via `user_selection_preferences`
- **Smart Select**: Could be implemented with simple rules stored in `selection_templates`

The `thread_content` and `thread_chunk_selections` tables track what content is selected for context, with relevance scoring for prioritization.

### 2. Context Organization

Threads can be organized hierarchically with the self-referential `parent_thread_id` in the `threads` table. This supports:

- Main threads with sub-threads
- Branching conversations
- Maintaining context relationships

### 3. Token Management

Token tracking is built into the schema:
- `tokens` field in `content_items` and `content_chunks`
- `tokens_input` and `tokens_output` in `messages`
- `calculate_thread_selected_tokens()` function for real-time token calculations

### 4. Multi-Tenancy

The schema fully supports multi-tenancy with:
- `tenant_id` in all relevant tables
- Tenant-specific settings and themes
- Per-tenant project organization

## Benefits of This Approach

1. **Simplicity**: Single database architecture is easier to develop, deploy, and maintain
2. **Focus**: Concentrates on core context management features
3. **Performance**: PostgreSQL is highly optimized for these types of queries
4. **Extensibility**: Schema can be extended later to add:
   - Vector embeddings for semantic search (via pgvector)
   - More advanced real-time collaboration
   - Graph capabilities (using either PostgreSQL or adding Neo4j later)

## API and GraphQL Integration

For the frontend UI, a GraphQL API layer would work well with this schema:

```graphql
type Thread {
  id: ID!
  name: String!
  description: String
  parentThread: Thread
  childThreads: [Thread!]
  selectedContent: [ContentItem!]
  selectedChunks: [ContentChunk!]
  messages: [Message!]
  totalSelectedTokens: Int!
}

type ContentItem {
  id: ID!
  title: String!
  content: String!
  contentType: String!
  tokens: Int!
  chunks: [ContentChunk!]
}

type ContentChunk {
  id: ID!
  content: String!
  tokens: Int!
  isSelected(threadId: ID!): Boolean!
  relevanceScore(threadId: ID!): Float!
}
```

## Next Steps

1. **Implement the core schema** in PostgreSQL
2. **Develop a GraphQL API** layer with resolvers for the schema
3. **Build the UI components** shown in the mockup
4. **Add token calculation logic** using a proper tokenizer
5. **Implement chunk selection logic** for the different selection modes

This approach gives you a solid foundation for your context management MVP while keeping the door open for more advanced features in the future.
