# docuwise-ai-server
Node.js REST API powering an AI document intelligence portal. Integrates Azure Document Intelligence for OCR and data extraction, Azure OpenAI for document Q&amp;A, Azure Cognitive Search for full-text search, and Azure Blob Storage for file management. Built with Express, MongoDB, and JWT authentication.

## Stage 1 (implemented)
- TypeScript Express server bootstrap
- MongoDB connection and environment validation
- Auth endpoints: `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`
- Health endpoint: `GET /api/health`
- JWT token stored in an `httpOnly` cookie

## Run locally
1. Copy `.env.example` to `.env` and fill values.
2. Install dependencies: `npm install`
3. Start dev server: `npm run dev`
