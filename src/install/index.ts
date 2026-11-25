// agent-room install [--extra <name>]   register agent-room with every program found
// agent-room uninstall                  take out everything install put in, ~/.agent-room included
// agent-room tailscale-key              save a Tailscale API token, so /invite can email invites to your tailnet
//
// bootstrap.js has put the code in ~/.agent-room and fetched its library before this runs from there.

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';
import { styleText } from 'node:util';
import { CONFIG_FILE, canInvite, tailnetAddress } from '../tailscale.ts';
import { EXTRAS, configure } from './configure.ts';

const SOURCE = path.join(import.meta.dirname, '..', '..');
const HOME = path.join(os.homedir(), '.agent-room');
const REPO = 'github:bytelabs-oss/agent-room';
const KEYS = 'https://login.tailscale.com/admin/settings/keys';
const { version } = JSON.parse(fs.readFileSync(path.join(SOURCE, 'package.json'), 'utf8'));

const paint = (format: Parameters<typeof styleText>[0]) => (text: string | number) => styleText(format, String(text));
const [bold, dim, green, yellow, red] = (['bold', 'dim', 'green', 'yellow', 'red'] as const).map(paint);
const [done, skipped, todo, failed] = [green('✓'), dim('–'), yellow('!'), red('✗')];
const print = (text: string = '') => console.log(text);
const printRow = (mark: string, name: string, detail: string) => print(`  ${mark} ${name.padEnd(15)} ${dim(detail)}`);
/** Returns what is left for the person to do. */
function printStep(mark: string, name: string, detail: string, left: string[]) {
  printRow(mark, name, detail);
  return left;
}
const tildePath = (file: string) => file.replace(os.homedir(), '~');

async function ask(question: string) {
  const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await prompt.question(question)).trim();
  prompt.close();
  return answer;
}

function isCommandSuccessful(command: string) {
  try {
    execSync(command, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** Offers to install Tailscale when it is missing. Returns what is left for the person to do. */
async function checkTailscale(): Promise<string[] | undefined> {
  const tailnet = tailnetAddress();
  if (tailnet) return void printRow(done, 'Tailscale', `on. Other machines reach this one at ${tailnet}`);
  const signIn = [process.platform === 'darwin' ? 'Open the Tailscale app and sign in' : 'Run `sudo tailscale up` and sign in', 'needed for rooms shared with other machines'];
  if (fs.existsSync('/Applications/Tailscale.app') || isCommandSuccessful('command -v tailscale')) return printStep(todo, 'Tailscale', 'installed, not signed in', signIn);
  const missing = ['Install Tailscale from https://tailscale.com/download and sign in', 'only for rooms shared with other machines'];
  const installer = process.platform === 'darwin' ? isCommandSuccessful('command -v brew') && 'brew install --cask tailscale-app' : process.platform === 'linux' && 'curl -fsSL https://tailscale.com/install.sh | sh';
  if (!installer || !process.stdin.isTTY || !(await ask(`  ${bold('Install Tailscale to share rooms across machines?')} ${dim('[y/N]')} `)).toLowerCase().startsWith('y')) {
    return printStep(skipped, 'Tailscale', 'not installed. Rooms on this machine work without it.', missing);
  }
  try {
    printRow(dim('…'), 'Tailscale', 'installing. It asks for the password of this machine.');
    execSync(installer, { stdio: ['inherit', 'pipe', 'pipe'] });
    return printStep(todo, 'Tailscale', 'installed, not signed in', signIn);
  } catch {
    return printStep(failed, 'Tailscale', 'could not be installed. Rooms on this machine work without it.', missing);
  }
}

/** Saved readable by the owner only. Enter skips. */
async function askForToken() {
  print(`\n  To invite other people to a shared room, /invite emails them an invite to your Tailscale network.\n  That needs an API access token of yours. Make one at ${bold(KEYS)}\n  ${dim(`It is kept in ${tildePath(CONFIG_FILE)} and sent only to Tailscale. A token lasts 90 days at most.`)}`);
  const token = await ask(`  ${bold('Paste the token')} ${dim('(Enter to skip)')} `);
  if (!token) return false;
  if (!token.startsWith('tskey-api-')) throw new Error('that is not a Tailscale API access token. One starts with tskey-api-');
  fs.writeFileSync(CONFIG_FILE, `${JSON.stringify({ tailscaleApiKey: token }, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(CONFIG_FILE, 0o600);
  return true;
}

async function checkInvites(): Promise<string[] | undefined> {
  if (!canInvite() && !tailnetAddress()) return undefined;
  if (canInvite() || (process.stdin.isTTY && (await askForToken()))) return void printRow(done, 'Invites', 'can email people an invite to your Tailscale network');
  printRow(skipped, 'Invites', 'no Tailscale API token saved. You invite people at Tailscale yourself.');
  return [`Save a Tailscale API token: npx ${REPO} tailscale-key`, 'only to invite other people to a shared room'];
}

async function install(args: string[]) {
  const extras = args.flatMap((arg, index) => (arg === '--extra' ? [args[index + 1]] : []));
  const unknown = extras.find((name) => !EXTRAS.includes(name));
  if (unknown !== undefined) throw new Error(`no extra called "${unknown}". Extras: ${EXTRAS.join(', ')}`);

  print(`\n  ${bold('agent-room')} ${dim(version)}\n\n  ${bold('Installing')}`);
  printRow(done, 'Code', tildePath(HOME));
  const found = configure(os.homedir(), true, { extras });
  printRow(found.length ? done : skipped, 'Programs', found.length ? found.join(', ') : 'none of Claude Code, Codex or Copilot CLI found');

  const steps = [];
  if (found.includes('Codex')) steps.push(['In Codex, run /hooks', 'trust the agent-room hook once, or Codex skips it']);
  for (const step of [await checkTailscale(), await checkInvites()]) if (step) steps.push(step);
  steps.push(['Restart sessions that are already open', 'a session loads the tools when it starts']);
  print(`\n  ${bold('Left for you')}`);
  const width = Math.max(...steps.map(([what]) => what.length));
  steps.forEach(([what, why], index) => print(`  ${yellow(index + 1)} ${what.padEnd(width)}  ${dim(why)}`));
  print(`\n  ${bold('Use it')}: /start-local-room in any session, then paste its join line into another.\n  ${dim(`To remove everything: npx ${REPO} uninstall`)}\n`);
}

function uninstall() {
  const found = configure(os.homedir(), false);
  fs.rmSync(HOME, { recursive: true, force: true });
  print(`\n  ${done} Removed agent-room from ${found.join(', ') || 'no programs'} and ${tildePath(HOME)}. Tailscale is left as it is.\n`);
}

async function tailscaleKey() {
  if (!fs.existsSync(HOME)) throw new Error(`agent-room is not installed here. Run: npx ${REPO} install`);
  if (!process.stdin.isTTY) throw new Error('run this in a terminal, so the token can be pasted in.');
  print((await askForToken()) ? `\n  ${done} Saved.\n` : `\n  ${skipped} Nothing saved.\n`);
}

try {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'install') await install(args);
  else if (command === 'uninstall') uninstall();
  else if (command === 'tailscale-key') await tailscaleKey();
  else throw new Error('usage: agent-room install [--extra <name>] | agent-room uninstall | agent-room tailscale-key');
} catch (error) {
  console.error(`\n  ${failed} ${(error as Error).message}\n`);
  process.exit(1);
}
