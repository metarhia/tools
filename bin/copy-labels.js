#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const util = require('util');

const { LabelHandler } = require('../lib/labels.js');

const toolName = path.basename(process.argv[1]);
const toolVersion = require('../package.json').version;

const help = `\
This tool copies labels from source repository or json file to destination
repository or json file.

Usage: ${toolName} [OPTION]... SOURCE DEST
       ${toolName} --help
       ${toolName} --version

Options:
  --config   Path to config file
  --user     Github username
  --token    Github access token
  --delete   Delete all labels in destination repository before
             copy
  --update   Update existing labels with the same name
  --help     print this help message and exit
  --version  print version and exit
`;

const args = { args: [] };

const options = new Map([
  ['--config', 'config'],
  ['--user', 'user'],
  ['--token', 'token'],
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
  } else if (!opt.startsWith('--')) {
    args.args.push(opt);
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

  const [src, dst] = args.args;
  if (!(src || dst)) {
    console.error('Both SOURCE and DEST should be specified');
    process.exit(1);
  }
  if (path.extname(src) === '.json') args.srcFile = src;
  else args.srcRepo = src;
  if (path.extname(dst) === '.json') args.dstFile = dst;
  else args.dstRepo = dst;

  if (args.srcFile && args.dstFile) {
    console.error('Either SOURCE or DEST should be repository');
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
