#!/bin/bash

# ContextNexus Setup Script for Ubuntu 24.04
set -e

echo "==== Setting up ContextNexus on Ubuntu 24.04 ===="

# Check if script is run with sudo
if [ "$EUID" -ne 0 ]; then
  echo "Please run this script with sudo or as root"
  exit 1
fi

# Create a normal user to own the application
# (Skip if running this as a non-root user)
if [ "$SUDO_USER" ]; then
  APP_USER=$SUDO_USER
else
  APP_USER="contextnexus"
  echo "Creating application user: $APP_USER"
  if ! id "$APP_USER" &>/dev/null; then
    useradd -m -s /bin/bash $APP_USER
    echo "$APP_USER:contextnexus" | chpasswd
  fi
fi

# Update package lists
echo "Updating package lists..."
apt update

# Install system dependencies
echo "Installing system dependencies..."
apt install -y curl git build-essential postgresql postgresql-contrib

# Start PostgreSQL service
echo "Starting PostgreSQL service..."
systemctl start postgresql
systemctl enable postgresql

# Set up Node.js using NVM
echo "Setting up Node.js using NVM..."
if [ "$SUDO_USER" ]; then
  # Run as the original user
  su - $SUDO_USER -c 'curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.3/install.sh | bash && 
    export NVM_DIR="$HOME/.nvm" && 
    [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh" && 
    nvm install 18 && 
    nvm use 18 && 
    nvm alias default 18 &&
    npm install -g typescript ts-node'
else
  # Run as the app user
  su - $APP_USER -c 'curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.3/install.sh | bash && 
    export NVM_DIR="$HOME/.nvm" && 
    [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh" && 
    nvm install 18 && 
    nvm use 18 && 
    nvm alias default 18 &&
    npm install -g typescript ts-node'
fi

# Create PostgreSQL user and database
echo "Setting up PostgreSQL user and database..."
su - postgres -c "psql -c \"CREATE USER contextnexus WITH PASSWORD 'contextnexus';\""
su - postgres -c "psql -c \"CREATE DATABASE contextnexus WITH OWNER contextnexus;\""
su - postgres -c "psql -c \"GRANT ALL PRIVILEGES ON DATABASE contextnexus TO contextnexus;\""

# Current directory where the script is running
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Initialize PostgreSQL schema
echo "Initializing PostgreSQL schema..."
su - postgres -c "psql -d contextnexus -f $PROJECT_DIR/scripts/db/init-schema.sql"

# Install project dependencies
echo "Installing project dependencies..."
if [ "$SUDO_USER" ]; then
  # Run as the original user
  su - $SUDO_USER -c "cd $PROJECT_DIR && export NVM_DIR=\"\$HOME/.nvm\" && [ -s \"\$NVM_DIR/nvm.sh\" ] && \. \"\$NVM_DIR/nvm.sh\" && npm install"
  su - $SUDO_USER -c "cd $PROJECT_DIR/client && export NVM_DIR=\"\$HOME/.nvm\" && [ -s \"\$NVM_DIR/nvm.sh\" ] && \. \"\$NVM_DIR/nvm.sh\" && npm install --legacy-peer-deps"
else
  # Run as the app user
  su - $APP_USER -c "cd $PROJECT_DIR && export NVM_DIR=\"\$HOME/.nvm\" && [ -s \"\$NVM_DIR/nvm.sh\" ] && \. \"\$NVM_DIR/nvm.sh\" && npm install"
  su - $APP_USER -c "cd $PROJECT_DIR/client && export NVM_DIR=\"\$HOME/.nvm\" && [ -s \"\$NVM_DIR/nvm.sh\" ] && \. \"\$NVM_DIR/nvm.sh\" && npm install --legacy-peer-deps"
fi

echo "==== Setup complete! ===="
echo "You can now start the server with: npm run dev"
echo "Access the application at: http://localhost:3000"
echo "then cd ~/projects/github/nshkrdotcom/kn/client"
echo "then npm start"