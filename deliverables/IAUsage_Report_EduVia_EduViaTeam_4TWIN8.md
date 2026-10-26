# AI Usage Report - EduVia

Project: EduVia - AI-Powered Learning Platform  
Team: EduViaTeam  
Class: 4TWIN8  
Date: 2026-05-04  

## 1. Purpose

This document explains how Artificial Intelligence tools were used during the EduVia project. The objective is transparency: AI was used as an assistant for development, debugging, documentation, and deployment support, while the team remained responsible for validating and integrating the final work.

## 2. AI Tools Used

| Tool | Model / Agent | Usage |
| --- | --- | --- |
| ChatGPT / Codex | GPT-5 coding agent | Code inspection, debugging, deployment fixes, documentation drafting, Git workflow support. |
| ChatGPT | LLM assistant | Explanation of errors, generation of checklists, report structure, and deployment troubleshooting. |
| GitHub Copilot | TODO - confirm if used | TODO - add if the team used it for code completion. |
| Other tools | TODO | Add Claude, Gemini, Cursor, or other tools if used. |

## 3. Tasks Assisted by AI

| Task Category | AI Assistance | Human Validation |
| --- | --- | --- |
| Code generation | Suggested Angular/NestJS changes and configuration fixes. | Team reviewed code and tested locally or through deployment. |
| Debugging | Interpreted Render and Vercel deployment errors. | Team confirmed logs and redeployed. |
| Documentation | Drafted performance, accessibility, and AI usage reports. | Team must complete final measured values and screenshots. |
| Deployment | Helped configure Angular production build, Vercel scripts, and backend URL environment. | Team pushed commits and verified Vercel/Render deployment status. |
| Git workflow | Prepared commits and pushed changes to `master` and `main`. | Team should confirm GitHub branch settings and Vercel source branch. |

## 4. Examples of Prompts Used

The following prompts summarize the real assistance requested during the final deployment phase:

1. "The Render NestJS build succeeds but deployment exits with status 1. Analyze possible causes and fix the configuration."
2. "Angular frontend deployment on Vercel fails during npm ci / build. Check package.json and production build command."
3. "Add `ng build --configuration production` to the Angular build script."
4. "Push this modification to GitHub."
5. "Verify `environment.prod.ts` and configure backendUrl for production."
6. "Vercel runs `npm run build:prod` and fails because the script is missing. Add the missing script and push."
7. "Push all latest modifications to main."
8. "Prepare the mandatory performance, accessibility, deployment, and AI usage deliverables."

## 5. AI-Generated Changes Reviewed

| Change | Files / Area | Reason |
| --- | --- | --- |
| Added production build script. | `EduVia-Frontend/package.json` | Vercel required a valid production build command. |
| Added `build:prod` alias. | `EduVia-Frontend/package.json` | Vercel was configured to run `npm run build:prod`. |
| Added Angular environment files. | `src/environments/environment.ts`, `src/environments/environment.prod.ts` | Production frontend needed the Render backend URL. |
| Added production file replacement. | `angular.json` | Angular must use production environment values during production build. |
| Updated HTTP interceptor. | `auth.interceptor.ts` | Relative `/api` and `/auth` calls needed to target the deployed backend. |
| Updated hardcoded Meet backend URLs. | Student and teacher dashboard components | Prevented production frontend from calling `localhost:3000`. |

## 6. Responsible AI Use

The team used AI as an assistant, not as an unchecked replacement for engineering work. The following practices were applied:

- Deployment logs were reviewed before applying changes.
- Generated code changes were kept small and focused.
- TypeScript validation was executed with `npx tsc -p tsconfig.app.json --noEmit`.
- Git diffs were checked before commits.
- No secret values were intentionally exposed in documentation.
- Final performance and accessibility scores must be measured from deployed URLs, not invented.

## 7. Limitations

AI assistance may produce incomplete or context-dependent suggestions. For this reason:

- All generated code must be tested in the real production environment.
- Performance and accessibility metrics must be collected with official tools.
- The final team must verify environment variables, deployment branch, and URLs before submission.

## 8. Final Statement

AI tools contributed to debugging, configuration, documentation, and deployment support. The EduVia team remains responsible for validating all outputs, completing measured report values, and ensuring the deployed application is stable and accessible during the commercial evaluation.
