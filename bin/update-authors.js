#!/usr/bin/env node

'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const util = require('util');

const toolName = path.basename(process.argv[1]);
const toolVersion = require('../package.json').version;

const gitLogAllowedOptions = [
  '--all-match',
  '--invert-grep',
  '-i',
  '--regexp-ignore-case',
  '--basic-regexp',
  '-E',
  '--extended-regexp',
  '-F',
  '--fixed-strings',
  '-P',
  '--perl-regexp',
];

const help = `\
This tool lists and optionally saves to file all of the repository contributors
based on the \`git log\` command output, ordered by the first contribution.

Usage: ${toolName} [--until=commit] [--out[=path]] [<git log passed options>]
       ${toolName} --help
       ${toolName} --version

Options:
  --until=commit  stop at the specified commit instead of going through full
                  repo history
  --out[=path]    change output path (./AUTHORS is the default), if the path is
                  omitted, print to stdout
  --help          print this help message and exit
  --version       print version and exit

Options passed straight to \`git log\`:
  '--grep='
${gitLogAllowedOptions.map(opt => `  '${opt}'`).join('\n')}
`;

let untilCommit;
let outputPath = 'AUTHORS';
const gitLogPassedOptions = [];

for (const arg of process.argv.slice(2)) {
  if (arg.startsWith('--help') || arg.startsWith('-h')) {
    console.log(help);
    process.exit(0);
  } else if (arg.startsWith('--version')) {
    console.log(toolVersion);
    process.exit(0);
  } else if (arg.startsWith('--until=')) {
    untilCommit = arg.split('=')[1];
  } else if (arg.startsWith('--out')) {
    outputPath = arg.split('=')[1];
  } else if (arg.startsWith('--grep=')) {
    gitLogPassedOptions.push(arg);
  } else if (gitLogAllowedOptions.includes(arg)) {
    gitLogPassedOptions.push(arg);
  } else {
    console.error(
      `Unrecognized option: ${arg}\n` +
        `Try '${toolName} --help' for more information`
    );
    process.exit(1);
  }
}

const authorMarker = 'AUTHOR: ';
const coauthorMarker = 'Co-authored-by: ';

const logArgs = ['log', '--reverse', `--format=${authorMarker}%aN <%aE>\n%b`];
logArgs.push(...gitLogPassedOptions);

if (untilCommit) {
  logArgs.push(untilCommit + '..');
}

const gitLog = childProcess.spawn('git', logArgs, {
  stdio: ['ignore', 'pipe', process.stderr],
});

gitLog.on('error', error => {
  console.error(error);
  process.exit(1);
});

gitLog.once('close', code => {
  if (code !== 0) {
    process.exit(code);
  }
});

const linereader = readline.createInterface({
  input: gitLog.stdout,
  historySize: 0,
});

let authors = new Set();

linereader.on('line', line => {
  if (line.startsWith(authorMarker)) {
    line = line.substring(authorMarker.length);
  } else if (line.startsWith(coauthorMarker)) {
    line = line.substring(coauthorMarker.length);
  } else {
    return;
  }

  line = line.trim();
  if (line === '' || line.includes('[bot]')) return;
  authors.add(line);
});

const mailmapAuthors = async () => {
  const mailmappedAuthors = new Set();
  const exec = util.promisify(childProcess.exec);
  for (const author of authors) {
    const { stdout: contact } = await exec(
      `git check-mailmap ${JSON.stringify(author)}`
    );
    mailmappedAuthors.add(contact.trim());
  }
  authors = mailmappedAuthors;
};

linereader.once('close', async () => {
  await mailmapAuthors().catch(err => {
    console.error(`Failed to mailmap authors: ${err}`);
    process.exit(1);
  });

  if (!outputPath) {
    for (const author of authors) {
      console.log(author);
    }
    return;
  }

  console.log(`Writing to ${path.resolve(outputPath)}`);

  const open = util.promisify(fs.open);
  const write = util.promisify(fs.write);
  try {
    const file = await open(outputPath, 'w+', 0o644);
    for (const author of authors) {
      await write(file, author + '\n');
    }
  } catch (err) {
    console.error(`Error writing to file: ${err}`);
    process.exit(1);
  }
});
