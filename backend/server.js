/**
 * Trello ↔ Jira sync server — application entry point.
 */

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { DB_PATH } from './db.js';
import environmentsRouter from './routes/environments.js';
import rulesRouter from './routes/rules.js';
import integrationsRouter from './routes/integrations.js';
import webhooksRouter from './routes/webhooks.js';

const PORT = process.env.PORT || 3001;

const app = express();
app.use(cors());
app.use(morgan('dev'));

// Webhooks need the raw body for HMAC verification (before express.json()).
app.use('/api/webhooks', webhooksRouter);

app.use(express.json());

app.use('/api/environments', environmentsRouter);
app.use('/api/rules', rulesRouter);
app.use('/api', integrationsRouter);

app.listen(PORT, () => {
  console.log(`API running at http://localhost:${PORT}`);
  console.log(`Database: ${DB_PATH}`);
});
