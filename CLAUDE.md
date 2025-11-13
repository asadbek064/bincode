# CLAUDE.md - AI Assistant Guide for BinCode

## Project Overview

**BinCode** is a self-hostable, minimalist code snippet sharing platform (JSFiddle alternative). It enables users to create, edit, and share HTML/CSS/JavaScript snippets with live preview and instant sharing capabilities.

### Core Characteristics
- **Zero-build architecture**: No compilation, bundling, or transpilation required
- **Self-contained**: All dependencies vendored, no external CDN dependencies
- **Security-first**: Multiple layers of XSS prevention, rate limiting, JWT auth
- **Manual user management**: Admins create accounts via CLI (no self-signup)
- **Privacy-focused**: Self-hosted SQLite database, full data control

### Technology Stack
- **Frontend**: Vue.js 3.5.13 (vanilla, no build step)
- **Backend**: Node.js with Express.js 4.18.2
- **Database**: SQLite3 5.1.6
- **Authentication**: JWT with bcrypt password hashing
- **Package Manager**: pnpm

---

## Repository Structure

```
bincode/
├── config/               # Configuration layer
│   ├── index.js         # Config aggregator
│   ├── database.js      # Database config (dev/prod)
│   └── jwt.js           # JWT settings
│
├── db/                  # Database layer
│   ├── connect.js       # SQLite connection & schema initialization
│   └── queries.js       # SQL query definitions
│
├── middleware/          # Express middleware
│   ├── index.js         # Middleware aggregator
│   ├── auth.js          # JWT authentication
│   ├── validation.js    # Input validation & sanitization
│   └── error.js         # Centralized error handling
│
├── routes/              # API routes
│   ├── index.js         # Route aggregator
│   ├── auth.js          # POST /api/auth/login
│   └── snippets.js      # POST /api/snippets, GET /api/snippets/share/:shareId
│
├── services/            # Business logic layer
│   ├── auth.js          # Authentication services
│   └── snippets.js      # Snippet CRUD operations
│
├── utils/               # Utilities
│   ├── security.js      # Security helpers
│   └── logger.js        # Winston logger (present but unused)
│
├── public/              # Frontend static files (served by Express)
│   ├── index.html       # Single-page application HTML
│   ├── app.js           # Complete Vue.js application (619 lines)
│   ├── style.css        # Main stylesheet
│   ├── font.css         # System font stack definitions
│   ├── libraries/       # Vendored third-party libraries
│   │   ├── vue/         # Vue.js dev & prod builds
│   │   ├── prism/       # Syntax highlighter
│   │   └── eruda/       # In-browser console debugger
│   └── logo/            # Favicon and branding assets
│
├── server.js            # Main Express server entry point
├── addUser.js           # CLI tool for manual user creation
└── package.json         # Dependencies and scripts
```

---

## Architecture Patterns

### 1. Layered Backend Architecture
```
Client Request
    ↓
Express Routes (/routes)
    ↓
Middleware (/middleware)
    ├── Authentication (JWT validation)
    ├── Validation (input sanitization)
    └── Error handling
    ↓
Services (/services)
    ↓
Database Layer (/db)
    ↓
SQLite Database
```

### 2. Frontend Architecture
- **Single-component Vue.js app**: No routing, all state in one component (app.js)
- **No build process**: Vanilla Vue.js loaded from local file
- **Live code editor**: Three-tab editor (HTML/CSS/JS) with syntax highlighting
- **Resizable panels**: Custom drag-to-resize implementation
- **Live preview**: Debounced iframe updates (500ms)
- **Embedded console**: Eruda debugger for in-preview debugging

### 3. Security Layers
1. **Rate limiting**: 1000 requests per 2 minutes per IP (server.js:18)
2. **JWT authentication**: Bearer tokens with configurable expiry
3. **Password hashing**: bcrypt with 10 rounds
4. **Input validation**: Email, password, title, code length checks
5. **XSS sanitization**: Multiple libraries (xss, sanitize-html, validator)
6. **Content size limits**: 500KB max per snippet
7. **SQL injection prevention**: Parameterized queries throughout

---

## Database Schema

### Users Table (db/connect.js:39-43)
```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,           -- nanoid generated
  email TEXT UNIQUE NOT NULL,    -- unique email address
  password TEXT NOT NULL         -- bcrypt hashed (10 rounds)
)
```

