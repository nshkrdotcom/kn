# PostgreSQL Schema: Practical System Interactions

## Core Multi-Tenancy Layer

### `tenants` Table
This table forms the foundation of the entire multi-tenant architecture, serving as the top-level container for all customer organizations. Each row represents a distinct organization using the ContextNexus platform. In your application code, this would be represented by a `Tenant` class that manages organization-wide settings.

From a user perspective, tenants are invisible - users simply log into "their company's ContextNexus," unaware they're in a multi-tenant system. However, administrators see this as their organization's configuration dashboard where they can customize branding, manage subscription limits, and configure domain settings.

All other tables in the system include a `tenant_id` to ensure complete data isolation between organizations. When a user logs in, the system identifies their tenant and sets a PostgreSQL session variable that row-level security policies use to restrict data access.

### `tenant_audit_log` Table
This serves as a security and compliance record for tenant-level changes. The application logs entries here whenever significant tenant configuration changes occur, which administrators can review for security audits or troubleshooting.

The audit log appears to users only in administrative reports or security compliance views. Backend code automatically generates these records through observation patterns or database triggers, capturing who made what changes to the tenant configuration.

## User and Session Management

### `users` Table
This table stores all user identities and their authentication information. Each user belongs to a specific tenant, making this immediately subordinate to the tenant table. 

In the application, a `User` model serves as the identity and permission foundation, often extending authentication frameworks like Devise (Rails) or Django Auth. Every API request or page load authenticates against this table.

Users experience this as their profile information and login credentials. User profiles, avatar settings, notification preferences, and role assignments all map to this table. The `role` and `permissions` control what the user can see and do throughout the application.

### `user_activity` Table
This captures significant user actions for audit purposes. The application logs important operations like creating projects, deleting content, or changing permissions, providing an activity trail.

In the backend, this might use an aspect-oriented approach that automatically logs activities for auditable operations. Users typically see this data in admin tools as activity logs, but it also powers features like "recent activity" feeds and notifications.

### `user_sessions` and `resource_presence` Tables
These tables work together to enable real-time collaboration. `user_sessions` tracks active user connections, while `resource_presence` shows which users are currently viewing or editing specific resources.

From an architecture standpoint, these tables interface directly with WebSocket connections and presence channels. When a user opens the application, it establishes a session and continually updates their presence as they navigate through different resources.

Users experience this as "presence awareness" - seeing avatars or indicators of who else is currently viewing the same project, thread, or document. The interface might show a small avatar stack of active users on a thread, or a cursor with a user's name when they're editing a document.

## Project Structure

### `programs` Table
Programs are the highest-level organizational containers, representing major initiatives, departments, or product lines. They group related projects together.

In the application code, a `Program` model would manage collections of projects and program-wide settings. Programs often map to organizational units within the company or major workstreams.

Users experience these as the top-level navigation in the interface - a dropdown of programs they can access, with each program containing multiple related projects. This gives organizations a way to segment work logically while maintaining shared access where needed.

### `projects` Table
Projects are the primary working containers where most user activity happens. They hold collections of threads, content, and collaborators focused on a specific goal or topic.

In the codebase, a `Project` model is a central organizing entity that manages access controls and contains methods for project-specific operations. Most user-facing features operate within the context of a specific project.

To users, projects appear as workspaces with their own dashboard, collaboration tools, and content repositories. Users spend most of their time within projects, creating and organizing content, participating in threads, and collaborating with team members.

### `project_memberships` Table
This is a join table that controls which users have access to which projects and what permissions they have within each project. It enables fine-grained access control beyond tenant-wide roles.

The application uses this table to determine project visibility and permission checks for every action a user attempts within a project. It might be represented by a `ProjectMember` model that handles role-based permissions.

Users experience this through project access lists and role assignments. Project owners see member management interfaces where they can invite team members, set roles (viewer, editor, admin), and manage permissions for each project independently.

### `threads` Table
Threads (renamed from contexts) are conversational containers that organize related content and messages. They represent specific discussions, topics, or AI-assisted conversations.

In the application, a `Thread` class manages conversation flow, context management, and content inclusion. Threads are central to the context-building features that make ContextNexus powerful.

To users, threads appear as conversation interfaces where they can chat with AI assistants within a specific context, with visual indicators showing which content is included. Users can create multiple threads to organize different conversations or exploration paths within a project.

### `thread_relationships` Table
This table establishes hierarchical or lateral relationships between threads, allowing for branching conversations, thread organization, and knowledge structuring.

The code might use a `ThreadRelationshipManager` service to handle the creation and traversal of these relationships. Graph-like queries help users navigate complex thread hierarchies.

In the interface, users see threads organized in parent-child hierarchies or related groups. They can branch a conversation to explore a tangent while maintaining the connection to the original thread. Visual cues like indentation or connection lines show these relationships.

