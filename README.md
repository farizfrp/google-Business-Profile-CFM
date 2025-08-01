# Google Business Profile Review Manager

A full-stack application for managing Google Business Profile reviews and locations.

## Project Structure

```
google-business-profile-cfm/
├── frontend/          # React frontend application (tracked in git)
│   ├── src/
│   ├── public/
│   ├── package.json
│   └── ...
├── backend/           # Node.js/Express backend (hidden from git)
│   ├── server.js
│   ├── database.js
│   ├── package.json
│   └── ...
├── .gitignore         # Git ignore configuration
└── README.md         # This file
```

## Key Features

- **Frontend**: React application for managing Google Business Profile reviews
- **Backend**: Express.js server with SQLite database for storing user data, accounts, and locations
- **Authentication**: Google OAuth 2.0 integration
- **Database**: SQLite for persistent storage of user sessions, accounts, and locations
- **Multi-user Support**: Switch between different authenticated Google accounts

## Git Configuration

This project is configured so that:
- ✅ **Frontend code is tracked in git** (all React files, package.json, etc.)
- ❌ **Backend code is hidden from git** (via .gitignore)
- ✅ **Both frontend and backend are in the same project directory**

The backend directory is intentionally excluded from version control for security and deployment purposes, while the frontend remains fully tracked.

## Development Setup

### Frontend (React)
```bash
# From the project root, run the following script to start both frontend and backend:

npm run dev

# This will concurrently start the frontend (React) and backend (Node.js) servers.
# Make sure you have installed all dependencies in both `frontend` and `backend` directories first:

cd frontend && npm install
cd ../backend && npm install

# The `dev` script should be defined in your root `package.json` as:
# "dev": "concurrently \"npm start --prefix frontend\" \"npm start --prefix backend\""
```

The backend serves the frontend build files and handles API requests on port 8011.

## Environment Variables

Configure these in your backend environment:
- `GOOGLE_CLIENT_ID` - Your Google OAuth client ID
- `GOOGLE_CLIENT_SECRET` - Your Google OAuth client secret
- `REDIRECT_URI` - OAuth redirect URI (default: http://localhost:8011/auth/google/callback)
- `PORT` - Server port (default: 8011)

## Production Deployment

For production:
1. Build the frontend: `cd frontend && npm run build`
2. The backend will automatically serve the built frontend files
3. Backend and frontend run on the same port (8011)