### Snippets Table (db/connect.js:45-56)
```sql
CREATE TABLE snippets (
  id TEXT PRIMARY KEY,                    -- nanoid generated
  user_id TEXT NOT NULL,                  -- foreign key to users
  title TEXT NOT NULL,                    -- snippet title
  html TEXT,                              -- HTML code
  css TEXT,                               -- CSS code
  js TEXT,                                -- JavaScript code
  share_id TEXT UNIQUE NOT NULL,          -- 10-char nanoid for sharing
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id)
)
```

**Important**: Foreign key enforcement is enabled via `PRAGMA foreign_keys = ON` (db/connect.js:21)

---

## Development Workflows

### Initial Setup
```bash
# Clone and install
git clone <repository-url>
cd bincode
pnpm install

# Configure environment
cp .env.example .env
# Edit .env with:
#   NODE_ENV=development
#   PORT=3000
#   JWT_SECRET=your-secure-secret
#   JWT_EXPIRES_IN=7d

# Create first user
node addUser.js "admin@example.com" "password"
```

### Development Mode
```bash
# Start dev server with auto-reload
pnpm dev

# CRITICAL: For development, edit public/index.html:158
# Change from: <script src="./libraries/vue/vuejs_3.5.13_prod.js"></script>
# To:         <script src="./libraries/vue/vuejs_3.5.13_dev.js"></script>
```

**Why switch Vue.js builds?**
- **Dev build**: Includes debugging tools, warnings, better error messages
- **Prod build**: Optimized, smaller, faster (but no dev warnings)

### Production Deployment
```bash
# 1. Configure production environment (.env)
NODE_ENV=production
PORT=3000
JWT_SECRET=<generate-secure-random-secret>
JWT_EXPIRES_IN=7d

# 2. Switch to production Vue.js build (index.html:158)
# Change to: <script src="./libraries/vue/vuejs_3.5.13_prod.js"></script>

# 3. Start production server
pnpm start
```

### User Management
```bash
# Add new user (only way to create accounts)
node addUser.js "user@example.com" "secure-password"

# User ID is auto-generated with nanoid
# Password is hashed with bcrypt (10 rounds)
```

---

## API Reference

### Authentication Endpoints

**POST /api/auth/login**
- **Purpose**: User authentication
- **Auth Required**: No
- **Request Body**:
  ```json
  {
    "email": "user@example.com",
    "password": "password"
  }
  ```
- **Response**:
  ```json
  {
    "token": "jwt-token-here"
  }
  ```
- **Validation**: Email format, password length 4-100 chars
- **Implementation**: routes/auth.js

### Snippet Endpoints

**POST /api/snippets**
- **Purpose**: Create new code snippet
- **Auth Required**: Yes (JWT Bearer token)
- **Request Headers**: `Authorization: Bearer <token>`
- **Request Body**:
  ```json
  {
    "title": "My Snippet",
    "html": "<div>Hello</div>",
    "css": "div { color: red; }",
    "js": "console.log('Hello');"
  }
  ```
- **Response**:
  ```json
  {
    "shareId": "abc123xyz0"
  }
  ```
- **Validation**:
  - Title: max 200 characters
  - Combined code size: max 500KB
  - XSS sanitization applied
- **Implementation**: routes/snippets.js, services/snippets.js

**GET /api/snippets/share/:shareId**
- **Purpose**: Retrieve shared snippet by share ID
- **Auth Required**: No (public)
- **Response**:
  ```json
  {
    "title": "My Snippet",
    "html": "<div>Hello</div>",
    "css": "div { color: red; }",
    "js": "console.log('Hello');"
  }
  ```
- **Implementation**: routes/snippets.js:41, services/snippets.js:70

---

## Code Conventions

### Backend Conventions

1. **File Organization**
   - One responsibility per file
   - Aggregator pattern: index.js files export all related modules
   - Example: middleware/index.js exports all middleware

2. **Error Handling**
   - Use try-catch in async route handlers
   - Pass errors to next(error) for centralized handling
   - Error middleware formats responses (middleware/error.js)
   - Different verbosity for dev vs prod environments

3. **Database Queries**
   - All queries defined in db/queries.js as constants
   - Use parameterized queries (? placeholders) to prevent SQL injection
   - Use db.get() for single row, db.run() for insert/update
   - Example pattern:
     ```javascript
     db.get(queries.GET_USER_BY_EMAIL, [email], (err, user) => {
       // handle result
     });
     ```

4. **Service Layer Pattern**
   - Business logic belongs in /services, not routes
   - Services return promises
   - Services handle database operations
   - Routes handle HTTP concerns only

