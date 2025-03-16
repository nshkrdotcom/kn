import express from 'express';
import db from '../db';

const router = express.Router();

// Health check endpoint
router.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date() });
});

// Tenants
router.get('/tenants', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM tenants');
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching tenants:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// Projects
router.get('/projects', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM projects');
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching projects:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// Get a project by ID
router.get('/projects/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.query('SELECT * FROM projects WHERE id = $1', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Project not found' });
    }
    
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error fetching project:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// Threads
router.get('/threads', async (req, res) => {
  try {
    const { project_id } = req.query;
    
    let query = 'SELECT * FROM threads';
    let params: any[] = [];
    
    if (project_id) {
      query += ' WHERE project_id = $1';
      params.push(project_id);
    }
    
    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching threads:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// Get a thread by ID
router.get('/threads/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.query('SELECT * FROM threads WHERE id = $1', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Thread not found' });
    }
    
    // Get thread content
    const contentResult = await db.query(`
      SELECT tc.*, ci.title, ci.content_type, ci.tokens
      FROM thread_content tc
      JOIN content_items ci ON tc.content_id = ci.id
      WHERE tc.thread_id = $1
      ORDER BY tc.position
    `, [id]);
    
    const thread = result.rows[0];
    thread.content = contentResult.rows;
    
    res.json(thread);
  } catch (err) {
    console.error('Error fetching thread:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// Content items
router.get('/content', async (req, res) => {
  try {
    const { project_id, content_type } = req.query;
    
    let query = 'SELECT * FROM content_items';
    let params: any[] = [];
    let conditions = [];
    
    if (project_id) {
      conditions.push(`project_id = $${params.length + 1}`);
      params.push(project_id);
    }
    
    if (content_type) {
      conditions.push(`content_type = $${params.length + 1}`);
      params.push(content_type);
    }
    
    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    
    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching content items:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

export default router;
