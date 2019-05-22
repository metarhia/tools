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
  --delete  delete unused labels in destination repository before copy
  --update  update existing labels with the same name
  --dry-run print operations that will be executed and exit
  --help    print this help message and exit
  --version print version and exit
`;

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
  if (error) console.error(error.message);
  console.error(`\nTry '${toolName} --help' for more information`);
  process.exit(1);
};

const getArgs = () => {
  const args = { args: [] };
  for (const arg of process.argv.slice(2)) {
    const [opt, value] = arg.split('=');
    if (opt.startsWith('--help')) {
      console.log(help);
      process.exit(0);
    } else if (opt.startsWith('--version')) {
      console.log(toolVersion);
      process.exit(0);
    } else if (options.has(opt)) {
      args[options.get(opt)] = value || true;
    } else if (!opt.startsWith('--') && args.args.length < 2) {
      args.args.push(opt);
    } else {
      helpExit('Unrecognized option:' + arg);
    }
  }
  return args;
};

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
    helpExit('Error reading file:' + file, err);
  }
  try {
    result = JSON.parse(data);
  } catch (err) {
    helpExit('Cannot parse JSON file:' + file, err);
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
    helpExit(`Error writing file: ${file}`, err);
  }
};

const dryDelete = async (args, handler) => {
  const labels = await handler.get();
  const usedLabels = await handler.getUsedLabels(args.dstRepo);
  console.log(`Delete following labels from '${args.dstRepo}'`);
  printLabels(labels.filter(({ name }) => !usedLabels.has(name)));
  if (usedLabels.size) {
    console.error(
      `The following labels have related issues and won't be deleted`
    );
    console.table(usedLabels);
  }
  return usedLabels;
};

const deleteLabels = async (args, handler) => {
  let usedLabels = new Map();
  if (args.dry) {
    try {
      usedLabels = await dryDelete(args, handler);
    } catch (err) {
      helpExit('Cannot delete labels(dry)', err);
    }
  } else {
    try {
      await handler.delete();
    } catch (err) {
      helpExit('Cannot delete labels', err);
    }
  }
  return usedLabels;
};

const printAddedLabels = (args, labels, existingLabels, usedLabels) => {
  console.log('Following labels will be added:');
  printLabels(
    labels.filter(label => {
      for (const existingLabel of existingLabels) {
        if (existingLabel.name === label.name) {
          return args.delete && !usedLabels.has(label.name);
        }
      }
      return true;
    })
  );
};

const printUpdatedLabels = (args, labels, existingLabels, usedLabels) => {
  console.log('Following labels will be updated:');
  console.log('from:');
  printLabels(
    labels.filter(label => {
      for (const existingLabel of existingLabels) {
        if (existingLabel.name === label.name) {
          return !args.delete || usedLabels.has(label.name);
        }
      }
      return false;
    })
  );
  console.log('to:');
  printLabels(
    existingLabels.filter(existingLabel => {
      for (const label of labels) {
        if (existingLabel.name === label.name) {
          return !args.delete || usedLabels.has(label.name);
        }
      }
      return false;
    })
  );
};

const printUnchangedLabels = (args, labels, existingLabels, usedLabels) => {
  console.log('Following labels will not be changed:');
  printLabels(
    existingLabels.filter(existingLabel => {
      for (const label of labels) {
        if (existingLabel.name === label.name) {
          return !args.update && (!args.delete || usedLabels.has(label.name));
        }
      }
      return true;
    })
  );
};

const getExistingLabels = async handler => {
  let existingLabels;
  try {
    existingLabels = await handler.get();
  } catch (err) {
    helpExit('Cannot get existing labels', err);
  }
  return existingLabels;
};

const dryCopyLabels = async (args, handler, labels, usedLabels) => {
  if (args.dstFile) {
    console.log(
      `Write following labels ` +
        `from repository '${args.srcRepo}' to file '${args.dstFile}'`
    );
    printLabels(labels);
  } else {
    const existingLabels = await getExistingLabels(handler);
    let msg = 'Copy the following labels from';
    if (args.srcFile) {
      msg += ` file '${args.srcFile}'`;
    } else {
      msg += ` repository '${args.srcRepo}'`;
    }
    msg += ` to repository '${args.dstRepo}'`;
    if (args.update) msg += ' updating existing labels';
    console.log(msg);
    printAddedLabels(args, labels, existingLabels, usedLabels);
    if (args.update) {
      printUpdatedLabels(args, labels, existingLabels, usedLabels);
    }
    printUnchangedLabels(args, labels, existingLabels, usedLabels);
  }
};

const copyLabels = async (args, handler, labels) => {
  if (args.dstFile) {
    try {
      await writeDump(args.dstFile, labels);
    } catch (err) {
      helpExit('Cannot write dump', err);
    }
  } else {
    try {
      labels = await handler.copyFrom(labels, args.update);
    } catch (err) {
      helpExit('Cannot copy labels', err);
    }
  }
  return labels;
};

const getLabels = async (args, handler) => {
  let labels;
  if (args.srcFile) {
    try {
      labels = await readDump(args.srcFile);
    } catch (err) {
      helpExit('Cannot read dump', err);
    }
  } else {
    try {
      labels = await handler.getFrom(args.srcRepo);
    } catch (err) {
      helpExit('Cannot read dump', err);
    }
  }
  return labels;
};

const getConfig = async args => {
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
  return args;
};

const copy = async args => {
  args = await getConfig(args);
  const handler = new LabelHandler({
    repo: args.dstRepo,
    user: args.user,
    token: args.token,
  });

  if (args.dry) console.log('This is a dry run, no changes will be made\n');

  let usedLabels = new Map();
  if (args.dstRepo && args.delete) {
    usedLabels = await deleteLabels(args, handler);
  }

  const labels = await getLabels(args, handler);
  if (args.dry) {
    await dryCopyLabels(args, handler, labels, usedLabels);
  } else {
    await copyLabels(args, handler, labels);
  }
  return labels;
};

const args = getArgs();
copy(args).then(
  labels => {
    if (!args.dry) printLabels(labels);
  },
  err => {
    helpExit('Cannot copy labels', err);
  }
);
