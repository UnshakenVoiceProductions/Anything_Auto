# Anything Automotive

Consumer-facing website for Anything Automotive LLC with a live Ask Chris serverless endpoint for Vercel.

## Environment variables

Set these in Vercel Project Settings before going live:

- `OPENAI_API_KEY`
- `OPENAI_MODEL` (recommended)
- `ANTHROPIC_API_KEY`
- `ANTHROPIC_MODEL` (recommended)
- `ASK_CHRIS_ESCALATION_EMAIL`

Recommended value for `ASK_CHRIS_ESCALATION_EMAIL`:

- `askchris@anythingautomotivepa.com`

## Ask Chris routing

The Ask Chris endpoint uses a simple provider router:

- shorter / straightforward questions prefer OpenAI first
- longer / more layered questions prefer Anthropic first
- if the first provider fails, the other provider is tried automatically

## Deployment

This repository is intended to be connected to Vercel so the static site and `/api/ask-chris` function deploy together.
