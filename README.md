# Anything Automotive

Consumer-facing website for Anything Automotive LLC with:

- live Ask Chris serverless endpoint
- optional live Google review and hours feed
- Vercel deployment support

## Required environment variables

Set these in Vercel Project Settings before going live:

- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `ANTHROPIC_API_KEY`
- `ANTHROPIC_MODEL`
- `ASK_CHRIS_ESCALATION_EMAIL`

Recommended value:

- `ASK_CHRIS_ESCALATION_EMAIL=askchris@anythingautomotivepa.com`

## Optional Google listing variables

Add these to show live Google reviews, rating totals, and Google listing hours:

- `GOOGLE_MAPS_API_KEY`
- `GOOGLE_PLACE_TEXT_QUERY`

Recommended value:

- `GOOGLE_PLACE_TEXT_QUERY=Anything Automotive LLC 201 Cowanshannock Ave Rural Valley PA 16249`

## Ask Chris routing

The Ask Chris endpoint uses a simple provider router:

- shorter or straightforward questions prefer OpenAI first
- longer or more layered questions prefer Anthropic first
- if the first provider fails, the other provider is tried automatically

## Deployment

This repository is intended to be connected to Vercel so the static site and `/api` functions deploy together.
