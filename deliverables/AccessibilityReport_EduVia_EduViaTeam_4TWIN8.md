# Accessibility Audit - EduVia

Project: EduVia - AI-Powered Learning Platform  
Team: EduViaTeam  
Class: 4TWIN8  
Date: 2026-05-04  
Standard: WCAG 2.1 / 2.2  
Target level: AA where possible, A minimum for mandatory flows.

## 1. Audit Scope

The accessibility audit covers the main user journeys:

- Authentication and login.
- Student dashboard.
- Teacher dashboard.
- Admin dashboard.
- Course content browsing.
- Quiz interaction.
- Planner and reminders.
- Meet sessions.
- Notifications.

## 2. Tools Used

Recommended tools:

- Lighthouse Accessibility audit.
- axe DevTools browser extension.
- WAVE Web Accessibility Evaluation Tool.
- Manual keyboard navigation checks.
- Chrome DevTools color contrast checks.

## 3. WCAG Compliance Summary

| Area | Target | Current Status | Notes |
| --- | --- | --- | --- |
| Perceivable | WCAG A/AA | TODO | Verify text alternatives, contrast, responsive layout. |
| Operable | WCAG A/AA | TODO | Verify keyboard access and focus visibility. |
| Understandable | WCAG A/AA | TODO | Verify labels, error messages, consistent navigation. |
| Robust | WCAG A/AA | TODO | Verify semantic HTML and ARIA usage. |

Overall compliance level achieved: TODO - A / AA after final audit.

## 4. Automated Audit Results

### Lighthouse Accessibility

| Page | Score | Main Issues |
| --- | ---: | --- |
| Login | TODO | TODO |
| Student dashboard | TODO | TODO |
| Teacher dashboard | TODO | TODO |
| Admin dashboard | TODO | TODO |

### axe / WAVE Results

| Page | Critical | Serious | Moderate | Minor | Status |
| --- | ---: | ---: | ---: | ---: | --- |
| Login | TODO | TODO | TODO | TODO | TODO |
| Student dashboard | TODO | TODO | TODO | TODO | TODO |
| Teacher dashboard | TODO | TODO | TODO | TODO | TODO |
| Admin dashboard | TODO | TODO | TODO | TODO | TODO |

## 5. Manual WCAG Checklist

| Criterion | Level | Result | Evidence / Notes |
| --- | --- | --- | --- |
| 1.1.1 Non-text Content | A | TODO | Images and icons need meaningful labels or decorative treatment. |
| 1.3.1 Info and Relationships | A | TODO | Check headings, form grouping, and table semantics. |
| 1.4.3 Contrast Minimum | AA | TODO | Verify text contrast with DevTools or WAVE. |
| 1.4.10 Reflow | AA | TODO | Test at 320px width without horizontal scrolling. |
| 2.1.1 Keyboard | A | TODO | All interactive controls must be reachable by keyboard. |
| 2.4.3 Focus Order | A | TODO | Check modals, sidebars, tabs, dropdowns. |
| 2.4.7 Focus Visible | AA | TODO | Ensure clear focus indicator on buttons, links, inputs. |
| 3.2.3 Consistent Navigation | AA | TODO | Dashboards should keep stable navigation patterns. |
| 3.3.1 Error Identification | A | TODO | Forms should show clear validation messages. |
| 4.1.2 Name, Role, Value | A | TODO | Custom controls need accessible names and roles. |

## 6. Detected Issues

| ID | Page / Component | Issue | WCAG Criterion | Severity | Corrective Measure | Status |
| --- | --- | --- | --- | --- | --- | --- |
| A11Y-001 | TODO | TODO | TODO | TODO | TODO | TODO |
| A11Y-002 | TODO | TODO | TODO | TODO | TODO | TODO |
| A11Y-003 | TODO | TODO | TODO | TODO | TODO | TODO |

## 7. Corrective Measures Implemented

Document fixes applied before final evaluation:

| Fix | Component | Impact |
| --- | --- | --- |
| TODO | TODO | TODO |

Recommended corrective actions before submission:

- Add `aria-label` or visible labels to icon-only buttons.
- Ensure every modal traps focus and returns focus on close.
- Verify contrast for red, gray, and gradient areas.
- Add alternative text for meaningful images such as logos and avatars.
- Use semantic headings in dashboard sections.
- Ensure form validation messages are linked to fields.

## 8. Final Accessibility Statement

EduVia targets WCAG AA for the main educational workflows. Remaining issues, if any, must be documented with severity and justification. Final compliance level should be confirmed after running Lighthouse, axe, WAVE, and keyboard navigation tests on the deployed production URL.
