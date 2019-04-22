#!/usr/bin/env node
'use strict';

const fs = require('fs');

const { cli } = require('../lib/cli.js');
const { LabelHandler, runIf } = require('../lib/labels.js');

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

const args = cli
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
    handler.get((err, labels) => {
      if (err) {
        console.error('Cannot get labels', err);
        return;
      }
      printLabels(labels);
    });
  })
  .parse(process.argv);

const handler = new LabelHandler({
  repo: args.dstRepo,
  user: args.user,
  token: args.token,
});

const readDump = (file, cb) => {
  fs.readFile(args.srcFile, 'utf8', (err, data) => {
    if (err) {
      cb(err);
      return;
    }
    let result;
    try {
      result = JSON.parse(data);
    } catch (e) {
      err = e;
    }
    if (err) cb(err);
    else cb(null, result);
  });
};

const writeDump = (file, data, cb) => {
  data = data.map(label => ({
    name: label.name,
    color: label.color,
    description: label.description,
  }));
  fs.writeFile(file, JSON.stringify(data), cb);
};

runIf(
  !args.dstFile && args.deleteBeforeCopy,
  cb => handler.delete(cb),
  err => {
    if (err) {
      console.log('Cannot delete labels before copying', err);
      process.exit(1);
    }
    if (args.dstFile) {
      handler.getFrom(args.srcRepo, (err, labels) => {
        if (err) {
          console.error('Cannot get labels', err);
          process.exit(1);
        }
        writeDump(args.dstFile, labels, err => {
          if (err) {
            console.error(`Cannot write dump in ${args.dstFile}`, err);
            process.exit(1);
          }
          console.log(`Labels were dumped in ${args.dstFile}`);
        });
      });
    } else {
      runIf(
        args.srcFile,
        args.srcRepo,
        cb => readDump(args.srcFile, cb),
        (err, repo) => {
          if (err) {
            console.error(`Cannot read dump file ${args.srcFile}`, err);
            process.exit(1);
          }
          handler.copyFrom(repo, args.updateExistingLabels, (err, labels) => {
            if (err) {
              console.error('Cannot copy labels', err);
              process.exit(1);
            }
            printLabels(labels);
          });
        }
      );
    }
  }
);