5. **Validation**
   - Validation happens in middleware before reaching services
   - Use validator library for email/string validation
   - Use xss and sanitize-html for content sanitization
   - Size limits enforced at validation layer

6. **Security Practices**
   - Never log passwords or tokens
   - Always hash passwords with bcrypt before storage
   - JWT tokens stored in client's localStorage
   - Rate limiting applied globally to all routes

### Frontend Conventions

1. **Vue.js Patterns**
   - Single reactive data object in app.js
   - Computed properties for derived state
   - Methods for event handlers
   - Watchers for side effects (e.g., localStorage sync)

2. **Code Editor Implementation**
   - Textarea for input (maintains cursor position)
   - Pre element for syntax highlighting (overlay)
   - Synchronized scrolling between layers
   - Tab key inserts 2 spaces (preventDefault)

3. **Live Preview**
   - Iframe contains preview (isolated execution context)
   - Iframe recreated on each update (prevents state leaks)
   - 500ms debounce on preview updates (performance)
   - Execution can be paused via toggle

4. **Theme Support**
   - Detects system color scheme: `window.matchMedia('(prefers-color-scheme: dark)')`
   - Listens for theme changes in real-time
   - Auto-loads appropriate Prism.js theme

5. **Keyboard Shortcuts**
   - Ctrl+S: Save snippet
   - Ctrl+1: Switch to HTML tab
   - Ctrl+2: Switch to CSS tab
   - Ctrl+3: Switch to JavaScript tab
   - Implemented in app.js:570-587

---

## Testing

**Current Status**: No testing infrastructure exists

**Recommendations for Adding Tests**:
1. **Unit tests**: Jest for services and utilities
2. **Integration tests**: Supertest for API routes
3. **E2E tests**: Playwright for frontend workflows
4. **Database tests**: In-memory SQLite for fast tests

**Areas to Test**:
- Authentication flow (login, JWT validation)
- Snippet creation and retrieval
- Input validation and sanitization
- XSS prevention
- Rate limiting
- Database constraints (unique emails, foreign keys)

---

## Common Tasks for AI Assistants

### Adding a New API Endpoint

1. **Define route** in appropriate file under /routes
   ```javascript
   router.post('/new-endpoint', authMiddleware, validateInput, async (req, res, next) => {
     try {
       const result = await someService.doSomething(req.body);
       res.json(result);
     } catch (error) {
       next(error);
     }
   });
   ```

2. **Add validation** in middleware/validation.js if needed

3. **Implement service** in /services
   ```javascript
   async function doSomething(data) {
     return new Promise((resolve, reject) => {
       db.run(queries.SOME_QUERY, [data], function(err) {
         if (err) reject(err);
         else resolve({ id: this.lastID });
       });
     });
   }
   ```

4. **Add SQL query** to db/queries.js
   ```javascript
   SOME_QUERY: 'INSERT INTO table_name (column) VALUES (?)'
   ```

5. **Export from aggregator** (routes/index.js or services/index.js)

### Modifying Database Schema

1. **Edit db/connect.js** - modify CREATE TABLE statements
2. **Delete existing database**: `rm bincode.db playground.db`
3. **Restart server**: Database recreated automatically
4. **Re-add users**: `node addUser.js email password`

**Warning**: This deletes all data. For production, use migrations.

### Adding Frontend Features

1. **Modify app.js**: Add data properties, methods, computed properties
2. **Modify index.html**: Update template markup
3. **Modify style.css**: Add styles
4. **No build step required**: Changes reflect immediately on refresh

### Adding Security Measures

1. **Input validation**: Add to middleware/validation.js
2. **Authentication**: Protected routes use authMiddleware (middleware/auth.js)
3. **Sanitization**: Use xss() or sanitizeHtml() from utils/security.js
4. **Rate limiting**: Adjust limits in server.js:18

---

## Important Gotchas and Considerations

### 1. Vue.js Dev/Prod Build Switching
**Location**: public/index.html:158

- **Must manually switch** between dev and prod builds
- No automated build process handles this
- Forgetting to switch causes:
  - Dev build in prod: Larger bundle, slower performance
  - Prod build in dev: No debug warnings, harder troubleshooting

### 2. Manual User Management
- **No self-signup**: Users cannot register themselves
- **CLI only**: Must use `node addUser.js` for all accounts
- **By design**: Prevents spam, ensures controlled access
- Consider this when adding features (no "forgot password" flow)

### 3. SQLite Database File Location
- **Development**: `./playground.db`
- **Production**: `./bincode.db`
- **Configured in**: config/database.js:4-5
- Files in .gitignore (never commit)

