# Task Synchronization Manager 

Test app that allows syncing tasks from Trello to Jira and vice versa.

---

## 🛠 Tech Stack

**Frontend:**
* React.js (Vite)
* Context-based state management (React Hooks)
* Modular CSS styling (Light Theme)

**Backend:**
* Node.js (Express.js)
* SQLite (Database for persisting environment configurations and sync rules)
* REST API (Integration with the Atlassian Jira API and Trello API)

---

## 📁 Project Architecture

```text
├── backend/
│   ├── db.js                # SQLite database configuration & model seeding
│   ├── server.js            # Core Express app entry point & middleware config
│   ├── routes/              # Express endpoint controllers (rules, integrations)
│   ├── services/            # API logic (Trello, Jira, and the Sync Engine)
│   └── utils/               # App-wide helpers (domains, rule validation, contexts)
│
└── frontend/
    └── src/
        ├── components/      # Divided UI units (Layout elements, Modals, Viewers)
        ├── styles/          # CSS stylesheets
        ├── utils/           # Client-side helper functions (sync logs, link parsers)
        ├── api.js           # Centralized Axios connection configuration
        ├── App.jsx          # Main global state controller
        └── main.jsx         # React DOM mounting hub