# MEXEM Marketing Translator

Internal MVP for marketing translation and localization.

## Goals
- Convert source marketing copy into localized marketing copy.
- Respect locale, persona, tone, brand terminology, compliance, CTA intent, and length constraints.
- Provide a clean extensible architecture for frontend, backend, AI orchestration, glossary, and validation.

## Tech Stack
- Frontend: React + Vite + TypeScript
- Backend: Node.js + Express + TypeScript
- AI orchestration: backend prompt service with OpenAI
- Storage: Prisma + SQLite for MVP (easily switch to PostgreSQL)

## Quick start
1. Copy `.env.example` to `.env`.
2. Install packages: `npm install`
3. Generate Prisma client: `npm run prisma:generate`
4. Start backend: `npm run dev:backend`
5. Start frontend: `npm run dev:frontend`

## Phase 1 MVP
- Source text input
- Locale, text type, persona, tone selection
- Length constraint support
- AI translation + localization pipeline
- Basic output validation and scoring
- Glossary / terminology management structure