### 4. Rate Limiting Scope
- **Global**: Applied to ALL routes (server.js:18)
- **Limit**: 1000 requests per 2 minutes per IP
- **Includes**: Static files, API calls, everything
- Adjust if serving many concurrent users

### 5. JWT Token Storage
- **Client-side**: localStorage (app.js:106)
- **No HttpOnly cookies**: Vulnerable to XSS (mitigated by sanitization)
- **No refresh tokens**: Users must re-login after expiry
- **Token expiry**: Configured in .env (default 7 days)

### 6. No Database Migrations
- Schema changes require manual database deletion
- All data lost on schema changes
- For production: Implement migration system (e.g., node-migrate)

### 7. Error Messages
- **Development**: Detailed error messages with stack traces
- **Production**: Generic messages to avoid information leakage
- **Controlled by**: NODE_ENV in middleware/error.js:8

### 8. Foreign Key Enforcement
- **Enabled explicitly**: `PRAGMA foreign_keys = ON` (db/connect.js:21)
- SQLite disables by default
- Deletion of user would fail if they have snippets
- Currently no cascade delete implemented

### 9. Content Size Limits
- **Per-snippet**: 500KB combined code (middleware/validation.js:68)
- **No total user limit**: Users can create unlimited snippets
- **No cleanup**: Old snippets never auto-deleted

### 10. Static File Serving
- **All files in /public** are publicly accessible
- No authentication on static files
- Libraries folder exposed (1.4MB of libraries)
- Consider CDN or asset optimization for large deployments

---

## Security Considerations for AI Assistants

### When Adding Features

1. **Always validate input** at middleware layer
2. **Sanitize user content** before storage and display
3. **Use parameterized queries** to prevent SQL injection
4. **Never log sensitive data** (passwords, tokens, emails)
5. **Check authorization** - does user own this resource?
6. **Consider rate limiting** - can this be abused?
7. **XSS prevention** - will this render user HTML/JS?

### Current Security Measures

✅ **Implemented**:
- JWT authentication with bcrypt password hashing
- Rate limiting (1000 req/2min per IP)
- Input validation and sanitization (xss, sanitize-html, validator)
- SQL injection prevention (parameterized queries)
- Content size limits (500KB per snippet)
- Foreign key constraints
- CSRF protection via JWT (no cookies)

⚠️ **Potential Improvements**:
- HTTPS enforcement (should use reverse proxy)
- Password strength requirements (currently 4-100 chars)
- Account recovery mechanism (currently impossible)
- Session invalidation on logout (tokens valid until expiry)
- Audit logging for security events
- Email verification for new accounts
- Two-factor authentication
- Content Security Policy headers
- HSTS headers
- Helmet.js middleware

---

## Environment Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NODE_ENV` | No | development | Environment mode: development or production |
| `PORT` | No | 3000 | Port for Express server |
| `JWT_SECRET` | Yes | - | Secret key for JWT signing (use strong random value) |
| `JWT_EXPIRES_IN` | No | 7d | JWT token expiry (e.g., 7d, 24h, 60m) |

**Security**: Never commit .env file. Use .env.example as template.

---

## File Modification Guidelines

### High-Risk Files (Modify with Caution)
- **db/connect.js**: Database schema, breaking changes lose all data
- **middleware/auth.js**: Security vulnerability if broken
- **middleware/validation.js**: XSS/injection risks if weakened
- **public/index.html**: Single HTML file, break = entire app broken

