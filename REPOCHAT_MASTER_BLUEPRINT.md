# REPOCHAT_MASTER_BLUEPRINT

## Project Name
RepoChat

## Product Positioning
GitHub Repository Intelligence Platform

## Primary Goal
Build a strong portfolio project focused on:
- RAG
- LLM applications
- Software architecture understanding
- Modern SaaS UI/UX
- Security-first engineering

## Target Users
- Students
- Developers
- Recruiters

## V1 Scope
- Public GitHub repositories only
- Analyze repository once
- Chat instantly after indexing
- Repository summary
- Architecture overview
- Repository statistics
- File citations
- Line-number citations
- Modern SaaS UI
- Light/Dark mode

## Future Scope
- Google Login
- PDF Export
- Multi-repository support
- GitLab support
- Saved repositories

## Core Flow
Landing Page
→ Paste GitHub URL
→ Repository Validation
→ Repository Analysis
→ Chunking
→ Embeddings
→ ChromaDB
→ Repository Summary
→ Architecture Overview
→ Chat Interface
→ Source-Cited Answers

## UI/UX
Style:
- ChatGPT inspired
- Vercel inspired
- Linear inspired

Animations:
- Floating code blocks
- Smooth gradients
- Hover effects
- Scroll reveal animations

Theme:
- Light mode
- Dark mode

## Tech Stack

Frontend:
- Next.js
- React
- TypeScript
- Tailwind CSS
- Framer Motion

Backend:
- FastAPI

LLM:
- Gemini Free Tier

Embeddings:
- Gemini Embeddings

Vector Database:
- ChromaDB

Database:
- SQLite

Repository Access:
- GitHub API

## Storage Rules

SQLite:
- Repository metadata only
- Analysis metadata only

Do NOT store:
- Chat history
- User accounts
- Personal information

ChromaDB:
- Code chunks
- Embeddings
- Retrieval data

## Security Rules

- Never hardcode secrets
- Use .env
- Add .env to .gitignore
- Validate all inputs
- Add rate limiting
- Add security headers
- Protect against prompt injection
- Safe error handling
- No secrets in logs

## Repository Limits

- Public GitHub repositories only
- Maximum 500 files
- Maximum 50MB repository size

Ignore:
- node_modules
- build folders
- binaries
- images
- videos

## Chat Requirements

Answers must include:
- Short answer
- Detailed explanation
- Code snippets
- Referenced files
- Referenced line numbers
- Follow-up suggestions

## Development Principles

1. Security first
2. Reliability first
3. Simplicity over complexity
4. Modular architecture
5. Retrieval before generation
6. Source-cited answers only
7. Recruiter-friendly quality

## Success Criteria

A user can:
1. Paste a GitHub repository URL.
2. Analyze the repository.
3. View repository statistics.
4. View architecture overview.
5. Ask questions.
6. Receive source-cited answers.