## Content Management

### `storage_types` and `content_types` Tables
These reference tables define the available storage backends and content formats. They make the system extensible by allowing new storage options or content formats to be added without schema changes.

The application uses these as configuration for content handling strategies, likely implementing a factory pattern where different handlers are selected based on content and storage types.

Users don't directly interact with these tables but experience them through the types of content they can create or import (text, code, PDFs, images) and the various storage options available based on their tenant's configuration.

### `content_items` Table
This is the primary table for all knowledge content in the system. Each row represents a distinct piece of content like a document, code snippet, or image.

In the application, a polymorphic `ContentItem` model serves as the base class for different content types, with type-specific functionality determined by the `content_type`. Content providers, processors, and renderers interact with this central table.

Users experience content items as the documents, code snippets, images, and other resources they create, import, or reference in their conversations. Content appears in search results, can be added to thread contexts, and forms the knowledge base of the system.

### `text_content` and `code_content` Tables
These tables store the actual content data for specific content types, extending the base `content_items` table with type-specific storage.

The application uses single-table inheritance or a repository pattern where different content type handlers know how to read from and write to the appropriate specialized tables.

To users, these specialized tables manifest as proper rendering and editing experiences for different content types - syntax highlighting for code, markdown rendering for text, etc. The UI automatically provides appropriate editors and viewers based on the content type.

### `content_chunks` Table
This table stores smaller segments of content that have been processed for context inclusion. It's essential for semantic search and token management when including content in AI conversations.

In the system architecture, a chunking service processes content into these segments, and a vector search service uses them for semantic similarity. The application manages token budgets and relevance based on these chunks.

Users don't directly see chunks, but they experience the benefits through more accurate semantic search, precise content inclusion in conversations (where only relevant passages are included rather than entire documents), and more efficient token usage when chatting with AI.

### `tags` and `content_tags` Tables
These tables implement a tagging system for content organization. `tags` defines the available tags, while `content_tags` creates the many-to-many relationship between content and tags.

In the code, a tagging service manages the creation, assignment, and search of tags. Tag-based filtering is implemented across content retrieval operations.

Users see tags as colored labels they can assign to content for organization. They can filter content by tags, see tag clouds showing popular topics, and use tags to quickly build context by including all content with certain tags.

## Collaboration & Real-Time Features

### `operations_log` Table
This table is the heart of the collaborative editing system, storing every edit operation in a format compatible with Conflict-free Replicated Data Types (CRDTs). It enables multiple users to edit the same content simultaneously without conflicts.

In the application, an `OperationsProcessor` service handles incoming operations, assigns Lamport timestamps and vector clocks, and manages the eventual consistency of documents. WebSocket channels broadcast operations to all connected clients.

Users experience this as Google Docs-like collaborative editing, where they can see others' cursors moving and changes appearing in real-time. The operations log ensures everyone's changes are properly merged, even in cases of poor connectivity.

### `content_versions` and `document_snapshots` Tables
These tables work together to manage document versioning and state. `content_versions` tracks discrete versions, while `document_snapshots` stores efficient checkpoints of document state for faster loading.

The versioning system in the code might implement a Git-like model where changes are tracked as operations but can be consolidated into snapshots for efficiency. Version history browsers and diff viewers use these tables.

Users see this as version history for their documents, allowing them to view or restore previous versions. The snapshot system also means documents load quickly even if they have extensive edit histories.

### `resource_locks` Table
This table implements optional locking for resources that need exclusive access. It's used for pessimistic concurrency control when optimistic CRDT approaches aren't appropriate.

The application's `LockManager` service handles lock acquisition, timeout, and release. Critical operations check for locks before proceeding.

Users might see this as "X is currently editing this document" notifications, or in some cases, having to wait for another user to finish editing before they can make changes, depending on the configured concurrency strategy for different resource types.

### `broadcast_events` Table
This table powers the real-time notification system, queuing up events that need to be sent to connected clients. It ensures users receive timely updates about changes relevant to them.

A background worker or pub/sub system processes these events and delivers them to appropriate WebSocket connections. The event broadcasting architecture might follow a pattern similar to ActionCable in Rails.

Users experience this as real-time notifications, updates appearing without page refreshes, and content changing before their eyes as others make modifications. The system feels alive and collaborative rather than static.

### `collaboration_workspaces` Table
This table manages shared workspace state for collaborative activities beyond simple document editing, like whiteboarding or diagram creation.

The application implements workspace controllers that manage collaborative state machines, handling concurrent operations on more complex structures than text.

Users see this as collaborative design spaces, shared dashboards, or interactive planning tools where multiple team members can contribute simultaneously to a shared visual workspace.

