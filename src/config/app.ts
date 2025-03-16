import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const config = {
  // Server settings
  server: {
    port: process.env.PORT || 3000,
    env: process.env.NODE_ENV || 'development',
  },
  
  // Database settings
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    user: process.env.DB_USER || 'contextnexus',
    password: process.env.DB_PASSWORD || 'contextnexus',
    database: process.env.DB_NAME || 'contextnexus',
  },
  
  // JWT settings (for future authentication)
  jwt: {
    secret: process.env.JWT_SECRET || 'development_secret',
    expiresIn: process.env.JWT_EXPIRY || '24h',
  },
  
  // API rate limiting
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000'), // 15 minutes
    max: parseInt(process.env.RATE_LIMIT_MAX || '100'), // limit each IP to 100 requests per windowMs
  },
};

export default config;
