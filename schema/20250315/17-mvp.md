Okay, let's distill this down to a streamlined, PostgreSQL-only MVP for a context management system, focusing *exclusively* on the core functionality needed to manage interactions and deferring complex AI and knowledge graph features. I'll review the provided document, identify the essential features, and propose a simplified schema.

**Core Requirements Review (from the document):**

The document emphasizes these key goals, which we need to *partially* address in the MVP:

1.  **Rapid Content Selection:** Users need to quickly select relevant parts of conversations (messages, paragraphs, code blocks).
2.  **Multi-Level Context Organization:**  We need a way to structure context hierarchically, though we can *simplify* the full vision for the MVP.
3.  **Dynamic Context Branching:**  The ability to create separate, focused conversation threads.  This is important, but we can simplify the "merging back" aspect for now.
4.  **Token Optimization:** While full optimization is complex, we need to track token usage to inform future improvements.  We *won't* implement complex compression or relevance weighting in the MVP.
5.  **User Control:**  Users need *explicit* control over what's included in the context.
6.  **Visual Interface:** While we won't build the UI here, the database schema needs to support the envisioned UI features (selection indicators, hierarchical views).
7. **White-labeling/Multi-Tenancy:** This is explicitly requested and must be included.

**Features to DEFER (Out of Scope for MVP):**

*   **Knowledge Graph Database (Neo4j):**  Entirely deferred.  We're focusing on the core interaction management.
*   **Complex Token Optimization:** No summarization, compression, or relevance weighting algorithms. We'll *track* token usage, but not optimize it.
*   **Real-Time Collaboration:** Deferred. No user sessions, presence, or CRDTs.
*   **Advanced AI Features:**  No semantic analysis, relevance scoring, or automated content suggestions beyond basic LLM integration.
*   **Vector Search (pgvector):** Deferred. While useful, it's not *essential* for basic context management.
*   **Matrix View:**  The hierarchical tree and (eventually) graph views are sufficient for the MVP.
*   **Team Activity Dashboard:**  Out of scope for a single-user focused MVP.

**Simplified Core Concepts (MVP Focus):**

The MVP boils down to these core elements:

*   **Conversations/Threads:**  A way to group messages together.  We'll call them "Threads" for consistency with previous designs.
*   **Messages:** Individual messages within a thread.
*   **Content Chunks:**  Sub-message units (paragraphs, code blocks, etc.) that can be individually selected for context.
*   **Contexts:**  Named selections of messages and/or content chunks.  These are the "saved contexts" that users can create, name, and reuse.
*   **Users:**  The users of the system.
*   **Tenants:**  For multi-tenancy.
*   **LLM Integration:** Basic tracking of LLM model usage (which model, prompt, response).

**PostgreSQL Schema Proposal (MVP):**

```sql
-- Tenants (for multi-tenancy)
CREATE TABLE tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Users
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    username TEXT NOT NULL,
    -- Add other user details as needed (e.g., email, password hash)
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, username) -- Unique username within a tenant
);

-- Threads (Conversations)
CREATE TABLE threads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    user_id UUID NOT NULL REFERENCES users(id),
    title TEXT,  -- Optional title for the thread
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Messages within a thread
CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    thread_id UUID NOT NULL REFERENCES threads(id),
    user_id UUID NOT NULL REFERENCES users(id), -- The user who sent/created the message
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')), -- Consistent with OpenAI API
    content TEXT NOT NULL,
    token_count INTEGER, -- Track token usage (important for future optimization)
    llm_model TEXT,      -- Store the LLM model used (if applicable)
    prompt TEXT,          -- Store the prompt used (if applicable. Can store prompt TEMPLATE id here instead, to simplify).
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Content Chunks (sub-message units)
CREATE TABLE content_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id UUID NOT NULL REFERENCES messages(id),
    content TEXT NOT NULL,
    content_type TEXT NOT NULL CHECK (content_type IN ('text', 'code', 'list_item', 'heading')), -- Simple content types
    token_count INTEGER,    -- Track token usage per chunk
    sort_order INTEGER NOT NULL,  -- Order of the chunk within the message
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- User-defined Contexts (saved selections)
CREATE TABLE contexts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    user_id UUID NOT NULL REFERENCES users(id),
    name TEXT NOT NULL, -- User-provided name for the context
    description TEXT,   -- Optional description
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Linking Contexts to Messages and Content Chunks
CREATE TABLE context_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    context_id UUID NOT NULL REFERENCES contexts(id),
    message_id UUID,    -- Can be NULL if a content_chunk is selected
    content_chunk_id UUID, -- Can be NULL if a whole message is selected
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (message_id) REFERENCES messages(id),
    FOREIGN KEY (content_chunk_id) REFERENCES content_chunks(id),
    CHECK (
        (message_id IS NOT NULL AND content_chunk_id IS NULL) OR
        (message_id IS NULL AND content_chunk_id IS NOT NULL)
    ) -- Ensure either a message OR a content chunk is selected, but not both
);

-- Optional: Prompt Templates (if we want to manage prompts centrally)
CREATE TABLE prompt_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    name TEXT NOT NULL,
    template TEXT NOT NULL,
     -- Add variables as needed
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_messages_thread_id ON messages (thread_id);
CREATE INDEX idx_content_chunks_message_id ON content_chunks (message_id);
CREATE INDEX idx_context_items_context_id ON context_items (context_id);
CREATE INDEX idx_context_items_message_id ON context_items (message_id);
CREATE INDEX idx_context_items_content_chunk_id ON context_items (content_chunk_id);
CREATE INDEX idx_users_tenant_id ON users (tenant_id);
CREATE INDEX idx_threads_tenant_id ON threads (tenant_id);
CREATE INDEX idx_threads_user_id ON threads (user_id);
CREATE INDEX idx_messages_user_id ON messages (user_id);

```

