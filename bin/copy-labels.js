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
  --config  path to the config file
  --user    GitHub username
  --token   GitHub access token
  --delete  delete all labels in destination repository before copy
  --update  update existing labels with the same name
  --dry-run print operations that will be executed and exit
  --help    print this help message and exit
  --version print version and exit
`;

const args = { args: [] };

const options = new Map([
  ['--config', 'config'],
  ['--user', 'user'],
  ['--token', 'token'],
  ['--delete', 'delete'],
  ['--update', 'update'],
  ['--dry-run', 'dry'],
]);

const helpExit = (message, error) => {
  console.error(message);
  console.error(error.message);
  console.error(`\nTry '${toolName} --help' for more information`);
  process.exit(1);
};

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
    helpExit('Unrecognized option:', arg);
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
  let data, result;
  try {
    data = await readFile(file);
  } catch (err) {
    helpExit('Error reading file:', file);
  }
  try {
    result = JSON.parse(data);
  } catch (err) {
    helpExit('Cannot parse JSON file:', file);
  }
  return result;
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
    helpExit(`Error reading file: ${file}`, err);
  }
};

const copy = async args => {
  if (args.config) {
    const { user, token } = await readDump(args.config);
    args = { user, token, ...args };
  }

  const [src, dst] = args.args;
  if (!src) helpExit('missing source repository or file');
  if (!dst) helpExit('missing destination repository or file');

  if (path.extname(src) === '.json') args.srcFile = src;
  else args.srcRepo = src;
  if (path.extname(dst) === '.json') args.dstFile = dst;
  else args.dstRepo = dst;

  if (args.srcFile && args.dstFile) {
    helpExit('Either source or destination should be repository');
  }

  const handler = new LabelHandler({
    repo: args.dstRepo,
    user: args.user,
    token: args.token,
  });

  if (args.dry) console.log('This is a dry run, no changes will be made\n');

  if (args.dstRepo && args.delete) {
    if (args.dry) {
      console.log(`Delete following labels from ${args.dstRepo}`);
      printLabels(await handler.get());
    } else {
      try {
        await handler.delete();
      } catch (err) {
        helpExit('Cannot delete labels', err);
      }
    }
  }

  let labels;
  if (args.dstFile) {
    try {
      labels = await handler.getFrom(args.srcRepo);
    } catch (err) {
      helpExit('Cannot get labels', err);
    }
    if (args.dry) {
      console.log(
        `Write following labels ` +
          `from repository '${args.srcRepo}' to file '${args.dstFile}'`
      );
      printLabels(labels);
    } else {
      await writeDump(args.dstFile, labels);
    }
  } else {
    labels = await (args.srcFile
      ? readDump(args.srcFile)
      : handler.getFrom(args.srcRepo));
    if (args.dry) {
      let msg = 'Copy the following labels from ';
      if (args.srcFile) {
        msg += `file '${args.srcFile}'`;
      } else {
        msg += `repository '${args.srcRepo}'`;
      }
      console.log(msg);
      printLabels(labels);
      msg = `to repository ${args.dstRepo} with following labels`;
      if (args.update) msg += ' updating existing labels';
      console.log(msg);
      printLabels(await handler.get());
    } else {
      process.exit();
      try {
        labels = await handler.copyFrom(labels, args.update);
      } catch (err) {
        helpExit('Cannot copy labels', err);
      }
    }
  }
  return labels;
};

copy(args).then(
  labels => {
    if (!args.dry) printLabels(labels);
  },
  err => {
    helpExit('Cannot copy labels', err);
  }
);
