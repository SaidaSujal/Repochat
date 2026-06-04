# RepoChat AI Agent Instructions

Read this file before generating code.

## Primary Goal
Build a secure, production-quality RepoChat application.

## Mandatory Requirements
- Never hardcode secrets.
- Use .env and .gitignore.
- Follow PROJECT_RULES.md.
- Follow SECURITY_RULES.md.
- Follow PRD.md.

## RAG Requirements
- Retrieval required before answering.
- No hallucinated answers.
- Show file citations.
- Show line references when available.

## Security Requirements
- Input validation.
- Rate limiting.
- Prompt injection protection.
- Secure error handling.
- No sensitive information in logs.

## Code Generation Rules
- Create small modules.
- Avoid duplicate logic.
- Write maintainable code.
- Prefer security over convenience.
