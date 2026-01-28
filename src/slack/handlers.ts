import { App, BlockAction, ButtonAction } from '@slack/bolt';
import { Octokit } from 'octokit';

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

export function registerSlackHandlers(app: App) {

  // 1. Approve PR
  app.action('approve_pr', async ({ ack, body, client, action }) => {
    await ack();
    const buttonAction = action as ButtonAction;
    const { owner, repo, number } = JSON.parse(buttonAction.value || '{}');

    try {
      await octokit.request('POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews', {
        owner,
        repo,
        pull_number: number,
        event: 'APPROVE',
      });

      await client.chat.postMessage({
        channel: body.channel?.id || '',
        text: `✅ PR #${number} approved by <@${body.user.id}>!`,
        thread_ts: (body as any).message?.ts, // Reply in thread
      });
    } catch (error) {
        console.error("Error approving PR", error);
        await client.chat.postEphemeral({
            channel: body.channel?.id || '',
            user: body.user.id,
            text: `Failed to approve PR: ${(error as any).message}`
        });
    }
  });

  // 2. Review Diff (Modal)
  app.action('review_diff', async ({ ack, body, client, action }) => {
    await ack();
    const buttonAction = action as ButtonAction;
    const { owner, repo, number } = JSON.parse(buttonAction.value || '{}');

    try {
       // Fetch files (limit to 100 for now to capture more files than default 30)
      const { data: files } = await octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}/files', {
        owner,
        repo,
        pull_number: number,
        per_page: 100,
      });

      // Prepare file list blocks
      const fileBlocks = files.map((file: any) => ({
        type: 'section',
        text: {
            type: 'mrkdwn',
            text: `*${file.filename}* (+${file.additions} / -${file.deletions})`
        },
        accessory: {
            type: 'button',
            text: {
                type: 'plain_text',
                text: 'View'
            },
            action_id: 'view_file_content',
            value: JSON.stringify({ owner, repo, number, filename: file.filename })
        }
      }));

      // Limit blocks to avoid Slack limits (max 100 blocks usually, but keep it safe)
      const safeFileBlocks = fileBlocks.slice(0, 40);

      await client.views.open({
        trigger_id: (body as any).trigger_id,
        view: {
          type: 'modal',
          callback_id: 'view_diff_modal',
          title: {
            type: 'plain_text',
            text: `Review PR #${number}`,
          },
          blocks: [
              {
                  type: 'section',
                  text: {
                      type: 'mrkdwn',
                      text: "Select a file to view changes (showing first 40 files):"
                  }
              },
              ...safeFileBlocks
          ],
        },
      });
    } catch (error) {
        console.error("Error opening modal", error);
    }
  });

  // 3. View File Content (Update Modal)
  app.action('view_file_content', async({ ack, body, client, action }) => {
      await ack();
      const buttonAction = action as ButtonAction;
      const { owner, repo, number, filename } = JSON.parse(buttonAction.value || '{}');

      let patch = "No diff available.";
      try {
          // Re-fetch files to get the specific file's patch
          // List Pull Request Files endpoint paginates. We need to find the specific file.
          let foundFile: any = null;
          let page = 1;
          const perPage = 100;

          // Loop through pages (limit to 5 pages / 500 files to avoid infinite loops or excessive API calls)
          while (!foundFile && page <= 5) {
            const { data: files } = await octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}/files', {
                owner,
                repo,
                pull_number: number,
                per_page: perPage,
                page: page,
            });

            if (!files || files.length === 0) break;

            foundFile = files.find((f: any) => f.filename === filename);
            page++;
          }

          if (foundFile && foundFile.patch) {
              patch = foundFile.patch;
          }
      } catch (e) {
          console.error("Error fetching file patch", e);
          patch = "Error fetching diff.";
      }

      // Patch can be large. Slack text block limit is 3000 chars.
      // We will truncate.
      const displayPatch = patch.substring(0, 2900) + (patch.length > 2900 ? "\n...(truncated)" : "");

      await client.views.push({
          trigger_id: (body as any).trigger_id,
          view: {
              type: 'modal',
              title: {
                  type: 'plain_text',
                  text: filename.split('/').pop() || filename // Short name
              },
              blocks: [
                  {
                      type: 'section',
                      text: {
                          type: 'mrkdwn',
                          text: `\`\`\`diff\n${displayPatch}\n\`\`\``
                      }
                  }
              ]
          }
      });
  });

  // 4. Comment (Modal)
  app.action('comment_pr', async ({ ack, body, client, action }) => {
    await ack();
    const buttonAction = action as ButtonAction;
    const { owner, repo, number } = JSON.parse(buttonAction.value || '{}');

    // Extract channel and thread info
    const channelId = body.channel?.id;
    const threadTs = (body as any).message?.ts;

    await client.views.open({
      trigger_id: (body as any).trigger_id,
      view: {
        type: 'modal',
        callback_id: 'submit_comment_modal',
        private_metadata: JSON.stringify({ owner, repo, number, channelId, threadTs }),
        title: {
          type: 'plain_text',
          text: 'Add Comment',
        },
        submit: {
          type: 'plain_text',
          text: 'Post',
        },
        blocks: [
          {
            type: 'input',
            block_id: 'comment_input',
            element: {
              type: 'plain_text_input',
              action_id: 'content',
              multiline: true,
            },
            label: {
              type: 'plain_text',
              text: 'Your Comment',
            },
          },
        ],
      },
    });
  });

  // 5. Handle Comment Submission
  app.view('submit_comment_modal', async ({ ack, view, client, body }) => {
    await ack();
    const { owner, repo, number, channelId, threadTs } = JSON.parse(view.private_metadata);
    const content = view.state.values.comment_input.content.value;

    try {
      await octokit.request('POST /repos/{owner}/{repo}/issues/{issue_number}/comments', {
        owner,
        repo,
        issue_number: number,
        body: content || '',
      });

      if (channelId && threadTs) {
          await client.chat.postMessage({
              channel: channelId,
              text: `💬 Comment added to PR #${number} by <@${body.user.id}>:\n> ${content}`,
              thread_ts: threadTs,
          });
      }

    } catch (error) {
        console.error("Error posting comment", error);
    }
  });
}
