# LLMS Exporter

Generates a compact knowledge bundle for AI agents. Running `pnpm --filter applesauce-llms build` copies the docs into `dist/docs`, converts every example under `apps/examples/src/examples` into Markdown inside `dist/examples`, and writes an aggregated `dist/llms.txt`/`dist/llms.md` that link everything together. Use this when you need to hand an agent a one-stop summary of Applesauce.

Customize the root summary by editing `apps/llms/src/template.md`. The placeholders (`{{generatedAt}}`, `{{docsIndex}}`, `{{examplesIndex}}`) get replaced during the build so you can add bespoke instructions around the dynamic sections without touching the script.