**Key Design Choices and Justifications:**

*   **`tenants` and `users`:** Implements the required multi-tenancy.
*   **`threads`:**  Represents conversations/threads.  Includes a `user_id` to indicate the owner.
*   **`messages`:**  Stores individual messages. Includes `role`, `content`, and `token_count`. The `llm_model` and `prompt` fields are included for basic LLM integration.
*   **`content_chunks`:**  Allows for fine-grained selection of parts of messages.  The `content_type` field supports content-aware selection (e.g., selecting all code blocks). `sort_order` ensures correct ordering within a message.
*   **`contexts`:**  Represents user-defined saved contexts.
*   **`context_items`:**  A join table linking `contexts` to either entire `messages` *or* individual `content_chunks`. The `CHECK` constraint ensures that only one is selected at a time.
* **`prompt_templates`:** An optional table to store prompt templates that could be injected into the conversation.
* **Indexes**: Indexes are added on common join and filter fields to improve performance.

**Workflow Examples:**

1.  **Creating a New Thread:**
    *   Insert a new row into the `threads` table.

2.  **Adding a User Message:**
    *   Insert a new row into the `messages` table, with `role = 'user'`.
    *   Split the message content into chunks (paragraphs, code blocks, etc.).
    *   Insert rows into `content_chunks` for each chunk.  Calculate `token_count` for both the message and the chunks.

3.  **Adding an AI Response:**
    *   Same as above, but with `role = 'assistant'`.  Include the `llm_model` and potentially the raw `prompt`.

4.  **Creating a New Context:**
    *   Insert a row into `contexts`.

5.  **Adding a Message to a Context:**
    *   Insert a row into `context_items`, linking the `context_id` to the `message_id`.  Leave `content_chunk_id` as NULL.

6.  **Adding a Content Chunk to a Context:**
    *   Insert a row into `context_items`, linking the `context_id` to the `content_chunk_id`. Leave `message_id` as NULL.

7.  **Retrieving a Context:**
    *   Query `contexts` to find the context by ID.
    *   Join with `context_items` to get the associated `message_id` and `content_chunk_id` values.
    *   Use those IDs to retrieve the full message and chunk content from `messages` and `content_chunks`.

**Next Steps:**

This streamlined schema provides the foundation for the ContextNexus MVP. The next steps would be:

1.  **Implementation:**  Create the tables in a PostgreSQL database.
2.  **API Development:** Build an API (e.g., using GraphQL, as you suggested) to interact with the database. This API would handle the workflows described above.
3.  **Frontend Development:**  Build the user interface, focusing on the core features: displaying threads, messages, and chunks; allowing users to select content; and creating/managing contexts.

This MVP approach allows you to quickly build and test the core functionality of the context management system before adding more complex features. It's a solid, scalable, and maintainable foundation.