### Safe to Modify
- **public/style.css**: Styling only, no logic impact
- **public/font.css**: Font declarations only
- **config/*.js**: Configuration changes (test thoroughly)
- **utils/logger.js**: Currently unused, safe to enhance

### Requires Coordination
- **package.json**: Dependency changes affect all developers
- **.env.example**: Template for environment setup
- **server.js**: Main entry point, changes affect entire app

---

## Dependencies Reference

### Production Dependencies
- **bcrypt** (5.1.0): Password hashing
- **dotenv** (16.4.7): Environment variable loading
- **express** (4.18.2): Web framework
- **express-rate-limit** (7.5.0): DDoS protection
- **jsonwebtoken** (9.0.0): JWT authentication
- **nanoid** (3.3.4): Unique ID generation
- **sanitize-html** (2.14.0): HTML sanitization
- **sqlite3** (5.1.6): Database
- **validator** (13.12.0): Input validation
- **xss** (1.0.15): XSS prevention

### Development Dependencies
- **nodemon** (2.0.22): Auto-restart on file changes

### Frontend Libraries (Vendored in public/libraries)
- **Vue.js** (3.5.13): Frontend framework
- **Prism.js**: Syntax highlighting
- **Eruda**: In-browser console debugger

---

## Debugging Tips

### Backend Debugging
```bash
# Enable verbose logging
NODE_ENV=development pnpm dev

# Check database contents
sqlite3 playground.db
sqlite> SELECT * FROM users;
sqlite> SELECT * FROM snippets;
sqlite> .exit

# Test JWT token
# Decode at jwt.io or:
node -e "console.log(require('jsonwebtoken').decode('YOUR_TOKEN_HERE'))"
```

### Frontend Debugging
1. **Enable Eruda console**: Click console icon in preview pane
2. **Use Vue.js devtools**: Open browser DevTools, Vue tab
3. **Check localStorage**: DevTools > Application > Local Storage
4. **Network tab**: Monitor API requests/responses
5. **Switch to dev Vue.js build**: Better error messages

### Common Issues

**"User not found" on login**:
- Check user exists: `sqlite3 playground.db "SELECT * FROM users;"`
- Verify database file: `ls -la *.db`
- Recreate user: `node addUser.js email password`

**JWT errors**:
- Check JWT_SECRET matches in .env
- Verify token not expired (check JWT_EXPIRES_IN)
- Confirm Authorization header format: `Bearer <token>`

**Rate limit exceeded**:
- Wait 2 minutes for limit reset
- Adjust limits in server.js:18
- Restart server to reset counters

**Preview not updating**:
- Check execution not paused (toggle button)
- Verify no JavaScript errors in Eruda console
- Check 500ms debounce delay

---

## Contributing Guidelines

### Before Making Changes
1. **Read this CLAUDE.md file** completely
2. **Understand the architecture** - layered backend, zero-build frontend
3. **Test locally** before committing
4. **Maintain backward compatibility** where possible

### Code Style
- **Indentation**: 2 spaces (no tabs)
- **Quotes**: Single quotes for JavaScript strings
- **Semicolons**: Use them consistently
- **Async/await**: Prefer over Promise chains for readability
- **Comments**: Explain "why", not "what"

### Commit Messages
- Use present tense: "Add feature" not "Added feature"
- Be descriptive: "Fix XSS vulnerability in snippet titles" not "Fix bug"
- Reference issues if applicable: "Fix #123: Rate limit too restrictive"

### Pull Request Checklist
- [ ] Code follows existing style
- [ ] No console.log() left in production code
- [ ] Security implications considered
- [ ] Environment variables documented if added
- [ ] README.md updated if user-facing changes
- [ ] Tested in both development and production modes
- [ ] Database schema changes documented

---

## Quick Reference Commands

```bash
# Development
pnpm install              # Install dependencies
pnpm dev                  # Start dev server (nodemon)
pnpm start                # Start production server

# User Management
node addUser.js email password   # Create user account

# Database
sqlite3 bincode.db        # Open production database
sqlite3 playground.db     # Open development database
rm *.db                   # Delete databases (reset schema)

# Environment
cp .env.example .env      # Create environment config
cat .env                  # View current configuration

# Git
git status                # Check working directory
git log --oneline -10     # Recent commits
```

---

## License
Apache License 2.0

---

## Additional Resources
- **Live Demo**: https://bincode.asadk.dev
- **Repository**: https://git.sheetjs.com/asadbek064/BinCode
- **Package Manager**: https://pnpm.io

---

**Last Updated**: 2025-11-13
**Repository Version**: Analyzed from commit 29fdd30

---

## For AI Assistants: Key Takeaways

1. **Zero-build architecture**: No bundler, no transpilation. Edit and refresh.
2. **Manual Vue.js build switching**: Must edit index.html manually for dev/prod.
3. **Security-first**: Multiple validation layers. Never weaken sanitization.
4. **No self-signup**: Users only via CLI. This is intentional.
5. **Layered architecture**: Routes → Middleware → Services → Database.
6. **SQLite quirks**: Enable foreign keys explicitly. No migrations.
7. **Rate limiting is global**: Affects all routes including static files.
8. **JWT in localStorage**: Not HttpOnly cookies. XSS risk mitigated by sanitization.
9. **Database deletion resets schema**: No migrations = data loss on schema changes.
10. **Test thoroughly**: No automated tests exist yet.

When in doubt, prioritize security and maintain the minimalist philosophy.
