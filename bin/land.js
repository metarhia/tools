#!/usr/bin/env node

'use strict';

const childProcess = require('child_process');
const process = require('process');
const https = require('https');

const landedBranch = process.argv.slice(2);

const options = {
  headers: {
    'User-Agent': 'request',
  },
  host: 'api.github.com',
};

const getPRURL = () => {
  const configArgs = ['config', '--get', 'remote.origin.url'];
  const gitConfig = childProcess.spawn('git', configArgs);

  gitConfig.stdout.on('data', data => {
    const correctData = data.toString('utf8');
    options.path = `/search/issues?q=repo:${correctData.slice(
      correctData.indexOf(':') + 1,
      correctData.lastIndexOf('.')
    )}+is:pr+head:${landedBranch}`;

    const messageArgs = ['log', '-1', '--pretty=format:%s'];
    const gitLog = childProcess.spawn('git', messageArgs);

    gitLog.stdout.on('data', data => {
      const commitMessage = data.toString('utf8');
      if (!commitMessage.includes('PR-URL')) {
        https
          .get(options, res => {
            let data = '';
            res.setEncoding('utf8');

            res.on('data', chunk => {
              data += chunk;
            });

            res.on('end', () => {
              const primaryIndexPR = data.indexOf('html_url') + 11;
              const extendedCommit =
                `${commitMessage}\n\n` +
                `PR-URL: ${data.slice(
                  primaryIndexPR,
                  data.indexOf('"', primaryIndexPR)
                )}`;
              const gitCommit = childProcess.spawn('git', [
                'commit',
                '--amend',
                `--message=${extendedCommit}`,
              ]);
              gitCommit.on('error', error => {
                console.error(error);
                process.exit(1);
              });

              gitCommit.on('close', code => {
                if (code !== 0) {
                  process.exit(code);
                }
              });
            });
          })
          .on('error', e => {
            console.error(e);
          });
      }
    });

    gitLog.on('error', error => {
      console.error(error);
      process.exit(1);
    });
  });

  gitConfig.on('error', error => {
    console.error(error);
    process.exit(1);
  });
};

getPRURL();
