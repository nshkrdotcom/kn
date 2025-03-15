# kb
AI Jam private

# Setting Up an Ad Hoc Python Server

To serve the files from the `./pub` directory using Python's built-in HTTP server, follow these steps:

## Instructions

1. Open a terminal or command prompt
2. Navigate to the root directory (where the `pub` folder is located)
3. Run one of the following commands based on your Python version:

### Python 3 (Recommended)
```bash
python3 -m http.server --directory pub 8000
```

This will start a server on port 8000 serving files from the `./pub` directory.

### Alternative Method
If your Python version doesn't support the `--directory` option (Python < 3.7):
```bash
cd pub
python3 -m http.server 8000
```

### Accessing the Site
Open your web browser and navigate to:
```
http://localhost:8000
```

### Stopping the Server
To stop the server, press `Ctrl+C` in the terminal where the server is running.

# Brad's links



(https://github.com/Technoculture/personal-graph)

(https://github.com/neo4j-labs/llm-graph-builder/tree/main)

[Paul's link to integration points for neo4j llm graph builder](https://gist.github.com/nshkrdotcom/32fe5ad7206df902e99a6250fd56364e)

[big daddy](https://github.com/microsoft/graphrag)

(https://github.com/lab-v2/pyreason)

(https://github.com/pyg-team/pytorch_geometric)

(https://github.com/gusye1234/nano-graphrag)





*   **`api`**: Defines the REST API endpoints, including routes, controllers, and middlewares.
*   **`config`**:  Application configuration, including environment variables and database settings.
*   **`db`**: Manages database connections (PostgreSQL for relational data, Neo4j for graph data, MinIO for object storage, and Pinecone for vector embeddings).
*   **`repositories`**:  Implements the repository pattern for data access.  Interfaces define the contracts, and specific implementations exist for each database.
*   **`services`**: Contains the core business logic, interacting with repositories and other services.
*   **`llm`**: The crucial layer for interacting with LLMs.  Includes connectors for different providers (like OpenAI) and logic for context optimization and prompt building.
*   **`types`**: TypeScript interfaces and types shared across the backend.
*   **`utils`**:  Utility functions like error handling, logging, and token counting.
*   **`app.ts`**: Sets up the Express application, including middleware and routing.
*   **`server.ts`**:  Starts the server.
*   **`di/container.ts`**: Sets up the dependency injection.

### Frontend (`frontend`)

The `frontend` directory is structured as a typical React application. This project is set up to use components, modules, and hooks.

### Data Model (`types/core.ts`)

The `src/types/core.ts` file defines the key data structures, like `Context`, `ContentItem`, and `User`. These interfaces ensure type safety across the application.

## Current Implementation Status

*   **Database Schema**: PostgreSQL schema for users, projects, contexts, and content items is defined. Neo4j schema is also defined.
*   **Repositories**: PostgreSQL repositories for core entities are partially implemented.
*   **Services**: Basic services for project, context, and content management are present.
*   **API Routes**:  Routes for core entities are partially set up.
*   **Authentication**:  Basic authentication service and middleware are partially implemented.
*   **LLM Interaction**:  Basic structures for LLM connectors are defined, but the full integration and optimization logic is the next major focus.

## Development Guidelines

1.  **TypeScript**:  The backend is written in TypeScript.  Strict typing should be enforced.
2.  **Clean Architecture**: The project follows a clean architecture approach, separating concerns into layers (API, Services, Repositories, etc.).
3.  **Repository Pattern**:  Data access is abstracted through repositories.  This allows for switching database implementations without affecting core logic.
4.  **Dependency Injection**:  A simple DI container is set up. Use it to manage dependencies.
5.  **Error Handling**: Use the `ApplicationError` class and its subclasses for consistent error handling.
6.  **Logging**: Use the provided `logger` utility for logging.
7.  **Asynchronous Operations**:  Use `async/await` for asynchronous operations.
8.  **Configuration**:  Use `app-config.ts` for all configuration settings.
9.  **Testing**:  Write unit and integration tests for all critical components.
10. **Code Style**: Follow consistent code style. Use Prettier and ESLint with the provided configurations.
11. **Comments**: Use comments strategically.  Prioritize self-documenting code, but use comments to:
    *   Explain complex logic.
    *   Document design decisions.
    *   Mark areas for future improvement (TODOs).
    *   Generate documentation (JSDoc style).
12. **Error Handling**:  Errors thrown by the system should be instances of `ApplicationError` or its subclasses.  API endpoints should handle errors and return appropriate HTTP status codes and error messages.
13. **Security**:  All API endpoints should be protected by authentication middleware.  Sensitive operations should have appropriate authorization checks.
14. **Transactions**: Database operations that modify multiple tables should be wrapped in transactions to ensure data consistency.

## Getting Started

1.  **Install Dependencies:**
    ```bash
    cd contextnexus
    npm install
    cd frontend
    npm install
    ```
    
2.  **Set up Environment Variables:**
    Create a `.env` file in the root directory and configure the necessary variables.  See `config/app-config.ts` for the required variables. An example `.env.example` file is provided.
    
3.  **Database Setup:**
    Ensure PostgreSQL and Neo4j are running.  Create the required databases (default: `contextnexus`).
    
4.  **Run the Backend:**
    ```bash
    cd contextnexus
    npm run dev # Starts the backend with ts-node-dev
    ```
    
5.  **Run the Frontend:**
    ```bash
    cd frontend
    npm start
    ```
    
## Immediate Next Steps

The most critical next steps are:

1.  **Complete Authentication:** Finish the `AuthService` implementation, including JWT generation, validation, and refresh token handling.

2.  **Implement LLM Interaction:** Focus on the `llm` directory, building out the `OpenAIConnector` and the core logic for sending prompts and receiving responses.

3.  **Basic Context Selection UI:** Create a simplified version of the context selection interface in the frontend, allowing users to choose content from a list.

4.  **Connect UI to API:** Integrate the frontend components with the backend API endpoints.

Once these steps are complete, we'll have a minimal viable product that demonstrates the core concept of ContextNexus: user-controlled, LLM-powered knowledge interaction. From there, we can iteratively add features based on the roadmap.

## Dependencies

The main dependencies of this project, based on the file you sent, are:

*   **Backend:**
    *   Express (web framework)
    *   PostgreSQL (relational database)
    *   Neo4j (graph database)
    *   MinIO (object storage)
    *   Pinecone (vector database)
    *   jsonwebtoken (JWT handling)
    *   bcrypt (password hashing)
    *   winston (logging)
    *   dotenv (environment variables)
    *   uuid (for generating unique IDs)
    *   @types/node, @types/express, etc. (TypeScript types)
    *   typescript, ts-node, nodemon (TypeScript development)

*   **Frontend:**
    *   React
    *   React Router
    *   Redux Toolkit
    *   axios (API client)
    *   react-toastify (Notifications)
    *   formik, yup (form handling/validation)
    *   @babel/standalone (Babel for in-browser JSX)
    *  three
    *  d3-force
    *  regl

*   **Testing:**
    *   Jest (testing framework)
    *   Supertest (for API testing)
    *   @testing-library/react (for React component testing)

*   **Code Quality:**
    *   ESLint (linting)
    *   Prettier (code formatting)

This is a substantial list, and confirms that we have a good basis for both the backend and frontend.  The presence of D3, Three.js, and Regl indicates a focus on data visualization.

## Documentation

I've generated a lot of documentation in `diags/20250314` and `docs/20250312` directories. I will continue to produce documentation as we develop this project. I will produce `README.md` files in each directory as we create the directories.

## Team Collaboration

*   **Code Reviews:** All code changes should be reviewed by at least one other team member.
*   **Branching Strategy:** Use feature branches for new features and bug fixes.
*   **Commit Messages:** Follow a consistent commit message format (e.g., Conventional Commits).
*   **Communication:** Use Slack/Discord/Teams for daily communication.

This README provides a starting point for team collaboration.  It should be updated as the project evolves.