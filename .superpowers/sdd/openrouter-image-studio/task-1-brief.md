# Task 1 brief — OpenRouter model catalog

Implement the catalog portion of docs/superpowers/plans/2026-08-13-openrouter-image-studio.md.

Goal: keep the static frontend model definitions, add an explicit frontend-id -> OpenRouter image model slug mapping, and derive filtered T2I/I2I catalogs. Only mapped models may appear in Image Studio. Mapping targets must be confirmed against OpenRouter's Models API filtered by output_modalities=image. I2I targets must support image input and image output. Do not implement API routes or client changes yet.

Files: modify nexoclip-app/packages/studio/src/models.js; add/extend model tests using the existing package test conventions.

Required confirmed mappings at minimum:
- nano-banana -> google/gemini-2.5-flash-image
- nano-banana-pro -> google/gemini-3-pro-image
- nano-banana-2 -> google/gemini-3.1-flash-image
- nano-banana-2-lite -> google/gemini-3.1-flash-lite-image
- gpt-image-2 -> openai/gpt-image-2
- flux-2-pro -> black-forest-labs/flux.2-pro
- flux-2-flex -> black-forest-labs/flux.2-flex
- bytedance-seedream-v4.5 -> bytedance-seed/seedream-4.5
- seedream-5.0 -> bytedance-seed/seedream-5-0-pro
- qwen-image -> qwen/qwen-image-3 (choose one exact target)

Exclude MuAPI-only tools such as ai-image-upscaler and ai-anime-generator. Do not use fuzzy runtime matching. Preserve original model objects in filtered arrays. Export OPENROUTER_IMAGE_MODEL_MAP, openRouterT2IModels, openRouterI2IModels.

Use TDD: write failing tests, run them, implement, run focused tests and relevant package suite. Inspect existing package scripts before choosing test command. Write a report to .superpowers/sdd/openrouter-image-studio/task-1-report.md with changed files, tests/outputs, concerns, and commit hashes. Commit the task changes on the current branch.
