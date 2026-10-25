# Local Python experiment

These are James's preserved FastAPI/Anthropic experiments, moved from the root
`api/` directory so Vercel cannot discover them as production functions.
Their requirements file moved here unchanged; it is not used by `npm ci` or
the frontend build. It still contains invalid pip entries (`json`, `textwrap`,
`os` are Python standard-library modules), so this is not a supported install
manifest. Fix and review it separately before attempting local Python setup.

The deployed application uses `src/assistant/AssistantChat.tsx` and Convex
`chat.ts`/`chatAgent.ts` for Claude requests and persistence. No Python server is
needed, and no paid Python endpoints should be deployed. The sibling repository
`backend/` directory is also experimental and excluded by `.vercelignore`.

Do not place API keys in source or any `VITE_*` variable. Do not move these
files back into root `api/` as part of frontend deployment.
