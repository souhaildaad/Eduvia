# Performance Report - EduVia

Project: EduVia - AI-Powered Learning Platform  
Team: EduViaTeam  
Class: 4TWIN8  
Date: 2026-05-04  

## 1. Application Scope

EduVia is a fullstack education platform composed of:

- Frontend: Angular 21 deployed on Vercel.
- Backend: NestJS deployed on Render.
- Database: MongoDB.
- Main features: authentication, student dashboard, teacher dashboard, AI quiz generation, content management, planner, meet sessions, notifications, internships, clubs, and recommendations.

Production URLs:

- Frontend: https://eduvia-frontend-li1slheb8-mayarahachanis-projects.vercel.app/
- Backend: https://eduvia-backend-qne6.onrender.com

## 2. Test Environment

Recommended measurement environment:

- Browser: Chrome stable.
- Network profile: Fast 4G and Desktop broadband.
- Device profile: Desktop 1366x768 and Mobile 390x844.
- Tools: Lighthouse, Unlighthouse, Chrome DevTools Performance tab, browser Network tab, and API benchmarking with curl/Postman.

## 3. Initial State

| Indicator | Initial Value | Tool | Notes |
| --- | ---: | --- | --- |
| Lighthouse Performance | N/A | Lighthouse | No archived pre-optimization deployment was available for a reliable initial Lighthouse run. |
| First Contentful Paint | N/A | Lighthouse | Not measured before optimization because the previous deployment was failing. |
| Largest Contentful Paint | N/A | Lighthouse | Not measured before optimization because the previous deployment was failing. |
| Total Blocking Time | N/A | Lighthouse | Not measured before optimization because the previous deployment was failing. |
| Cumulative Layout Shift | N/A | Lighthouse | Not measured before optimization because the previous deployment was failing. |
| Speed Index | N/A | Lighthouse | Not measured before optimization because the previous deployment was failing. |
| Initial JS bundle size | 2.18 MB | Local Angular `dist` output | Existing local build output contained 3 JS files totaling 2,179,564 bytes; main bundle was 1.73 MB. |

## 4. Optimizations Applied

| Optimization | Area | Expected Impact |
| --- | --- | --- |
| Production Angular build enabled with `ng build --configuration production`. | Frontend build | Enables minification, optimization, output hashing, and production file replacements. |
| Added `build:prod` script for Vercel compatibility. | Deployment pipeline | Prevents deployment failure caused by missing build script. |
| Added Angular environment files. | Configuration | Ensures production frontend uses the Render backend URL. |
| Replaced hardcoded localhost API URLs for Meet. | Frontend API access | Prevents production requests from targeting local machine. |
| HTTP interceptor prefixes `/api` and `/auth` requests with production backend URL. | API routing | Allows Vercel frontend to communicate with Render backend. |
| TypeScript verification with `npx tsc -p tsconfig.app.json --noEmit`. | Build quality | Confirms imports and TypeScript compilation are valid. |

## 5. Final Performance Measurements

Run after the successful Vercel deployment.

### Lighthouse

Command:

```bash
npx lighthouse https://YOUR_FRONTEND_URL --output html --output json --output-path ./deliverables/lighthouse-eduvia
```

| Metric | Desktop | Mobile | Target |
| --- | ---: | ---: | ---: |
| Performance score | N/A | N/A | >= 80 |
| Accessibility score | N/A | N/A | >= 90 |
| Best Practices score | N/A | N/A | >= 90 |
| SEO score | N/A | N/A | >= 80 |
| First Contentful Paint | N/A | N/A | <= 1.8s |
| Largest Contentful Paint | N/A | N/A | <= 2.5s |
| Total Blocking Time | N/A | N/A | <= 200ms |
| Cumulative Layout Shift | N/A | N/A | <= 0.1 |

Final Lighthouse values were not recorded from this workstation because the public frontend deployment was still being corrected at the time of writing. The production build configuration is ready, and the table must be updated with actual Lighthouse values immediately after the successful Vercel deployment.

### Unlighthouse

Command:

```bash
npx unlighthouse --site https://YOUR_FRONTEND_URL
```

| Page | Performance | Accessibility | Best Practices | SEO | Notes |
| --- | ---: | ---: | ---: | ---: | --- |
| Login / landing | N/A | N/A | N/A | N/A | Public route; run after final Vercel deployment. |
| Student dashboard | N/A | N/A | N/A | N/A | Authenticated route; requires production test account. |
| Teacher dashboard | N/A | N/A | N/A | N/A | Authenticated route; requires production test account. |
| Admin dashboard | N/A | N/A | N/A | N/A | Authenticated route; requires production admin account. |

## 6. API Response Benchmarks

Use authenticated requests where required.

Example command:

```bash
curl -w "time_total=%{time_total}s\n" -o NUL -s https://eduvia-backend-qne6.onrender.com/auth/profile
```

| Endpoint | Method | Scenario | Average Response Time | P95 | Status |
| --- | --- | --- | ---: | ---: | --- |
| `/auth/login` | POST | User login | N/A | N/A | Requires production test credentials. |
| `/auth/profile` | GET | Profile loading | N/A | N/A | Requires bearer token. |
| `/api/contents` | GET | Course content list | N/A | N/A | Requires stable backend connectivity and sample data. |
| `/api/student/dashboard` | GET | Student dashboard data | N/A | N/A | Requires authenticated student token. |
| `/api/meet/sessions` | GET | Meet sessions list | N/A | N/A | Public benchmark attempt failed from workstation due TLS/connection close. |
| `/api/internships` | GET | Internship list | N/A | N/A | Public benchmark attempt failed from workstation due TLS/connection close. |

Backend benchmark note: attempts from the local Windows workstation to `https://eduvia-backend-qne6.onrender.com` failed with the error "underlying connection was closed: unexpected error during receive". Measurements should be rerun from a browser, Postman, or a CI environment once the Render backend is confirmed healthy.

## 7. Deployment Stability

| Item | Status | Evidence |
| --- | --- | --- |
| Frontend deployed on Vercel | In progress | Vercel project exists; final successful deployment URL must be captured after redeploy. |
| Backend deployed on Render | In progress | Backend URL configured as `https://eduvia-backend-qne6.onrender.com`; Render health still needs confirmation. |
| Environment variables configured | Partially complete | Frontend production environment points to Render backend; Render secrets must be verified in dashboard. |
| Production build command works | Configured | `package.json` includes `build` and `build:prod`, both running `ng build --configuration production`. |
| API requests target production backend | Configured | Angular HTTP interceptor prefixes `/api` and `/auth` requests with `environment.backendUrl`. |

## 8. Conclusion

The main production-readiness work focused on stabilizing the Angular production build and connecting the frontend deployment to the Render backend. The project now has the required production build scripts, production Angular environment configuration, and API routing toward the deployed backend. Final Lighthouse, Unlighthouse, and authenticated API measurements must be captured from the live Vercel deployment once the deployment is successful.
