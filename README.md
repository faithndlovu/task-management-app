# TaskFlow — Task Management Application

A full-stack task management system with a **REST API**, **role-based access control** and an **enforced task workflow**. Built with Node.js, Express and SQLite, with a dependency-free JavaScript web front end.

## Features

- **Authentication**: register and sign in with hashed passwords (bcrypt) and JWT bearer tokens.
- **User roles**
  | Role | Can do |
  |---|---|
  | **Admin** | Everything: manage all users and roles, see and manage every project |
  | **Manager** | Create projects, add/remove members, create/edit/assign/delete tasks, approve or reject work |
  | **Member** | See projects they belong to, move tasks assigned to them, comment |
- **Projects**: full CRUD, membership management, progress tracking.
- **Tasks**: full CRUD with priority, due dates, assignees, search and filters, overdue detection.
- **Workflow engine**: `To do → In progress → In review → Done`. Members can submit work for review, but only managers and admins can approve it (review → done), send it back (review → in progress) or reopen it. Invalid transitions are rejected with HTTP 422.
- **Audit trail**: every status change is recorded with who made it, when, and an optional note.
- **Comments** on tasks.
- **Dashboard**: totals, overdue count, completion rate and a workflow breakdown.
- **Kanban board** with drag and drop (the server still enforces the workflow rules).
- **Tests**: 11 API integration tests using Node's built-in test runner and Supertest.

## Tech stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 22.13+ |
| API | Express 5 |
| Database | SQLite via Node’s built-in `node:sqlite` (no native modules to compile) |
| Auth | `bcryptjs`, `jsonwebtoken` |
| Front end | HTML, CSS and vanilla JavaScript (no build step) |
| Tests | `node:test` and `supertest` |

## Getting started

You need **Node.js 22.13 or newer** (check with `node -v`).

```bash
npm install
cp .env.example .env      # optional: set JWT_SECRET, PORT
npm run seed              # optional: load demo data
npm start                 # http://localhost:3000
```

**Demo accounts** (after `npm run seed`), all with the password `Password123!`:

- `admin@example.com` (Admin)
- `manager@example.com` (Manager)
- `member@example.com` (Member)

Without seeding, the **first account you register becomes the admin**. Later accounts start as members, and the admin can promote them from the Users page.

Run the tests:

```bash
npm test
```

## REST API

All endpoints except register, login and health need the header `Authorization: Bearer <token>`.

| Method | Endpoint | Description | Roles |
|---|---|---|---|
| POST | `/api/auth/register` | Create an account | public |
| POST | `/api/auth/login` | Get a JWT | public |
| GET | `/api/auth/me` | Current user | any |
| GET | `/api/users` | List users | any |
| PATCH | `/api/users/:id/role` | Change role | admin |
| DELETE | `/api/users/:id` | Delete user | admin |
| GET | `/api/projects` | Projects visible to you | any |
| POST | `/api/projects` | Create project | admin, manager |
| GET / PUT / DELETE | `/api/projects/:id` | Read / update / delete | participant / manager / owner |
| POST | `/api/projects/:id/members` | Add member | project manager |
| DELETE | `/api/projects/:id/members/:userId` | Remove member | project manager |
| GET | `/api/tasks` | List tasks. Filters: `project_id, status, priority, assignee_id, mine=1, q, overdue=1` | any |
| POST | `/api/tasks` | Create task | project manager |
| GET | `/api/tasks/:id` | Task with history, comments and allowed transitions | participant |
| PUT | `/api/tasks/:id` | Edit details | project manager |
| PATCH | `/api/tasks/:id/status` | Move through workflow `{ status, note }` | assignee or manager |
| DELETE | `/api/tasks/:id` | Delete task | project manager |
| POST | `/api/tasks/:id/comments` | Add comment | participant |
| GET | `/api/stats` | Dashboard statistics | any |

Example:

```bash
curl -X POST localhost:3000/api/auth/login -H "Content-Type: application/json" \
  -d '{"email":"manager@example.com","password":"Password123!"}'
```

## Project structure

```
src/
  app.js          Express app (routes, static files, error handling)
  server.js       Entry point
  db.js           SQLite schema
  auth.js         JWT helpers and role middleware
  access.js       Project/task permission rules
  workflow.js     Status transition rules
  seed.js         Demo data
  routes/         auth, users, projects, tasks
public/           Single-page web client
tests/            API integration tests
```

## License

MIT
