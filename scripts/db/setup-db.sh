#!/bin/bash

# Database setup script for ContextNexus
set -e

echo "==== Setting up ContextNexus database ===="

# Check if PostgreSQL is installed
if ! command -v psql &> /dev/null; then
    echo "PostgreSQL is not installed. Please run the main setup script first."
    exit 1
fi

# Get database connection details (use environment variables or defaults)
DB_USER=${DB_USER:-"contextnexus"}
DB_PASS=${DB_PASS:-"contextnexus"}
DB_NAME=${DB_NAME:-"contextnexus"}

# Get the directory of this script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Try to create user and database (ignore errors if they already exist)
echo "Creating PostgreSQL user and database..."
sudo -u postgres psql -c "CREATE USER $DB_USER WITH PASSWORD '$DB_PASS';" 2>/dev/null || echo "User $DB_USER already exists"
sudo -u postgres psql -c "CREATE DATABASE $DB_NAME WITH OWNER $DB_USER;" 2>/dev/null || echo "Database $DB_NAME already exists"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;"

# Initialize PostgreSQL schema
echo "Initializing PostgreSQL schema..."
sudo -u postgres psql -d $DB_NAME -f "$SCRIPT_DIR/init-schema.sql"

echo "==== Database setup complete! ===="
