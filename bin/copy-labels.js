#!/usr/bin/env node
'use strict';

const fs = require('fs');

const { cli } = require('../lib/cli.js');
const { LabelHandler } = require('../lib/labels.js');

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

cli
  .usage('$0 <options>')
  .option('user', {
    type: 'string',
    description: 'github username',
    alias: 'u',
  })
  .option('token', {
    type: 'string',
    description: 'github access token',
    alias: 't',
  })
  .option('src-repo', {
    type: 'string',
    description: "Source repository. e.g. 'metarhia/tools'",
    alias: 's',
  })
  .option('dst-repo', {
    type: 'string',
    description: "Destination repository. e.g. 'metarhia/tools'",
    alias: 'd',
  })
  .option('src-file', {
    type: 'string',
    description: 'File to read labels from',
  })
  .option('dst-file', {
    type: 'string',
    description: 'File to write labels to',
  })
  .option('delete-before-copy', {
    type: 'boolean',
    description: 'Delete all labels in destination repository before copy',
    alias: 'd',
    default: false,
  })
  .option('update-existing-labels', {
    type: 'boolean',
    description: 'Update existing labels with the same name',
    alias: 'e',
    default: false,
  })
  .option('config', {
    description: 'Path to config file',
    type: 'string',
    alias: 'c',
  })
  .conflict('dst-file', 'dst-repo')
  .conflict('src-file', 'src-repo')
  .conflict('src-file', 'dst-file')
  .command('get', 'Get labels from repository', args => {
    const handler = new LabelHandler({
      repo: args.srcRepo,
      user: args.user,
      token: args.token,
    });
    handler
      .get()
      .then(printLabels, err => console.error('Cannot get labels', err));
  });

const readDump = file =>
  new Promise((resolve, reject) => {
    fs.readFile(file, 'utf8', (err, data) => {
      if (err) {
        reject(err);
        return;
      }
      let result;
      try {
        result = JSON.parse(data);
      } catch (e) {
        err = e;
      }
      if (err) reject(err);
      else resolve(result);
    });
  });

const writeDump = (file, data) => {
  const result = data.map(label => ({
    name: label.name,
    color: label.color,
    description: label.description,
  }));
  return new Promise((resolve, reject) => {
    fs.writeFile(file, JSON.stringify(result, null, 2), err => {
      if (err) reject(err);
      else resolve(data);
    });
  });
};

const copy = async args => {
  const handler = new LabelHandler({
    repo: args.dstRepo,
    user: args.user,
    token: args.token,
  });
  if (!args.dstFile && args.deleteBeforeCopy) await handler.delete();

  if (args.dstFile) {
    const labels = await handler.getFrom(args.srcRepo);
    return await writeDump(args.dstFile, labels);
  } else {
    const labels = args.srcFile ? await readDump(args.srcFile) : args.srcRepo;
    return await handler.copyFrom(labels, args.updateExistingLabels);
  }
};

cli.parse(process.argv, args => {
  copy(args).then(printLabels, err => console.error('Cannot copy labels', err));
});
