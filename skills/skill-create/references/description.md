# The description

pi puts every skill's `name` and `description` in the system prompt. The model decides from the
description alone whether to read the skill, so it is the most important line of the skill.

## Shape

`<What it does, with the key terms>. Use when <triggers>.`

- **What**: the job and the objects involved, with the words a user would use (`Azure DevOps
  pipelines`, `YAML templates`, `worktrees`, `pull requests`).
- **When**: the situations and requests that should load it. Name the actions (`create`, `fix`,
  `review`) and the inputs (`azure-pipelines.yml`, `a failing pipeline run`).
- At most 1024 characters; usually one to three sentences.

## Examples

Good:

> Write, review and debug Azure DevOps YAML pipelines and templates - stages, jobs, expressions,
> variables, service connections. Use when editing `azure-pipelines.yml` or pipeline templates, or
> when a pipeline run fails.

Too vague (the model cannot tell when it applies):

> Helps with pipelines.

## Only on request

For skills with side effects that must not start by themselves, set
`disable-model-invocation: true` and end the description with `Run only on request via /<name>.`
(with a prompt template `prompts/<name>.md`) or `via /skill:<name>`.

## Check

- Read only the description: would you load the skill for each trigger from the intake?
- Would you wrongly load it for a nearby task? Then name what it is not for.
