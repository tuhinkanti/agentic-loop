import 'dotenv/config'; // Load env vars before anything else
import { App, ExpressReceiver } from '@slack/bolt';
import express from 'express';
import { handlePullRequest } from './github/handlers.js';
import { registerSlackHandlers } from './slack/handlers.js';
import { verify } from '@octokit/webhooks-methods';

// Create a custom Express app to handle raw body capturing
const expressApp = express();

// Middleware to capture raw body
expressApp.use(
  express.json({
    verify: (req: any, res, buf) => {
      req.rawBody = buf;
    },
  })
);

expressApp.use(
  express.urlencoded({
    extended: true,
    verify: (req: any, res, buf) => {
      req.rawBody = buf;
    },
  })
);

const receiver = new ExpressReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET || '',
  app: expressApp,
});

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  receiver,
});

// Hello World Listener
app.message('hello', async ({ message, say }) => {
  await say(`Hey there <@${(message as any).user}>!`);
});

registerSlackHandlers(app);

// GitHub Webhook Endpoint
receiver.router.post('/github/webhook', async (req, res) => {
  const signature = req.headers['x-hub-signature-256'] as string;
  const secret = process.env.GITHUB_WEBHOOK_SECRET || '';

  // Use the captured raw body
  const body = (req as any).rawBody as Buffer;

  if (!signature) {
    res.status(401).send('Missing signature');
    return;
  }

  if (!body) {
      console.error('No raw body found');
      res.status(400).send('Bad Request');
      return;
  }

  try {
    // verify expects string or buffer
    const isValid = await verify(secret, body.toString(), signature);
    if (!isValid) {
        res.status(401).send('Invalid signature');
        return;
    }
  } catch (error) {
      console.error('Error verifying webhook:', error);
      res.status(500).send('Server Error');
      return;
  }

  const event = req.headers['x-github-event'];

  if (event === 'pull_request') {
     // Run asynchronously to avoid GitHub webhook timeout (10s)
     handlePullRequest(req.body, app).catch(err => {
         console.error('Error handling pull request:', err);
     });
  }

  res.sendStatus(200);
});

(async () => {
  const port = process.env.PORT || 3000;
  await app.start(port);
  console.log(`⚡️ Bolt app is running on port ${port}!`);
})();
