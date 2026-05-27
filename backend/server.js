/**
 * Trello ↔ Jira sync server — application entry point.
 */

import express from 'express';
import cors from 'cors';
import { DB_PATH } from './db.js';
import environmentsRouter from './routes/environments.js';
import rulesRouter from './routes/rules.js';
import integrationsRouter from './routes/integrations.js';

const PORT = process.env.PORT || 3001;

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api/environments', environmentsRouter);
app.use('/api/rules', rulesRouter);
app.use('/api', integrationsRouter);

app.listen(PORT, () => {
  console.log(`API running at http://localhost:${PORT}`);
  console.log(`Database: ${DB_PATH}`);
});