### `collaborative_selections` Table
This table tracks user selections and cursor positions across various resources, enabling features like shared highlighting and cursor awareness.

The codebase implements selection broadcasting services that continuously update and retrieve selection information via WebSocket channels.

Users experience this through seeing other users' cursors and selections in real-time within documents. When someone highlights text or positions their cursor, others see identification indicators showing who is working where.

### `conflict_resolutions` and `realtime_annotations` Tables
These tables support collaborative discussion and conflict resolution. `conflict_resolutions` records how editing conflicts were resolved, while `realtime_annotations` enables commenting and discussion about specific portions of content.

The application implements annotation services and conflict resolution strategies that help users collaborate effectively when disagreements arise.

Users experience these through comment threads attached to specific parts of documents, suggestion/revision features similar to Google Docs, and occasional prompts to resolve conflicting changes when automatic resolution isn't possible.

## Thread Content & Messaging

### `thread_content` Table
This join table connects threads to the content items included in their context. It tracks relevance, ordering, and collaborative state for each content item within a thread.

In the application, a `ContextManager` service handles the addition, removal, and prioritization of content within conversation contexts. This is central to the unique value proposition of ContextNexus.

Users experience this through the context panel in conversation interfaces, showing which documents are included in the current conversation. They can see relevance scores, adjust inclusion settings, and visually manage what the AI considers when responding.

### `llm_models` Table
This reference table defines the available AI models that can be used for generating responses. It includes capabilities, token limits, and pricing information.

The application implements model selection services and provider-specific API integrations based on this configuration. Model routing and fallback strategies reference this table.

Users see this as model selection dropdowns where they can choose which AI to converse with. Different models might be available for different purposes, with tooltips explaining their capabilities and limitations.

### `prompt_templates` Table
This table stores reusable prompt structures for common conversation patterns. Templates include placeholders that can be filled with specific content.

The application implements a templating engine that renders these templates with appropriate context. Template selection might be manual or automatic based on detected user intent.

Users experience this through prompt libraries they can select from, helping them formulate effective questions for specific purposes. Templates might appear as quick-start options or guided conversation flows.

### `messages` Table
This central table stores all conversation messages between users and AI assistants. It records token usage, costs, and what content was in context for each message.

The application's conversation controller manages message creation, routing to appropriate AI providers, and tracking conversation flows. Historical conversations are reconstructed from this table.

Users see this as their conversation history with AI assistants. They can review past conversations, see explanations of context used, and continue conversations from where they left off.

### `message_relationships` and `message_context_items` Tables
These tables track the relationships between messages and what specific content was in context for each message. This enables branching conversations and context transparency.

The application uses these to manage conversation trees and provide detailed context tracking. Branching conversations are managed through these relationship structures.

Users experience this through conversation branching interfaces where they can explore alternative responses or create conversation forks. They can also see exactly what content influenced each AI response for transparency and debugging.

## Analytics & Reporting

### `usage_stats` Table
This table tracks resource usage for billing and analytics. It records API calls, token consumption, storage usage, and other measurable activities.

The application implements usage tracking services that log activity for billing and reporting purposes. Quota management systems reference this data to enforce limits.

Users (particularly administrators) see this as usage dashboards showing consumption patterns, costs, and trends. Usage warnings appear when approaching limits, and detailed reports help optimize resource utilization.

### `active_project_users` Materialized View
This pre-computed view provides efficient access to information about currently active users in each project. It's regularly refreshed to maintain current awareness.

The application's presence and activity systems query this view for efficient user activity reporting. It serves as a performance optimization for frequently needed activity data.

Users experience this through "active now" indicators in project interfaces, showing who else is currently working in the same space. Project dashboards might show activity summaries based on this data.

### `token_usage_summary` Materialized View
This view aggregates token usage data for efficient reporting and billing calculations. It summarizes consumption by tenant, date, and model.

The application's reporting and billing systems utilize this for efficient cost calculations and usage trend analysis. It avoids expensive re-aggregation of detailed usage data.

Administrators see this data in cost and usage reports, helping them understand consumption patterns and optimize their usage of the platform. Usage forecasts and recommendations might be generated from this data.

## Knowledge Graph Integration

### Neo4j Integration Components
These components (constraints, triggers, and functions) handle synchronization between PostgreSQL and Neo4j, ensuring graph relationships stay consistent with relational data.

The application implements a data synchronization layer that keeps both databases in harmony. Graph operations in code transparently trigger appropriate updates to maintain consistency.

Users don't directly see this integration but experience its benefits through powerful knowledge graph visualizations, relationship discovery features, and advanced traversal capabilities that would be difficult to implement in PostgreSQL alone.

This practical overview explains how each major component of the PostgreSQL schema interacts with the ContextNexus system architecture, application code, and user experience, focusing on their functional roles rather than technical details.
