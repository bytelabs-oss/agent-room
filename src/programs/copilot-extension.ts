// Runs inside every Copilot CLI session, loaded from ~/.copilot/extensions/room/extension.mjs. Only code inside the
// session can hand it a message. When the room MCP server signals that its deliveries changed, Copilot tells this
// extension, which reads them through Copilot and hands each to the session: a message, steered into the turn under
// way or starting one, or a request to reload the session's skills after a shared skill was taken in.

// @ts-expect-error The Copilot CLI provides this module to its extensions at runtime.
import { joinSession } from '@microsoft/copilot-sdk/extension';

const SERVER = 'room';
const DELIVERIES = 'room://deliveries';

type Delivery = { prompt: string; source: string } | { reloadSkills: true };

const session = await joinSession({});

const logError = (text: string) => session.log(`agent-room: ${text}`, { level: 'error' }).catch(() => {});

// Copilot does not await event handlers, so an error left uncaught here would end this extension and every later
// delivery with it. Each read takes everything queued so far, so a delivery missed once comes with the next.
async function handOver() {
  try {
    const { contents } = await session.rpc.mcp.resources.read({ serverName: SERVER, uri: DELIVERIES });
    for (const delivery of JSON.parse(contents[0].text) as Delivery[]) {
      try {
        if ('reloadSkills' in delivery) await session.rpc.skills.reload();
        else await session.send({ prompt: delivery.prompt, mode: 'immediate', source: delivery.source });
      } catch (error) {
        logError(`could not hand the session a delivery: ${(error as Error).message}`);
      }
    }
  } catch (error) {
    logError(`could not read its deliveries: ${(error as Error).message}`);
  }
}

session.on('mcp.resources.list_changed', ({ data }: { data: { serverName: string } }) => data.serverName === SERVER && handOver());
