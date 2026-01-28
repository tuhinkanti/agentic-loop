import { Octokit } from 'octokit';
import { App } from '@slack/bolt';
import { analyzeDiff } from '../ai/agent.js';

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

export async function handlePullRequest(payload: any, app: App) {
  const action = payload.action;
  const pr = payload.pull_request;
  const repo = payload.repository;

  if (action === 'opened' || action === 'reopened') {
    // 1. Fetch Diff
    try {
      const { data: diff } = await octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}', {
        owner: repo.owner.login,
        repo: repo.name,
        pull_number: pr.number,
        mediaType: {
          format: 'diff',
        },
      });

      // 2. Analyze with AI
      // Diff comes as a string when mediaType format is diff
      const analysis = await analyzeDiff(diff as unknown as string);

      // 3. Notify Slack
      const channelId = process.env.SLACK_CHANNEL_ID;
      if (channelId) {
        await app.client.chat.postMessage({
          channel: channelId,
          text: `New PR: ${pr.title}`, // Fallback text
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `*<${pr.html_url}|[PR #${pr.number}] ${pr.title}>*\nAuthor: @${pr.user.login} | +${pr.additions} / -${pr.deletions} lines`,
              },
            },
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `*AI Insight:* ${getRiskEmoji(analysis.risk)} *${analysis.risk} Risk*\n${analysis.reason}`,
              },
            },
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `*Summary:*\n${Array.isArray(analysis.summary) ? analysis.summary.map((s: string) => `• ${s}`).join('\n') : analysis.summary}`,
              },
            },
            {
              type: 'actions',
              elements: [
                {
                  type: 'button',
                  text: {
                    type: 'plain_text',
                    text: '🔍 Review Diff',
                  },
                  action_id: 'review_diff',
                  value: JSON.stringify({ owner: repo.owner.login, repo: repo.name, number: pr.number }),
                },
                {
                  type: 'button',
                  text: {
                    type: 'plain_text',
                    text: '✅ Approve',
                  },
                  action_id: 'approve_pr',
                  style: 'primary',
                   value: JSON.stringify({ owner: repo.owner.login, repo: repo.name, number: pr.number }),
                },
                {
                  type: 'button',
                  text: {
                    type: 'plain_text',
                    text: '💬 Comment',
                  },
                  action_id: 'comment_pr',
                  value: JSON.stringify({ owner: repo.owner.login, repo: repo.name, number: pr.number }),
                },
              ],
            },
          ],
        });
      }
    } catch (error) {
      console.error('Error processing PR:', error);
    }
  }
}

function getRiskEmoji(risk: string) {
  switch (risk) {
    case 'High': return '⚠️';
    case 'Medium': return '🟠';
    default: return '🟢';
  }
}
