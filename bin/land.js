#!/usr/bin/env node

'use strict';

const childProcess = require('child_process');
const https = require('https');

const landedBranch = process.argv.slice(2);

const options = {
  headers: {
    'User-Agent': 'request',
  },
  host: 'api.github.com',
};

const supportCommits = () => {
  const differCommits = parseInt(
    childProcess
      .execSync(`git rev-list --count master..${landedBranch}`)
      .toString('utf8')
  );
  return childProcess.execSync(
    `git rebase --autosquash HEAD@{${differCommits}}`
  );
};

const httpGet = commitMessage => {
  https
    .get(options, res => {
      let data = '';
      res.setEncoding('utf8');

      res.on('data', chunk => {
        data += chunk;
      });

      res.on('end', () => {
        const primaryIndexPR = data.indexOf('html_url') + 11;
        const prUrl = data.slice(
          primaryIndexPR,
          data.indexOf('"', primaryIndexPR)
        );
        const extendedCommit = `${commitMessage}\n\nPR-URL: ${prUrl}`;
        childProcess.execSync(
          `git commit --amend --message='${extendedCommit}'`
        );
      });
    })

    .on('error', err => {
      console.error(err);
      process.exit(1);
    });
};

const getPRURL = () => {
  const gitConfig = childProcess
    .execSync('git config --get remote.origin.url')
    .toString('utf8');
  supportCommits();

  const repoName = gitConfig.slice(
    gitConfig.indexOf(':') + 1,
    gitConfig.lastIndexOf('.')
  );

  const gitLog = childProcess
    .execSync('git log -1 --pretty=format:%s')
    .toString('utf8');

  const commitMessage = gitLog.toString('utf8');
  if (!commitMessage.includes('PR-URL')) {
    options.path = `/search/issues?q=repo:${repoName}+is:pr+head:${landedBranch}`;
    httpGet(commitMessage);
  }
};

getPRURL();
