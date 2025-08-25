# [BinCode](https://bincode.asadk.dev) - A Complete Self-Hostable JSFiddle Alternative

## Overview
BinCode is a minimalist platform for managing and sharing code snippets, built with Vue.js and SQLite. It runs entirely on your own infrastructure, giving you full control over your data and workflow.

### [DEMO](https://bincode.asadk.dev)
### [Org-Repo](https://git.sheetjs.com/asadbek064/BinCode)

## Key Features
- **Self-Contained:** No external dependencies required.
- **Modern Stack:** Vue.js frontend and SQLite database.
- **JWT Authentication:** Secure, simple user management.
- **Instant Sharing:** Generate unique URLs for snippets.
- **Minimal Setup:** Create users manually to start sharing.
- **Performance-Focused:** Lightweight and fast.

## Architecture
- **Frontend:** Vue.js
- **Database:** SQLite
- **Authentication:** JWT
- **Deployment:** Single self-contained server.

There is no signups its by design just create users manually and they can start commit snippets to share

## Why BinCode?

BinCode is a lightweight, self-hostable tool for teams and individuals needing a simple, reliable solution for code sharing without relying on external services.

## Design Choices
- **No Signups:** Admins manually create user accounts for simplicity and security.
- **Self-Hosted:** Ensures privacy and control over your data.


## Contributing
Contributions are welcome, as long as the tool remains lightweight and self-contained.

## Getting Started

### 1. Clone and Install Dependencies

```bash
git clone https://git.sheetjs.com/asadbek064/BinCode.git
cd BinCode
pnpm install
```

### 2. Set Up Environment Variables
Create a .env file in the project root and define the following variables:
```env
NODE_ENV=development
PORT=3000
JWT_SECRET=your-secure-secret-here
JWT_EXPIRES_IN=7d
```

### 3. Adding user 

```bash
node addUser.js "user@email.com" "password"
```

### 4. Development server
Before starting the development server, ensure you change the Vue.js library import from `_prod` to `_dev` in [`index.html`](https://git.sheetjs.com/asadbek064/BinCode/src/commit/3e35da0118e8e6b44863b3fee12c1e2dff96b02e/public/index.html#L129).

```bash
pnpm dev
```

### 5. Production
Copy .env.example to .env and generate unique secret and change NODE_ENV=production
1. Copy .env.example to .env:
```bash
cp .env.example .env
```

2. Generate a unique secret and set NODE_ENV=production in the .env file.

3. Start the production server
```
pnpm start
````


### 5. Production
- For development, using the `_dev` version of Vue.js (vue.global.js) is recommended as it includes debugging tools and warnings.

- For production, switch to the `_prod` version (vue.global.prod.js) to optimize performance.

