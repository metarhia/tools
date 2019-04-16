#!/usr/bin/env node
'use strict';

const { cli } = require('../lib/cli.js');
const { LabelHandler } = require('../lib/labels.js');

const args = cli
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
  .option('src-repo-owner', {
    type: 'string',
    description: 'Repository owner',
    alias: 'o',
  })
  .option('src-repo-name', {
    type: 'string',
    description: 'Repository name',
    alias: 'n',
  })
  .option('dst-repo-owner', {
    type: 'string',
    description: 'Owner of repository to which labels will be copied',
  })
  .option('dst-repo-name', {
    type: 'string',
    description: 'Name of repository to which labels will be copied',
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
  .parse(process.argv);

const handler = new LabelHandler({
  repoOwner: args.dstRepoOwner,
  repoName: args.dstRepoName,
  user: args.user,
  token: args.token,
});

// TODO(SemenchenkoVitaliy): remove when new version of metasync is published
const runIf = (condition, asyncFn, ...args) => {
  if (condition) {
    asyncFn(...args);
  } else {
    const callback = args[args.length - 1];
    process.nextTick(callback, null);
  }
};

runIf(
  args.deleteBeforeCopy,
  cb => handler.delete(cb),
  err => {
    if (err) {
      console.log('Cannot delete labels before copying', err);
      process.exit(1);
    }
    handler.copyFrom(
      args.srcRepoOwner,
      args.srcRepoName,
      args.updateExistingLabels,
      (err, data) => {
        if (err) {
          console.error('Cannot copy labels', err);
          process.exit(1);
        }
        const result =
          'Copied labels:\n\n' +
          data
            .map(
              label =>
                `name: ${label.name}\n` +
                `color: ${label.color}\n` +
                `description: ${label.description}\n`
            )
            .join('\n');
        console.log(result);
      }
    );
  }
);
