import express from 'express';
import cors from 'cors';
import path from 'path';
import dotenv from 'dotenv';
import apiRoutes from './api/routes';
import db from './db';
import config from './config/app';

// Load environment variables
dotenv.config();

// Initialize Express app
const app = express();
const PORT = config.server.port;

// Middleware
app.use(cors());
app.use(express.json());

// API routes
app.use('/api', apiRoutes);

// Serve static frontend files in production
if (config.server.env === 'production') {
  app.use(express.static(path.join(__dirname, '../client/build')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/build', 'index.html'));
  });
} else {
  // In development, provide a simple page
  app.get('/', (req, res) => {
    res.send(`
      <html>
        <head>
          <title>ContextNexus API</title>
          <style>
            body { font-family: sans-serif; max-width: 800px; margin: 0 auto; padding: 2rem; }
            pre { background: #f1f1f1; padding: 1rem; border-radius: 4px; }
            code { font-family: monospace; background: #f1f1f1; padding: 0.2rem; border-radius: 2px; }
          </style>
        </head>
        <body>
          <h1>ContextNexus API Server</h1>
          <p>The API server is running. The frontend should be started separately in development mode.</p>
          
          <h2>Available Endpoints:</h2>
          <pre>/api/health - Check server health
/api/tenants - List all tenants
/api/projects - List all projects
/api/threads - List threads (optional query: project_id)
/api/content - List content items (optional queries: project_id, content_type)</pre>
          
          <h2>Development Instructions:</h2>
          <ol>
            <li>Start the API server (this server): <code>npm run dev</code></li>
            <li>Start the frontend development server: <code>cd client && npm start</code></li>
            <li>Access the frontend at: <code>http://localhost:3001</code></li>
            <li>API is available at: <code>http://localhost:3000/api</code></li>
          </ol>
        </body>
      </html>
    `);
  });
}

// Start the server
db.checkConnection().then(connected => {
  if (connected) {
    app.listen(PORT, () => {
      console.log(`Server running at http://localhost:${PORT}`);
      console.log(`API available at http://localhost:${PORT}/api`);
      console.log(`Environment: ${config.server.env}`);
    });
  } else {
    console.error('Cannot start server due to database connection issues');
    process.exit(1);
  }
});
