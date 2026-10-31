# 3. Analyse

1. Run:

   ```sh
   scripts/analyse.sh <dir> <skill-dir>
   ```

   `<dir>` is the output of step 2. `<skill-dir>` is the skill **in the pi-skills repository**
   (`~/private/pi-skills/skills/<name>`), so the model judges the current text.
2. The script gives the model the skill (all Markdown files and the script names) and the digests,
   with the instructions in `assets/analyst.md`. The model has no tools. Large sets are split into
   parts and merged with `assets/merge.md`. The result is `<dir>/report.md`.
3. The default model is `openai-codex/gpt-6-luna` with thinking `high`. Override with
   `--model`/`--thinking`, or `PI_SKILL_REVIEW_MODEL`/`PI_SKILL_REVIEW_THINKING`. Use another
   model only when the user asks, or when the default fails.
4. If the script fails, see `references/scripts.md`.
