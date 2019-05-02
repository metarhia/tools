#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const util = require('util');

const { LabelHandler } = require('../lib/labels.js');

const toolName = path.basename(process.argv[1]);
const toolVersion = require('../package.json').version;

const padding = ' '.repeat(toolName.length);

const help = `\
This tool copies labels from source repository or file to destination
repository or file.

Usage: ${toolName} [--config=path] [--user=user] [--token=token]
       ${padding} [--src-repo=repo] [--dst-repo=repo] [--src-file=path]
       ${padding} [--dst-file=path] [--delete] [--update]
       ${toolName} --help
       ${toolName} --version

Options:
  --config   Path to config file
  --user     github username
  --token    github access token
  --src-repo Source repository. e.g. 'metarhia/tools'
  --dst-repo Destination repository. e.g. 'metarhia/tools'
  --src-file File to read labels from
  --dst-file File to write labels to
  --delete   Delete all labels in destination repository before
             copy
  --update   Update existing labels with the same name
  --help     print this help message and exit
  --version  print version and exit
`;

const args = {};

const options = new Map([
  ['--config', 'config'],
  ['--user', 'user'],
  ['--token', 'token'],
  ['--src-repo', 'srcRepo'],
  ['--dst-repo', 'dstRepo'],
  ['--src-file', 'srcFile'],
  ['--dst-file', 'dstFile'],
  ['--delete', 'delete'],
  ['--update', 'update'],
]);

for (const arg of process.argv.slice(2)) {
  const [opt, value] = arg.split('=');
  if (opt.startsWith('--help') || opt.startsWith('-h')) {
    console.log(help);
    process.exit(0);
  } else if (opt.startsWith('--version') || arg.startsWith('-v')) {
    console.log(toolVersion);
    process.exit(0);
  } else if (options.has(opt)) {
    args[options.get(opt)] = value || true;
  } else {
    console.error(
      `Unrecognized option: ${arg}\n` +
        `Try '${toolName} --help' for more information`
    );
    process.exit(1);
  }
}

const printLabels = labels => {
  if (!Array.isArray(labels)) labels = [labels];
  console.table(
    labels.reduce((acc, label) => {
      acc[label.name] = label;
      return acc;
    }, {}),
    ['color', 'description']
  );
};

const readDump = async file => {
  const readFile = util.promisify(fs.readFile);
  let data;
  try {
    data = await readFile(file);
  } catch (err) {
    console.error(`Error reading file: ${file}`);
    process.exit(1);
  }
  return JSON.parse(data);
};

const writeDump = async (file, data) => {
  const result = data.map(label => ({
    name: label.name,
    color: label.color,
    description: label.description,
  }));

  const writeFile = util.promisify(fs.writeFile);
  try {
    data = await writeFile(file, JSON.stringify(result, null, 2));
  } catch (err) {
    console.error(`Error reading file: ${file}`, err);
    process.exit(1);
  }
};

const copy = async args => {
  if (args.config) args = { ...args, ...(await readDump(args.config)) };

  if (args.srcFile && args.srcRepo) {
    console.error('Only `src-repo` or `src-file` should be specified');
    process.exit(1);
  }
  if (args.srcFile && args.dstFile) {
    console.error('Only `src-file` or `dst-file` should be specified');
    process.exit(1);
  }
  if (!args.srcFile && !args.srcRepo) {
    console.error('Either `src-file` or `src-repo` should be specified');
    process.exit(1);
  }
  if (!args.dstFile && !args.dstRepo) {
    console.error('Either `dst-file` or `dst-repo` should be specified');
    process.exit(1);
  }

  const handler = new LabelHandler({
    repo: args.dstRepo,
    user: args.user,
    token: args.token,
  });
  if (!args.dstFile && args.delete) {
    try {
      await handler.delete();
    } catch (err) {
      console.error('Cannot delete labels', err);
      process.exit(1);
    }
  }

  let labels;
  if (args.dstFile) {
    try {
      labels = await handler.getFrom(args.srcRepo);
    } catch (err) {
      console.error('Cannot get labels', err);
      process.exit(1);
    }
    await writeDump(args.dstFile, labels);
    return labels;
  } else {
    labels = args.srcFile ? await readDump(args.srcFile) : args.srcRepo;
    try {
      labels = await handler.copyFrom(labels, args.update);
    } catch (err) {
      console.error('Cannot copy labels', err);
      process.exit(1);
    }
    return labels;
  }
};

copy(args).then(printLabels, err => {
  console.error(err);
  process.exit(1);
});
